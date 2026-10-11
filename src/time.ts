import { secondsOfDay } from './reading.ts';
import { MAX_SECONDS, MAX_SLEEP, MAX_WORDS, namesOf } from './world.ts';
import type { Figure, Person, Vehicle, Walk, World } from './world.ts';

export function clockAt(world: World, at: number): string {
  const [hours, minutes] = world.clock.split(':').map(Number);
  const since = hours * 3600 + minutes * 60 + at, second = since % 86_400, day = Math.floor(since / 86_400) + 1;
  const time = [Math.floor(second / 3600), Math.floor(second / 60) % 60, Math.floor(second % 60)].map(part => String(part).padStart(2, '0')).join(':');
  return day > 1 ? `day ${day} ${time}` : time;
}

export const hasClock = (world: World, id: string, place: string | null) =>
  world.characters.some(character => character.id === id && character.clock) || world.places.some(item => item.id === place && item.clock);
// Light outdoors gives finer cues to the hour than a roof does.
const PARTS: { [where in 'open' | 'roof']: [number, string][] } = {
  open: [[5, 'early morning'], [7, 'morning'], [10, 'late morning'], [12, 'around midday'], [14, 'afternoon'], [16, 'late afternoon'],
    [18, 'early evening'], [20, 'late evening'], [23, 'night']],
  roof: [[5, 'morning'], [11, 'the middle of the day'], [15, 'afternoon'], [18, 'evening'], [23, 'night']],
};
// requestLimit() in live.ts needs this bound in characters beyond the day number.
export const SENSED = Math.max(...[...PARTS.open, ...PARTS.roof].map(([, name]) => name.length)) + 10;
export function sensed(world: World, at: number, open: boolean): string {
  const since = secondsOfDay(world.clock) + at, hour = Math.floor(since % 86_400 / 3600), day = Math.floor(since / 86_400) + 1;
  const parts = PARTS[open ? 'open' : 'roof'], part = (parts.findLast(([from]) => hour >= from) ?? parts.at(-1)!)[1];
  return day > 1 ? `day ${day}, ${part}` : part;
}
// Residents must receive time only in this form.
export function timeFor(world: World, id: string, place: string | null, at: number): string {
  return hasClock(world, id, place) ? clockAt(world, at) : `[${sensed(world, at, world.legMinutes !== undefined && place === null || world.places.some(item => item.id === place && item.open))}]`;
}

export const DRIFT = { sleep: { part: 10, most: 1800 }, wait: { part: 20, most: 180 }, do: { part: 20, most: 180 } };
// Drift must depend only on the journal so replay gives the same end.
export function lasting(world: World, actor: Person, kind: 'do' | 'wait' | 'sleep', now: number, until: string): number {
  const span = secondsUntil(world, now, until);
  if (hasClock(world, actor.id, actor.place)) return span;
  const { part, most } = DRIFT[kind], off = Math.min(Math.floor(span / part), most);
  let mixed = 2166136261;
  for (const letter of `${actor.id} ${now} ${until}`) mixed = Math.imul(mixed ^ letter.codePointAt(0)!, 16777619) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846CA68B) >>> 0;
  return Math.max(1, Math.min(kind === 'sleep' ? MAX_SLEEP : MAX_SECONDS, span - off + ((mixed ^ (mixed >>> 16)) >>> 0) % (2 * off + 1)));
}

const rateOf = (world: World, who: string) => namesOf(world).find(person => person.id === who)?.wordsPerMinute ?? world.wordsPerMinute;
export const speechSeconds = (world: World, who: string, words: number) => Math.max(2, Math.ceil(words / rateOf(world, who) * 60));
export const wordLimit = (world: World, who: string, secondsLeft: number) => Math.max(1, Math.min(MAX_WORDS, Math.floor(secondsLeft * rateOf(world, who) / 60)));

