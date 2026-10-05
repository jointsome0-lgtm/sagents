// The time of a live world, with no model in it: the story's clock in whole seconds since its start, the time as
// someone with no clock at hand can tell it, and how long speech and a walk between two places take.
import { secondsOfDay } from './reading.ts';
import { MAX_SECONDS, MAX_SLEEP, MAX_WORDS } from './world.ts';
import type { Person, World } from './world.ts';

// The story's clock at so many seconds from its start, as a time of day. From the second day on it names the day.
export function clockAt(world: World, at: number): string {
  const [hours, minutes] = world.clock.split(':').map(Number);
  const since = hours * 3600 + minutes * 60 + at, second = since % 86_400, day = Math.floor(since / 86_400) + 1;
  const time = [Math.floor(second / 3600), Math.floor(second / 60) % 60, second % 60].map(part => String(part).padStart(2, '0')).join(':');
  return day > 1 ? `day ${day} ${time}` : time;
}

// Whether the person `id` can read the clock in `place`: by a clock of its own or by the place's. On the way it is in
// no place, and `place` is null.
export const hasClock = (world: World, id: string, place: string | null) =>
  world.characters.some(character => character.id === id && character.clock) || world.places.some(item => item.id === place && item.clock);
// The parts of a day as someone without a clock tells them, each from its first hour on and the last one over
// midnight until the first: finer under the open sky, where the light shows the hour, than under a roof, and the
// night is one part in both.
const PARTS: { [where in 'open' | 'roof']: [number, string][] } = {
  open: [[5, 'early morning'], [7, 'morning'], [10, 'late morning'], [12, 'around midday'], [14, 'afternoon'], [16, 'late afternoon'],
    [18, 'early evening'], [20, 'late evening'], [23, 'night']],
  roof: [[5, 'morning'], [11, 'the middle of the day'], [15, 'afternoon'], [18, 'evening'], [23, 'night']],
};
// The most characters `sensed` gives beyond the number of the day.
export const SENSED = Math.max(...[...PARTS.open, ...PARTS.roof].map(([, name]) => name.length)) + 10;
// The time of the story as a body knows it with no clock at hand: the part of the day, and the day as the clock counts it.
export function sensed(world: World, at: number, open: boolean): string {
  const since = secondsOfDay(world.clock) + at, hour = Math.floor(since % 86_400 / 3600), day = Math.floor(since / 86_400) + 1;
  const parts = PARTS[open ? 'open' : 'roof'], part = (parts.findLast(([from]) => hour >= from) ?? parts.at(-1)!)[1];
  return day > 1 ? `day ${day}, ${part}` : part;
}
// The time as the person `id` in `place` can tell it, as a line of its memory opens with it: the clock when one is at
// hand, and the part of the day otherwise. The engine sends a resident no time in any other form.
export function timeFor(world: World, id: string, place: string | null, at: number): string {
  return hasClock(world, id, place) ? clockAt(world, at) : `[${sensed(world, at, world.places.some(item => item.id === place && item.open))}]`;
}

// How far from the time of day it aimed at an action `until` that time ends for someone with no clock at hand: by at
// most one part in `part` of the span to that time, and by `most` seconds at most, either way. A sleeper is off by up
// to half an hour after a night, and one who waits or does something by up to three minutes after an hour.
export const DRIFT = { sleep: { part: 10, most: 1800 }, wait: { part: 20, most: 180 }, do: { part: 20, most: 180 } };
// The seconds an action `until` a time of day lasts when it begins at `now`. With a clock at hand it ends at that
// time: the clock is the alarm. Without one the end is off by a number that follows from who acts, when and until
// what time, and from nothing else, so the same journal always gives the same end. The span stays one the action allows.
export function lasting(world: World, actor: Person, kind: 'do' | 'wait' | 'sleep', now: number, until: string): number {
  const span = secondsUntil(world, now, until);
  if (hasClock(world, actor.id, actor.place)) return span;
  const { part, most } = DRIFT[kind], off = Math.min(Math.floor(span / part), most);
  let mixed = 2166136261;
  for (const letter of `${actor.id} ${now} ${until}`) mixed = Math.imul(mixed ^ letter.codePointAt(0)!, 16777619) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846CA68B) >>> 0;
  return Math.max(1, Math.min(kind === 'sleep' ? MAX_SLEEP : MAX_SECONDS, span - off + ((mixed ^ (mixed >>> 16)) >>> 0) % (2 * off + 1)));
}

export const speechSeconds = (world: World, words: number) => Math.max(2, Math.ceil(words / world.wordsPerMinute * 60));
// How many words one speech may hold when so many seconds are left before the horizon.
export const wordLimit = (world: World, secondsLeft: number) => Math.max(1, Math.min(MAX_WORDS, Math.floor(secondsLeft * world.wordsPerMinute / 60)));

// `minutesTo` is read both ways. A pair that is not listed takes the straight line between the two at the world's
// pace when both say where they lie, as whole minutes above ten and tenths of a minute up to there, and the world's
// `travelMinutes` otherwise.
export function travelSeconds(world: World, from: string, to: string): number {
  const a = world.places.find(place => place.id === from), b = world.places.find(place => place.id === to);
  const walked = a?.at && b?.at ? Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) / world.walkMetresPerMinute : null;
  const paced = walked === null ? null : walked > 10 ? Math.round(walked) : Math.round(walked * 10) / 10;
  return Math.max(1, Math.round((a?.minutesTo[to] ?? b?.minutesTo[from] ?? paced ?? world.travelMinutes) * 60));
}

// The moment of the story `at` seconds from its start, as seconds since the midnight before the start.
const sinceMidnight = (world: World, at: number) => secondsOfDay(world.clock) + at;
// The seconds from `at` to the next moment the story's clock shows the time of day `until`, a whole day when it shows it now.
export function secondsUntil(world: World, at: number, until: string): number {
  return (secondsOfDay(until) - sinceMidnight(world, at) % 86_400 + 86_400 - 1) % 86_400 + 1;
}
