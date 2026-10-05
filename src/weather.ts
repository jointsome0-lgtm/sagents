// The weather of a live world: what the sky is like now and when it changes next, as the world file gives it. Nothing
// here is asked of a model and nothing is drawn by chance at run time: the same world file always has the same
// weather at the same moment. No model and no disk here.
import { boundedOf, countOf, isObject, listOf, refuse, secondsOfDay, textOf, TIME } from './reading.ts';

// The most words either text of one state may hold, so that a request has a largest size.
export const SKY_WORDS = 40;
// One state of the weather: `text` is what is seen and felt under the open sky, `indoors` what of it reaches someone
// under a roof, or null when nothing does.
export type Sky = { text: string; indoors: string | null };
// A world file gives its weather in one of two forms. A schedule is the state at the story's start and the changes
// after it, each `at` so many seconds of the story. A series is drawn from a seed: its states follow one another,
// never the same one twice running, and each lasts a whole number of minutes within `minutes`.
export type Weather = { start: Sky; changes: (Sky & { at: number })[] } | { seed: number; states: Sky[]; minutes: [number, number] };
// The weather's part of a world's state: the number of the current state, counted from 0 at the story's start, which
// state of a series it is, and the second at which the next one begins, or null when none follows.
export type Skies = { n: number; index: number; until: number | null };

function skyOf(value: unknown, field: string): Sky {
  if (!isObject(value)) return refuse(field, 'must be an object');
  const text = boundedOf(textOf(value.text, `${field}.text`), `${field}.text`, SKY_WORDS) as string;
  return { text, indoors: boundedOf(value.indoors, `${field}.indoors`, SKY_WORDS) };
}

// `weather` of a world file, checked whole. `clock` is the time of day at the story's start, and a change's `day` is
// counted as the story's clock counts it: the story starts on day 1.
export function readWeather(value: unknown, clock: string): Weather | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) return refuse('weather', 'must be an object');
  if (value.seed !== undefined) {
    if (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed) || value.seed < 0) return refuse('weather.seed', 'must be a whole number, zero or above');
    const states = listOf(value.states, 'weather.states').map((state, index) => skyOf(state, `weather.states[${index}]`));
    if (states.length < 2) return refuse('weather.states', 'must hold two states at least');
    const span: unknown[] = Array.isArray(value.minutes) ? value.minutes : [];
    const least = countOf(span[0] ?? null, 'weather.minutes[0]', 0), most = countOf(span[1] ?? null, 'weather.minutes[1]', 0);
    if (span.length !== 2 || most < least) return refuse('weather.minutes', 'must be two whole numbers, the least and the most minutes a state lasts');
    return { seed: value.seed, states, minutes: [least, most] };
  }
  const changes: (Sky & { at: number })[] = [];
  if (value.changes !== undefined && !Array.isArray(value.changes)) return refuse('weather.changes', 'must be a list');
  for (const [index, change] of ((value.changes ?? []) as unknown[]).entries()) {
    const field = `weather.changes[${index}]`;
    if (!isObject(change)) return refuse(field, 'must be an object');
    const day = countOf(change.day ?? null, `${field}.day`, 0);
    if (typeof change.at !== 'string' || !TIME.test(change.at)) return refuse(`${field}.at`, 'must be a time of day like `02:00`');
    const at = (day - 1) * 86_400 + secondsOfDay(change.at) - secondsOfDay(clock);
    if (at <= (changes.at(-1)?.at ?? 0)) return refuse(field, 'must come after the story\'s start and after the change before it');
    changes.push({ ...skyOf(change, field), at });
  }
  return { start: skyOf(value.start, 'weather.start'), changes };
}

// A number that depends on a seed, on which state it is for and on what it is used for, and on nothing else.
function drawn(seed: number, n: number, use: number): number {
  let mixed = (seed ^ Math.imul(n + 1, 0x9E3779B1) ^ Math.imul(use + 1, 0x85EBCA6B)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7FEB352D) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846CA68B) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
// How long the n-th state of a series lasts, in seconds.
const lasts = (weather: { seed: number; minutes: [number, number] }, n: number) =>
  (weather.minutes[0] + drawn(weather.seed, n, 0) % (weather.minutes[1] - weather.minutes[0] + 1)) * 60;

// The weather at the story's start.
export function begin(weather: Weather): Skies {
  if ('start' in weather) return { n: 0, index: 0, until: weather.changes[0]?.at ?? null };
  return { n: 0, index: drawn(weather.seed, 0, 1) % weather.states.length, until: lasts(weather, 0) };
}
// The state that follows `skies` and begins when it ends.
export function following(weather: Weather, skies: Skies): Skies {
  const n = skies.n + 1;
  if ('start' in weather) return { n, index: n, until: weather.changes[n]?.at ?? null };
  // One of the other states, so that a change is always a change.
  const index = (skies.index + 1 + drawn(weather.seed, n, 1) % (weather.states.length - 1)) % weather.states.length;
  return { n, index, until: (skies.until as number) + lasts(weather, n) };
}
export const skyAt = (weather: Weather, skies: Skies): Sky => 'start' in weather ? skies.n ? weather.changes[skies.n - 1] : weather.start : weather.states[skies.index];
// What of a state reaches someone in a place: its text under the open sky, and under a roof what gets in, or null.
export const reaches = (sky: Sky, open: boolean) => open ? sky.text : sky.indoors;
