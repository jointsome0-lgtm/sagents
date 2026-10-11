import type { Law } from './laws.ts';
import { THIRDS } from './things.ts';
import { refuse } from './reading.ts';

const FED_START = 10_800;
const WATER_START = 7200;
const AWAKE_RATE = 1;
const ASLEEP_RATE = 0.5;
const CALORIE_SECONDS = 36;
const MEAL_CALORIES = 100;
const GETTING_HUNGRY = 0;
const HUNGRY = -7200;
const VERY_HUNGRY = -28_800;
const FED_LIMIT = 36_000;
const THIRSTY = 0;
const VERY_THIRSTY = -21_600;
const DRINK_SECONDS = 10_800;
const WATER_LIMIT = 21_600;

// Counts use seconds awake and may be negative.
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
    // Charge the elapsed time at the rate before the event changed whether the person was asleep.
    Object.assign(count, countsAt(count, event.kind === 'wake', event.at));
    if (event.kind !== 'result') return;
    let calories = 0, meal = false;
    for (const posting of event.moved ?? []) {
      if (posting.to !== 'eaten' && posting.to !== 'tasted') continue;
      const n = posting.n ?? 1, amount = posting.thirds === undefined ? n : posting.thirds / THIRDS;
      if (posting.thirds !== undefined && posting.food! >= MEAL_CALORIES) meal = true;
      if (posting.food! > 0) calories += posting.thirds === undefined ? posting.food! * n : posting.food! * posting.thirds / THIRDS;
      if (posting.drink) count.water = Math.min(WATER_LIMIT, Math.max(THIRSTY, count.water) + DRINK_SECONDS * amount);
    }
    if (calories > 0) count.fed = Math.min(FED_LIMIT, (calories >= MEAL_CALORIES || meal ? Math.max(0, count.fed) : count.fed) + CALORIE_SECONDS * calories);
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
