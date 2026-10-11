import { boundedOf, amountOf, countOf, durationOf, isObject, listOf, MAX_FACTS, refuse, secondsOfDay, textOf, TIME, wordsOf } from './reading.ts';
import { all, MAX_IN_PLACE, MAX_ON_PERSON, readThings, SINKS } from './things.ts';
import type { Posting, Thing } from './things.ts';
import type { Sleep } from './sleep.ts';
import type { Weather } from './weather.ts';
import { busRound } from './time.ts';
import type { Change } from './touch.ts';
import { readGiven } from './marks.ts';
import type { Given, Change as Lingering } from './marks.ts';

export { CHARS_PER_WORD, cut, MAX_FACTS, sizeOf, wordsOf, WorldError } from './reading.ts';

export const MAX_WORDS = 65;
export const GESTURE_WORDS = 12, SAYS_WORDS = 20;
export const MAX_SECONDS = 3600;
export const MAX_SLEEP = 43_200;
export const LOST_SECONDS = 30;

export type Figure = { id: string; name: string; looks: string | null; facts: string | null; wordsPerMinute?: number };
export type Vehicle = { at: string | null; heading: { from: string; to: string; at: number } | null; faster: number; seats: number; drivers: string[] | null; reach: string[];
  route?: string[]; leaves?: string[]; stands?: number; fare?: { name: string; n: number }; departure?: { to: string; at: number } };
export type Place = { id: string; name: string; about: string; facts: string | null; things: Thing[]; open: boolean; clock: boolean;
  crowd: string | null; figures: Figure[];
  at: [number, number] | null; minutesTo: { [place: string]: number }; nextDoor: string[]; vehicle?: Vehicle };
export type Character = { id: string; name: string; place: string; sheet: string; memory: string | null; facts: string | null; looks: string | null; pose: string | null;
  carries: Thing[]; clock: boolean; marks: Given[]; traces: string[] | null; wordsPerMinute?: number };
export const LIMITS = { looks: 60, pose: 20, feels: 20, beyond: 20, crowd: 60, touch: 15, trace: 12 };
export const MAX_TRACES = 8;
// Requests list traces in one sentence, so a trace must not end with a stop.
export const traceOf = (text: string) => wordsOf(text).join(' ').replace(/[.;]+$/, '');
export type World = { title: string; about: string; facts: string | null; clock: string; wordsPerMinute: number; remote: string | null; touch: boolean; marks: boolean; ways?: true; deedEnds?: true; hunger?: true; stableFirst?: true; fixedSchema?: true; oneSchema?: true;
  vehicles?: Place[]; travelMinutes: number; walkMetresPerMinute: number; shortWords: number; longWords: number; sleep: Sleep; weather: Weather | null; places: Place[]; characters: Character[] };

export type Kind = 'say' | 'call' | 'go' | 'do' | 'wait' | 'sleep';
// fromDeed links even a refused way to its result; it must not add a memory line.
export type Event = { at: number; clock: string; kind: Kind | 'stop' | 'drive' | 'park' | 'arrive' | 'wake' | 'memory' | 'result' | 'reply' | 'weather'; who: string; place: string; to: string | null;
  text: string | null; seconds: number; cut: boolean; heard: string[]; note: string | null; gesture?: string; says?: string; wakes?: string[]; deedCut?: true;
  transfer?: true; from?: string; arrival?: number; indoors?: string | null; search?: boolean; finds?: string[]; moved?: Posting[]; set?: { what: string; name: string; state: string }[];
  poses?: { of: string; text: string }[]; feels?: { of: string; text: string }[]; beyond?: string | null; nearby?: string[]; found?: { what: string; name: string; spot: string }[]; touches?: Change[]; lingers?: Lingering[];
  traced?: Mark[]; wiped?: Mark[]; goes?: string | null; fromDeed?: number; ofDeed?: number; worked?: number; planned?: number };
export type Mark = { of: string; label: string; text: string };
// speaking and listening are end times, not durations.
export type Person = { id: string; place: string | null; heading: string | null; asleep: boolean; freeAt: number; began: number | null;
  speaking: number; listening: number; passageUntil?: number; pose: string | null };

