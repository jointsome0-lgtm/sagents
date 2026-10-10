// Hunger and thirst, a law of a live world in the form of `laws.ts`. Only what a deed's result really moves to
// `eaten` feeds its doer; the clock spends the counts awake and asleep. No model and no disk here.
import type { Law } from './laws.ts';
import { refuse } from './reading.ts';

// How long everyone is fed at the story's start, in seconds.
const FED_START = 10_800;
// How long everyone is not thirsty at the story's start, in seconds.
const WATER_START = 7200;
// A second awake spends one second of either count, on the way included.
const AWAKE_RATE = 1;
// A second asleep spends half a second of either count.
const ASLEEP_RATE = 0.5;
// One calorie holds for this many seconds awake.
const CALORIE_SECONDS = 36;
// This many calories in one deed first raise a negative fed count to zero.
const MEAL_CALORIES = 100;
// At this count or below one is getting hungry.
const GETTING_HUNGRY = 0;
// At this count or below one is hungry.
const HUNGRY = -7200;
// At this count or below one is very hungry.
const VERY_HUNGRY = -28_800;
// No meal leaves anyone fed for longer than this, in seconds.
const FED_LIMIT = 36_000;
// At this count or below one is thirsty; a drink first raises a lower count to here.
const THIRSTY = 0;
// At this count or below one is very thirsty.
const VERY_THIRSTY = -21_600;
// Each one drunk holds for this many seconds awake.
const DRINK_SECONDS = 10_800;
// No drink leaves anyone not thirsty for longer than this, in seconds.
const WATER_LIMIT = 21_600;

// The two counts in seconds as they stood at `since`; either can be negative.
export type Fed = { fed: number; water: number; since: number };
const countsAt = ({ fed, water, since }: Fed, asleep: boolean, now: number): Fed => {
  const spent = (now - since) * (asleep ? ASLEEP_RATE : AWAKE_RATE);
  return { fed: fed - spent, water: water - spent, since: now };
};
const FOOD = ['You are getting hungry.', 'You are hungry.', 'You are very hungry and feel weak.'];
const WATER = ['You are thirsty.', 'You are very thirsty.'];

export const hunger: Law<'hunger', 'fed'> = {
  fields: ['hunger'],
  read(file) {
    if (file.hunger !== undefined && file.hunger !== true) return refuse('hunger', 'must be true or absent');
    return file.hunger === true ? { hunger: true } : {};
  },
  begin: world => world.hunger ? { fed: new Map(world.characters.map(character => [character.id, { fed: FED_START, water: WATER_START, since: 0 }])) } : {},
  after(parts, event) {
    if (!parts.fed) return;
    if (event.kind !== 'sleep' && event.kind !== 'wake' && event.kind !== 'result') return;
    const count = parts.fed.get(event.who)!;
    // It was awake until it fell asleep, asleep until it woke, and awake when it did the deed.
    Object.assign(count, countsAt(count, event.kind === 'wake', event.at));
    if (event.kind !== 'result') return;
    let calories = 0;
    for (const posting of event.moved ?? []) {
      if (posting.to !== 'eaten') continue;
      const n = posting.n ?? 1;
      if (posting.food! > 0) calories += posting.food! * n;
      if (posting.drink) count.water = Math.min(WATER_LIMIT, Math.max(THIRSTY, count.water) + DRINK_SECONDS * n);
    }
    if (calories > 0) count.fed = Math.min(FED_LIMIT, (calories >= MEAL_CALORIES ? Math.max(0, count.fed) : count.fed) + CALORIE_SECONDS * calories);
  },
  turn(world, parts, actor, now) {
    if (!world.hunger) return null;
    const { fed, water } = countsAt(parts.fed!.get(actor.id)!, actor.asleep, now);
    const food = fed <= GETTING_HUNGRY ? FOOD[fed <= VERY_HUNGRY ? 2 : fed <= HUNGRY ? 1 : 0] : null;
    const drink = water <= THIRSTY ? WATER[water <= VERY_THIRSTY ? 1 : 0] : null;
    return food && drink ? `${food} ${drink}` : food ?? drink;
  },
  size: world => world.hunger ? Math.max(...FOOD.map(line => line.length)) + 1 + Math.max(...WATER.map(line => line.length)) : 0,
};