type Distances = Pick<World, 'places' | 'travelMinutes' | 'walkMetresPerMinute'>;
export function travelSeconds(world: Distances, from: string, to: string): number {
  const a = world.places.find(place => place.id === from), b = world.places.find(place => place.id === to);
  const walked = a?.at && b?.at ? Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) / world.walkMetresPerMinute : null;
  const paced = walked === null ? null : walked > 10 ? Math.round(walked) : Math.round(walked * 10) / 10;
  const listed = (place: typeof a, other: string) => place && Object.hasOwn(place.minutesTo, other) ? place.minutesTo[other] : null;
  return Math.max(1, Math.round((listed(a, to) ?? listed(b, from) ?? paced ?? world.travelMinutes) * 60));
}

export const driveSeconds = (world: Distances, from: string, to: string, faster: number) => Math.max(30, Math.ceil(travelSeconds(world, from, to) / faster));

const sinceMidnight = (world: World, at: number) => secondsOfDay(world.clock) + at;
export function figureHere(world: World, figure: Figure, at: number): boolean {
  if (!figure.hours) return true;
  const [from, to] = figure.hours.map(secondsOfDay), second = sinceMidnight(world, at) % 86_400;
  return from < to ? from <= second && second < to : second >= from || second < to;
}
export function secondsUntil(world: World, at: number, until: string): number {
  return (secondsOfDay(until) - sinceMidnight(world, at) % 86_400 + 86_400 - 1) % 86_400 + 1;
}

export function busRound(world: Distances, bus: Vehicle) {
  let at = 0;
  return bus.route!.map((from, index) => {
    const to = bus.route![(index + 1) % bus.route!.length];
    at += driveSeconds(world, from, to, bus.faster);
    const stop = { from, to, at };
    if (index < bus.route!.length - 1) at += bus.stands!;
    return stop;
  });
}
// The daily schedule determines a bus's position, so there is no position to save.
export function busAt(world: World, bus: Vehicle, now: number): Vehicle {
  const second = secondsOfDay(world.clock) + now, day = Math.floor(second / 86_400) * 86_400;
  const times = bus.leaves!.map(secondsOfDay), latest = times.findLast(time => day + time <= second);
  const began = (latest === undefined ? day - 86_400 + times.at(-1)! : day + latest) - secondsOfDay(world.clock);
  const next = times.find(time => day + time > second);
  for (const [index, stop] of busRound(world, bus).entries()) {
    if (now < began + stop.at) return { ...bus, at: null, heading: { from: stop.from, to: stop.to, at: began + stop.at }, departure: undefined };
    if (index < bus.route!.length - 1 && now < began + stop.at + bus.stands!) return { ...bus, at: stop.to, heading: null,
      departure: { to: bus.route![(index + 2) % bus.route!.length], at: began + stop.at + bus.stands! } };
  }
  return { ...bus, at: bus.route![0], heading: null, departure: { to: bus.route![1], at: (next === undefined ? day + 86_400 + times[0] : day + next) - secondsOfDay(world.clock) } };
}

export function walkAt(walk: Walk, now: number): Walk {
  const legs = walk.legs.map(leg => ({ ...leg }));
  let passed = Math.max(0, Math.min(now, walk.arrival) - walk.since);
  while (legs.length > 1 && passed >= legs[0].seconds - legs[0].behind) {
    passed -= legs[0].seconds - legs[0].behind;
    legs.shift();
  }
  legs[0].behind = Math.min(legs[0].seconds, legs[0].behind + passed);
  return { ...walk, legs, since: Math.max(now, walk.since) };
}
export const wayAt = (walk: Walk, now: number) => {
  const [leg] = walkAt(walk, now).legs;
  return { from: leg.from, to: leg.to, behind: leg.behind, ahead: leg.seconds - leg.behind };
};
export const legAt = (world: World, walk: Walk, now: number) => walk.arrival - now - world.legMinutes! * 60 >= 60 ? now + world.legMinutes! * 60 : walk.arrival;
export function turnSeconds(world: World, walk: Walk, to: string, now: number): number {
  const { legs: [leg] } = walkAt(walk, now);
  if (to === walk.legs.at(-1)!.to) return Math.max(0, walk.arrival - now);
  if (to === leg.from) return leg.behind;
  const back = leg.behind + travelSeconds(world, leg.from, to);
  const ahead = leg.seconds - leg.behind + (to === leg.to ? 0 : travelSeconds(world, leg.to, to));
  return Math.min(back, ahead);
}