const ID = /^[A-Za-z][\w-]{0,39}$/;
const factsOf = (value: unknown, field: string) => boundedOf(value, field, MAX_FACTS);
const rateOf = (value: unknown, field: string, absent: number) => {
  const rate = amountOf(value, field, absent);
  durationOf(Math.max(2, Math.ceil(MAX_WORDS / rate * 60)), field);
  return rate;
};
// A move's `to` takes a place's id, a person's, a thing's label or a way out of the world alike, and figures are
// named beside people, so an id is none of the others and none of the rules' own names.
function idOf(value: unknown, field: string, taken: string[], traced: boolean): string {
  if (typeof value !== 'string' || !ID.test(value)) return refuse(field, 'must be a short id of Latin letters, digits, `_` and `-`');
  if (traced && /^m\d+$/.test(value)) return refuse(field, 'must not be a label of a trace like `m7`, in a world whose characters have `traces`');
  if (SINKS.includes(value) || /^t\d+$/.test(value) || value in {}) return refuse(field, 'must not be `eaten`, `burned`, a label of a thing like `t7` or a name every object has like `constructor`');
  if (taken.includes(value)) return refuse(field, 'repeats an id');
  taken.push(value);
  return value;
}

// laws.ts adds the law settings after this check.
export function readCore(value: unknown): Omit<World, 'sleep' | 'weather' | 'hunger'> {
  if (!isObject(value)) return refuse('the file', 'must be a JSON object');
  if (typeof value.clock !== 'string' || !TIME.test(value.clock)) return refuse('clock', 'must be a time of day like `21:00`');
  if (value.remote !== undefined && value.remote !== null) textOf(value.remote, 'remote');
  const walkMetresPerMinute = amountOf(value.walkMetresPerMinute, 'walkMetresPerMinute', 80);
  const wordsPerMinute = amountOf(value.wordsPerMinute, 'wordsPerMinute', 130), travelMinutes = amountOf(value.travelMinutes, 'travelMinutes', 5);
  durationOf(Math.max(2, Math.ceil(MAX_WORDS / wordsPerMinute * 60)), 'wordsPerMinute');
  durationOf(Math.max(1, Math.round(travelMinutes * 60)), 'travelMinutes');
  if (value.touch !== undefined && typeof value.touch !== 'boolean') return refuse('touch', 'must be true or false');
  if (value.fixedSchema !== undefined && value.fixedSchema !== true) return refuse('fixedSchema', 'must be true or absent');
  if (value.deedEnds !== undefined && typeof value.deedEnds !== 'boolean') return refuse('deedEnds', 'must be true or false');
  if (value.ways !== undefined && typeof value.ways !== 'boolean') return refuse('ways', 'must be true or false');
  if (value.stableFirst !== undefined && typeof value.stableFirst !== 'boolean') return refuse('stableFirst', 'must be true or false');
  if (value.oneSchema !== undefined && value.oneSchema !== true) return refuse('oneSchema', 'must be true or absent');
  if (value.marks !== undefined && typeof value.marks !== 'boolean') return refuse('marks', 'must be true or false');
  const places: Place[] = [], taken: string[] = [], labels = { next: 1 }, longWords = countOf(value.longWords, 'longWords', 400);
  const traced = Array.isArray(value.characters) && value.characters.some(character => isObject(character) && character.traces !== undefined);
  const within = (things: Thing[], most: number, field: string) => all(things).length <= most ? things : refuse(field, `must hold ${most} things at most, with all that they hold`);
  for (const [index, place] of listOf(value.places, 'places').entries()) {
    const field = `places[${index}]`;
    if (!isObject(place)) return refuse(field, 'must be an object');
    if (place.open !== undefined && typeof place.open !== 'boolean') return refuse(`${field}.open`, 'must be true or false');
    if (place.clock !== undefined && typeof place.clock !== 'boolean') return refuse(`${field}.clock`, 'must be true or false');
    if (place.minutesTo !== undefined && !isObject(place.minutesTo)) return refuse(`${field}.minutesTo`, 'must be an object');
    if (place.nextDoor !== undefined && !Array.isArray(place.nextDoor)) return refuse(`${field}.nextDoor`, 'must be a list');
    // Refuse the old text form rather than silently lose a thing.
    if (place.hidden !== undefined) return refuse(`${field}.hidden`, 'is no longer read: a hidden thing is one of `things` with `hidden`');
    if (place.figures !== undefined && !Array.isArray(place.figures)) return refuse(`${field}.figures`, 'must be a list');
    const figures = ((place.figures ?? []) as unknown[]).map((figure, at): Figure => {
      const name = `${field}.figures[${at}]`;
      if (!isObject(figure)) return refuse(name, 'must be an object');
      return { id: figure.id as string, name: textOf(figure.name, `${name}.name`), looks: boundedOf(figure.looks, `${name}.looks`, LIMITS.looks),
        facts: factsOf(figure.facts, `${name}.facts`),
        ...(figure.wordsPerMinute === undefined ? {} : { wordsPerMinute: rateOf(figure.wordsPerMinute, `${name}.wordsPerMinute`, wordsPerMinute) }) };
    });
    const at = place.at === undefined || place.at === null ? null : place.at;
    if (at !== null && !(Array.isArray(at) && at.length === 2 && at.every(part => typeof part === 'number' && Number.isFinite(part)))) {
      return refuse(`${field}.at`, 'must be two finite numbers, the metres east and north');
    }
    const minutesTo = Object.fromEntries(Object.entries(place.minutesTo ?? {}).map(([to, value]) => {
      const name = `${field}.minutesTo.${to}`, minutes = amountOf(value ?? null, name, 0);
      durationOf(Math.max(1, Math.round(minutes * 60)), name);
      return [to, minutes];
    }));
    places.push({ id: idOf(place.id, `${field}.id`, taken, traced), name: textOf(place.name, `${field}.name`),
      about: textOf(place.about, `${field}.about`), facts: factsOf(place.facts, `${field}.facts`),
      things: within(readThings(place.things, `${field}.things`, labels, true, 1, true, value.hunger === true), MAX_IN_PLACE, `${field}.things`), open: place.open === true, clock: place.clock === true,
      crowd: boundedOf(place.crowd, `${field}.crowd`, LIMITS.crowd), figures, at: at as [number, number] | null, minutesTo, nextDoor: (place.nextDoor ?? []) as string[] });
  }
  for (const [index, place] of places.entries()) {
    const unknown = Object.keys(place.minutesTo).find(to => to === place.id || !places.some(known => known.id === to));
    if (unknown !== undefined) return refuse(`places[${index}].minutesTo.${unknown}`, 'must name another place of the list');
    for (const other of places) if (other !== place && place.at && other.at) {
      const distance = Math.hypot(place.at[0] - other.at[0], place.at[1] - other.at[1]);
      if (!Number.isFinite(distance)) return refuse(`places[${index}].at`, 'must have finite distances to every other place');
      if (place.minutesTo[other.id] === undefined && other.minutesTo[place.id] === undefined) {
        const walked = distance / walkMetresPerMinute, paced = walked > 10 ? Math.round(walked) : Math.round(walked * 10) / 10;
        durationOf(Math.max(1, Math.round(paced * 60)), `places[${index}].at`);
      }
    }
    const stray = place.nextDoor.findIndex(to => to === place.id || !places.some(known => known.id === to));
    if (stray !== -1) return refuse(`places[${index}].nextDoor[${stray}]`, 'must name another place of the list');
  }
  const doors = places.map(place => places.filter(other => place.nextDoor.includes(other.id) || other.nextDoor.includes(place.id)).map(other => other.id));
  for (const [index, place] of places.entries()) place.nextDoor = doors[index];
  const characters: Character[] = [];
  for (const [index, character] of listOf(value.characters, 'characters').entries()) {
    const field = `characters[${index}]`;
    if (!isObject(character)) return refuse(field, 'must be an object');
    if (!places.some(place => place.id === character.place)) return refuse(`${field}.place`, 'must name a place of the list');
    if (character.clock !== undefined && typeof character.clock !== 'boolean') return refuse(`${field}.clock`, 'must be true or false');
    const old = ['holds', 'has'].find(name => character[name] !== undefined);
    if (old) return refuse(`${field}.${old}`, 'is no longer read: what a person has is the list `carries`');
    const given: unknown = character.traces;
    if (given !== undefined && !(Array.isArray(given) && given.length <= MAX_TRACES)) return refuse(`${field}.traces`, `must be a list of ${MAX_TRACES} texts at most`);
    const traces = given === undefined ? null : (given as unknown[]).map((item, at) => {
      const text = traceOf(boundedOf(textOf(item, `${field}.traces[${at}]`), `${field}.traces[${at}]`, LIMITS.trace) as string);
      return text ? text : refuse(`${field}.traces[${at}]`, 'must be a text that is not empty');
    });
    if (traces && new Set(traces).size !== traces.length) return refuse(`${field}.traces`, 'must not hold one text twice');
    characters.push({ id: idOf(character.id, `${field}.id`, taken, traced), name: textOf(character.name, `${field}.name`),
      place: character.place as string, sheet: textOf(character.sheet, `${field}.sheet`), memory: boundedOf(character.memory, `${field}.memory`, longWords), facts: factsOf(character.facts, `${field}.facts`),
      looks: boundedOf(character.looks, `${field}.looks`, LIMITS.looks), pose: boundedOf(character.pose, `${field}.pose`, LIMITS.pose),
      carries: within(readThings(character.carries, `${field}.carries`, labels, false, 1, false, value.hunger === true), MAX_ON_PERSON, `${field}.carries`),
      clock: character.clock === true, traces, marks: readGiven(character.marks, `${field}.marks`),
      ...(character.wordsPerMinute === undefined ? {} : { wordsPerMinute: rateOf(character.wordsPerMinute, `${field}.wordsPerMinute`, wordsPerMinute) }) });
    if (value.marks !== true && characters[index].marks.length) return refuse(`${field}.marks`, 'needs the setting `marks` of the world file');
  }
  for (const [index, place] of places.entries()) {
    for (const [at, figure] of place.figures.entries()) idOf(figure.id, `places[${index}].figures[${at}].id`, taken, traced);
  }
  const vehicles: Place[] = [];
  if (value.vehicles !== undefined) {
    if (!Array.isArray(value.vehicles) || value.vehicles.length > 6) return refuse('vehicles', 'must be a list of at most 6 vehicles');
    for (const [index, vehicle] of value.vehicles.entries()) {
      const field = `vehicles[${index}]`;
      if (!isObject(vehicle)) return refuse(field, 'must be an object');
      const whole = (name: string, most: number, least: number) => {
        const n = vehicle[name];
        return typeof n === 'number' && Number.isInteger(n) && n >= least && n <= most ? n : refuse(`${field}.${name}`, `must be a whole number from ${least} to ${most}`);
      };
      const ids = (name: string, list: { id: string }[]): string[] | null => {
        const given = vehicle[name];
        if (given === undefined) return null;
        if (!Array.isArray(given)) return refuse(`${field}.${name}`, 'must be a list');
        const stray = given.findIndex((id, at) => !list.some(item => item.id === id) || given.indexOf(id) !== at);
        if (stray !== -1) return refuse(`${field}.${name}[${stray}]`, 'must name an id of the list, and each once');
        return given as string[];
      };
      if (!places.some(place => place.id === vehicle.at)) return refuse(`${field}.at`, 'must name a place of the list');
      if (vehicle.open !== undefined && typeof vehicle.open !== 'boolean') return refuse(`${field}.open`, 'must be true or false');
      let bus: Pick<Vehicle, 'route' | 'leaves' | 'stands' | 'fare'> = {};
      if (vehicle.route !== undefined) {
        const route = vehicle.route;
        if (!Array.isArray(route) || route.length < 2 || route.length > 12 || route.some((id, at) => !places.some(place => place.id === id) || id === route[(at + 1) % route.length])) return refuse(`${field}.route`, 'must list 2 to 12 places, with no place twice in a row');
        if (vehicle.drivers !== undefined || vehicle.reach !== undefined) return refuse(field, 'a route takes the place of drivers and reach');
        const leaves = vehicle.leaves;
        if (!Array.isArray(leaves) || leaves.length < 1 || leaves.length > 48 || leaves.some((time, at) => typeof time !== 'string' || !TIME.test(time) || at > 0 && time <= leaves[at - 1])) return refuse(`${field}.leaves`, 'must list 1 to 48 times of day in rising order');
        if (vehicle.at !== route[0]) return refuse(`${field}.at`, 'must be the first stop of the route');
        bus = { route, leaves, stands: vehicle.stands === undefined ? 60 : whole('stands', 1800, 30) };
        if (vehicle.fare !== undefined) {
          const fare = vehicle.fare;
          if (!isObject(fare)) return refuse(`${field}.fare`, 'must be an object');
          const name = textOf(fare.name, `${field}.fare.name`);
          if (typeof fare.n !== 'number' || !Number.isInteger(fare.n) || fare.n < 1 || fare.n > 1_000_000_000) return refuse(`${field}.fare.n`, 'must be a whole number from 1 to 1,000,000,000');
          bus.fare = { name, n: fare.n };
        }
      }
      vehicles.push({ id: idOf(vehicle.id, `${field}.id`, taken, traced), name: textOf(vehicle.name, `${field}.name`),
        about: boundedOf(textOf(vehicle.about, `${field}.about`), `${field}.about`, 60)!, facts: null,
        things: within(readThings(vehicle.things, `${field}.things`, labels, true, 1, true, value.hunger === true), MAX_IN_PLACE, `${field}.things`),
        open: vehicle.open === true, clock: false, crowd: null, figures: [], at: null, minutesTo: {}, nextDoor: [],
        vehicle: { at: vehicle.at as string, heading: null, faster: whole('faster', 30, 2), seats: whole('seats', bus.route ? 60 : 12, 1),
          drivers: ids('drivers', characters), reach: ids('reach', places) ?? places.map(place => place.id), ...bus } });
    }
  }
  const core = { title: textOf(value.title, 'title'), about: textOf(value.about, 'about'), facts: factsOf(value.facts, 'facts'), clock: value.clock,
    wordsPerMinute, remote: typeof value.remote === 'string' ? value.remote : null, touch: value.touch === true, marks: value.marks === true,
    ...(value.deedEnds === true ? { deedEnds: true as const } : {}), ...(value.ways === true ? { ways: true as const } : {}), ...(value.stableFirst === true ? { stableFirst: true as const } : {}), ...(value.fixedSchema === true ? { fixedSchema: true as const } : {}), ...(value.oneSchema === true ? { oneSchema: true as const } : {}), travelMinutes,
    walkMetresPerMinute, shortWords: countOf(value.shortWords, 'shortWords', 2000),
    longWords, places, characters, ...(value.vehicles === undefined ? {} : { vehicles }) };
  for (const [index, place] of vehicles.entries()) {
    const bus = place.vehicle!;
    if (!bus.route) continue;
    if (bus.fare && !all([...places.flatMap(place => place.things), ...vehicles.flatMap(place => place.things), ...characters.flatMap(person => person.carries)]).some(thing => thing.name === bus.fare!.name && thing.money)) return refuse(`vehicles[${index}].fare.name`, 'must name a counted thing of money');
    const times = bus.leaves!.map(secondsOfDay), gap = Math.min(...times.map((time, at) => (times[(at + 1) % times.length] - time + 86_400 - 1) % 86_400 + 1));
    if (busRound(core, bus).at(-1)!.at >= gap) return refuse(`vehicles[${index}].leaves`, 'the round must finish before the next leaving');
  }
  return core;
}

export const figuresOf = (world: World) => world.places.flatMap(place => place.figures);
export const namesOf = (world: World) => [...world.characters, ...figuresOf(world)];
