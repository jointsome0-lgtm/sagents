import type { Law } from './laws.ts';
import { boundedOf, CHARS_PER_WORD, closed, countOf, durationOf, isObject, listOf, refuse, secondsOfDay, textOf, TIME } from './reading.ts';
import { attend } from './action.ts';
import { clockAt, timeFor } from './time.ts';

export const SKY_WORDS = 40;
export type Sky = { text: string; indoors: string | null };
export type Weather = { start: Sky; changes: (Sky & { at: number })[] } | { seed: number; states: Sky[]; minutes: [number, number] };
export type Skies = { n: number; index: number; until: number | null };

function skyOf(value: unknown, field: string): Sky {
  if (!isObject(value)) return refuse(field, 'must be an object');
  const text = boundedOf(textOf(value.text, `${field}.text`), `${field}.text`, SKY_WORDS) as string;
  return { text, indoors: boundedOf(value.indoors, `${field}.indoors`, SKY_WORDS) };
}

function readWeather(value: unknown, clock: string): Weather | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) return refuse('weather', 'must be an object');
  if (value.seed !== undefined) {
    if (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed) || value.seed < 0) return refuse('weather.seed', 'must be a whole number, zero or above');
    const states = listOf(value.states, 'weather.states').map((state, index) => skyOf(state, `weather.states[${index}]`));
    if (states.length < 2) return refuse('weather.states', 'must hold two states at least');
    const span: unknown[] = Array.isArray(value.minutes) ? value.minutes : [];
    const least = countOf(span[0] ?? null, 'weather.minutes[0]', 0), most = countOf(span[1] ?? null, 'weather.minutes[1]', 0);
    if (span.length !== 2 || most < least) return refuse('weather.minutes', 'must be two whole numbers, the least and the most minutes a state lasts');
    durationOf(least * 60, 'weather.minutes[0]');
    durationOf(most * 60, 'weather.minutes[1]');
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
    durationOf(at, `${field}.day`);
    if (at <= (changes.at(-1)?.at ?? 0)) return refuse(field, 'must come after the story\'s start and after the change before it');
    changes.push({ ...skyOf(change, field), at });
  }
  return { start: skyOf(value.start, 'weather.start'), changes };
}

// Draw only from the settings so replay gives the same weather.
function drawn(seed: number, n: number, use: number): number {
  let mixed = (seed ^ Math.imul(n + 1, 0x9E3779B1) ^ Math.imul(use + 1, 0x85EBCA6B)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7FEB352D) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846CA68B) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
const lasts = (weather: { seed: number; minutes: [number, number] }, n: number) =>
  (weather.minutes[0] + drawn(weather.seed, n, 0) % (weather.minutes[1] - weather.minutes[0] + 1)) * 60;

function first(weather: Weather): Skies {
  if ('start' in weather) return { n: 0, index: 0, until: weather.changes[0]?.at ?? null };
  return { n: 0, index: drawn(weather.seed, 0, 1) % weather.states.length, until: lasts(weather, 0) };
}
function following(weather: Weather, skies: Skies): Skies {
  const n = skies.n + 1;
  if ('start' in weather) return { n, index: n, until: weather.changes[n]?.at ?? null };
  // Exclude the current state so a change always changes the weather.
  const index = (skies.index + 1 + drawn(weather.seed, n, 1) % (weather.states.length - 1)) % weather.states.length;
  return { n, index, until: (skies.until as number) + lasts(weather, n) };
}
const skyAt = (weather: Weather, skies: Skies): Sky => 'start' in weather ? skies.n ? weather.changes[skies.n - 1] : weather.start : weather.states[skies.index];
const reaches = (sky: Sky, open: boolean) => open ? sky.text : sky.indoors;
const WEATHER = 'The weather changes:';

export const weather: Law<'weather', 'skies'> = {
  kind: 'weather',
  fields: ['weather'],
  read: (file, clock) => ({ weather: readWeather(file.weather, clock) }),
  begin: world => ({ skies: world.weather && first(world.weather) }),
  due: (_world, { skies }, actor) => skies && skies.until !== null && skies.until <= actor.freeAt ? { kind: 'weather', at: skies.until, n: skies.n + 1 } : null,
  put(world, parts, people, record) {
    const settings = world.weather as Weather, skies = following(settings, parts.skies as Skies), sky = skyAt(settings, skies);
    parts.skies = skies;
    const open = new Set(world.places.filter(place => place.open).map(place => place.id)), clock = clockAt(world, record.at);
    const here = people.filter(person => person.place !== null && !person.asleep && reaches(sky, open.has(person.place)) !== null);
    for (const witness of here) attend(witness, record.at);
    return { event: { at: record.at, clock, kind: 'weather', who: '', place: '', to: null, text: sky.text, seconds: 0, cut: false, heard: here.map(person => person.id),
      note: null, indoors: sky.indoors },
    lines: new Map(here.map(person => [person.id, { text: `${timeFor(world, person.id, person.place, record.at)} ${WEATHER} ${reaches(sky, open.has(person.place as string))}`, idle: false }])) };
  },
  turn(world, { skies }, actor) {
    const open = world.places.find(place => place.id === actor.place)!.open, text = world.weather && skies ? reaches(skyAt(world.weather, skies), open) : null;
    return text === null ? null : `${open ? 'The weather' : 'The weather, from under the roof'}: ${closed(text)}`;
  },
  world(world, { skies }, place) {
    if (!world.weather || !skies) return null;
    const sky = skyAt(world.weather, skies);
    return place.open ? `The weather: ${closed(sky.text)}` : `The weather outside: ${closed(sky.text)}${sky.indoors === null ? '' : ` Under this roof: ${closed(sky.indoors)}`}`;
  },
  size: () => 2 * SKY_WORDS * CHARS_PER_WORD + 100,
};
