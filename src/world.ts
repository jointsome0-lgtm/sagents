// The world of the `live` mode as its file gives it and as a run holds it, with no model in it: named places, who is
// where, and the events of a run. The rules are next to it: the clock and the distances in `time.ts`, what a
// resident does in `action.ts`, and what the world answers to a deed or for a figure in `answer.ts`.
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
// The most words of what a speaker's body does meanwhile, and of the words said aloud with a deed.
export const GESTURE_WORDS = 12, SAYS_WORDS = 20;
export const MAX_SECONDS = 3600;
export const MAX_SLEEP = 43_200;
// What an answer that cannot be used becomes: a wait of this many seconds.
export const LOST_SECONDS = 30;

// `facts` is what is true of the world, of a place, of a person or of a thing and is not seen at once. It is for the
// world's own answers to what people do and never for a character: no character is sent any of it.
// `things` are the records of what stands and lies in a place, and `carries` those of what a person has in hand or
// wears, each with all that it holds (`things.ts`). Of a person, `looks` is what anyone near sees and never changes,
// the body and the face and no clothes, and `pose` how and where in the place it is. The world file gives how these
// begin; the things and the pose then belong to the run's state and change only by the world's answer. A thing of a
// place that is `hidden` is not found without a search of its minutes, or by a deed that goes straight to its spot.
// `memory` is what a person remembers when the story begins: what it owes and is owed today, where things lie. The
// sheet says who the person is, and this text ages as a memory does. A place that is `open` lies under the open sky.
// `crowd` is the people of a place whom nobody plays, as anyone there sees them, and `figures` those of them who
// have a name: each with `looks` and `facts` as a character has them, and with no sheet, memory or turn. A figure
// stays in its place and does nothing but answer a `say` addressed to it, in the words the world gives it.
// `at` is where a place lies, in metres east and north of any point the world file likes, or null. `nextDoor` holds
// the ids of the places that share a door or a thin wall with it, whichever of the two the world file lists it at.
// A place with a `clock` shows the time to everyone in it, and a character with one, a watch or a phone, reads it
// anywhere. Neither changes in a run: a clock is not yet a thing that can be handed over.
// `traces` is what is seen on a person's body or clothes for the time being, each text what it is and exactly where:
// a smear of food, a stain, wet hair. The world file gives how they begin, and they then belong to the run's state
// (`answer.ts`): one stays on its person, wherever that person goes, until the world's answer to a deed takes it off.
// A world in which no character has the field, null here, keeps no traces at all; an empty list turns them on.
export type Figure = { id: string; name: string; looks: string | null; facts: string | null };
export type Vehicle = { at: string | null; heading: { from: string; to: string; at: number } | null; faster: number; seats: number; drivers: string[] | null; reach: string[];
  route?: string[]; leaves?: string[]; stands?: number; fare?: { name: string; n: number }; departure?: { to: string; at: number } };
export type Place = { id: string; name: string; about: string; facts: string | null; things: Thing[]; open: boolean; clock: boolean;
  crowd: string | null; figures: Figure[];
  at: [number, number] | null; minutesTo: { [place: string]: number }; nextDoor: string[]; vehicle?: Vehicle };
export type Character = { id: string; name: string; place: string; sheet: string; memory: string | null; facts: string | null; looks: string | null; pose: string | null;
  carries: Thing[]; clock: boolean; marks: Given[]; traces: string[] | null };
// The most words each of these texts may hold, in the world file and in the world's answer alike; `feels` is of one
// line of what a deed makes a body feel, `beyond` of what of a deed is heard next door and `touch` of with what and
// where one person touches another, which only an answer holds.
// `trace` is of one trace, and a person has `MAX_TRACES` of them at most.
export const LIMITS = { looks: 60, pose: 20, feels: 20, beyond: 20, crowd: 60, touch: 15, trace: 12 };
export const MAX_TRACES = 8;
// A trace as it is kept: one line, with no stop at its end, since a request lists several in one sentence.
export const traceOf = (text: string) => wordsOf(text).join(' ').replace(/[.;]+$/, '');
// `remote` names the means by which people reach each other from afar; a world with null has none.
// `walkMetresPerMinute` is the pace at which everyone walks between places that say where they lie.
// `shortWords` and `longWords` are the sizes of a character's two memories, which `memory.ts` keeps. `sleep` and
// `weather` are the settings of the laws the clock drives (`laws.ts`), as the world file and its environment give them.
// `hunger` is the world file's setting for both hunger and thirst, kept from the things its deeds eat and drink.
// `touch` says that a touch between two people is kept as state (`touch.ts`); a world without it has none.
// `marks` says that a lasting feeling of a part of a body is kept as state (`marks.ts`), and only in such a world may
// a character begin with some, its own `marks`. A `result` there also has `lingers`, the entries about them as read.
// `ways` lets the world name where a deed leads, which a result keeps as `goes`; the rules take its go at the doer's next free moment.
export type World = { title: string; about: string; facts: string | null; clock: string; wordsPerMinute: number; remote: string | null; touch: boolean; marks: boolean; ways?: true; hunger?: true;
  vehicles?: Place[]; travelMinutes: number; walkMetresPerMinute: number; shortWords: number; longWords: number; sleep: Sleep; weather: Weather | null; places: Place[]; characters: Character[] };

export type Kind = 'say' | 'call' | 'go' | 'do' | 'wait' | 'sleep';
// `place` is where it happened; `to` is the character called, the figure spoken to, or the place a `go` leads to; `heard` holds the ids of
// those who perceived it when it happened, without the one who did it. A `memory` is a character's long-term text
// written anew, which nobody else perceives: `text` is the new text, or null when the rewrite was lost.
// `gesture`, which only a `say` may have, is what the speaker's face, hands or body did meanwhile, as those in `heard` saw it; `says`, which only a
// `do` may have, the words said aloud with the deed, which those in `heard` heard as a speech of that moment, and `cut` then says that they were cut at the turn's limit.
// A `result` is the world's answer to the `do` before it, of the same `who`: `text` is what came of the deed, or null
// when nothing did that could be noticed, `wakes` the sleepers the deed wakes, `poses` the poses it changed and
// `feels` what the deed makes a body feel, each line for its owner alone and never part of what those in `heard`
// perceive. `beyond` is what of the deed is heard in the places next door, or null, and `nearby` those awake there, who
// are told it and nothing else of the deed. It says whether the world called the deed a `search` of the place and which hidden things it says the deed went
// straight to, `finds`. What the rules made of the answer is in `moved`, one posting for each thing that went from
// one holder to another or out of the world, where an `eaten` one is eaten by `who`; in `set`, the things put into
// another state; and in `found`, the hidden things found either way. A `reply` is what a figure answers to the `say`
// before it: `who` is the figure, `to` the speaker, `text` its words, or null when it says nothing, `seconds` how
// long they take from the end of that `say`, and `moved` what changed hands with them. In a world with `touch` a
// `result` also has `touches`, the touches that the deed began, changed or ended, as they were read. In a world that keeps traces a
// `result` also has `traced`, the traces the answer left, each under its new label, and `wiped`, those it took off. A `weather` is a change of the
// weather, which nobody does and which has no place: `who` and `place` are empty, `text` is the new weather under the
// open sky and `indoors`, which only this kind has, what of it reaches someone under a roof, or null.
// In a world with `ways`, a result has `goes`, its doer's way or null, and the action it brings has `fromDeed`,
// the result record's number, also when that action is refused. Neither adds a line that anyone reads.
export type Event = { at: number; clock: string; kind: Kind | 'drive' | 'park' | 'arrive' | 'wake' | 'memory' | 'result' | 'reply' | 'weather'; who: string; place: string; to: string | null;
  text: string | null; seconds: number; cut: boolean; heard: string[]; note: string | null; gesture?: string; says?: string; wakes?: string[];
  transfer?: true; from?: string; arrival?: number; indoors?: string | null; search?: boolean; finds?: string[]; moved?: Posting[]; set?: { what: string; name: string; state: string }[];
  poses?: { of: string; text: string }[]; feels?: { of: string; text: string }[]; beyond?: string | null; nearby?: string[]; found?: { what: string; name: string; spot: string }[]; touches?: Change[]; lingers?: Lingering[];
  traced?: Mark[]; wiped?: Mark[]; goes?: string | null; fromDeed?: number };
// A trace with its label and the person it is on.
export type Mark = { of: string; label: string; text: string };
// A character in the run. On the way it is in no place and `heading` names where it will arrive; asleep it stays in
// its place. `speaking` and `listening` are the ends of its own last speech and of the latest speech it heard; `began`
// is the start of its own last action. `pose` is how it is placed now.
export type Person = { id: string; place: string | null; heading: string | null; asleep: boolean; freeAt: number; began: number | null;
  speaking: number; listening: number; passageUntil?: number; pose: string | null };

const ID = /^[A-Za-z][\w-]{0,39}$/;
const factsOf = (value: unknown, field: string) => boundedOf(value, field, MAX_FACTS);
// An id names one thing: a place's, a character's and a figure's are all different, since the rules keep the things
// of a place and of a person, and take the `to` of a move, under them alike. None is what the rules themselves name
// there: a way out of the world, a thing's label, or a name that every object of the language has. In a world that
// keeps traces, `traced`, none is a label of a trace either.
function idOf(value: unknown, field: string, taken: string[], traced: boolean): string {
  if (typeof value !== 'string' || !ID.test(value)) return refuse(field, 'must be a short id of Latin letters, digits, `_` and `-`');
  if (traced && /^m\d+$/.test(value)) return refuse(field, 'must not be a label of a trace like `m7`, in a world whose characters have `traces`');
  if (SINKS.includes(value) || /^t\d+$/.test(value) || value in {}) return refuse(field, 'must not be `eaten`, `burned`, a label of a thing like `t7` or a name every object has like `constructor`');
  if (taken.includes(value)) return refuse(field, 'repeats an id');
  taken.push(value);
  return value;
}

// A world file as it was parsed from JSON, without the settings of the laws, which `readWorld` of `laws.ts` adds.
// The first thing wrong is one sentence that names the field.
export function readCore(value: unknown): Omit<World, 'sleep' | 'weather' | 'hunger'> {
  if (!isObject(value)) return refuse('the file', 'must be a JSON object');
  if (typeof value.clock !== 'string' || !TIME.test(value.clock)) return refuse('clock', 'must be a time of day like `21:00`');
  if (value.remote !== undefined && value.remote !== null) textOf(value.remote, 'remote');
  const walkMetresPerMinute = amountOf(value.walkMetresPerMinute, 'walkMetresPerMinute', 80);
  const wordsPerMinute = amountOf(value.wordsPerMinute, 'wordsPerMinute', 130), travelMinutes = amountOf(value.travelMinutes, 'travelMinutes', 5);
  durationOf(Math.max(2, Math.ceil(MAX_WORDS / wordsPerMinute * 60)), 'wordsPerMinute');
  durationOf(Math.max(1, Math.round(travelMinutes * 60)), 'travelMinutes');
  if (value.touch !== undefined && typeof value.touch !== 'boolean') return refuse('touch', 'must be true or false');
  if (value.ways !== undefined && typeof value.ways !== 'boolean') return refuse('ways', 'must be true or false');
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
    // What the rules read as texts before they kept things as records is refused, so that no thing is lost unseen.
    if (place.hidden !== undefined) return refuse(`${field}.hidden`, 'is no longer read: a hidden thing is one of `things` with `hidden`');
    if (place.figures !== undefined && !Array.isArray(place.figures)) return refuse(`${field}.figures`, 'must be a list');
    const figures = ((place.figures ?? []) as unknown[]).map((figure, at): Figure => {
      const name = `${field}.figures[${at}]`;
      if (!isObject(figure)) return refuse(name, 'must be an object');
      return { id: figure.id as string, name: textOf(figure.name, `${name}.name`), looks: boundedOf(figure.looks, `${name}.looks`, LIMITS.looks),
        facts: factsOf(figure.facts, `${name}.facts`) };
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
  // Two places are next door to each other whichever of them lists the other.
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
      clock: character.clock === true, traces, marks: readGiven(character.marks, `${field}.marks`) });
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
    ...(value.ways === true ? { ways: true as const } : {}), travelMinutes,
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

// Everyone with a name whom nobody plays, and everyone a line may name: the characters and those.
export const figuresOf = (world: World) => world.places.flatMap(place => place.figures);
export const namesOf = (world: World) => [...world.characters, ...figuresOf(world)];
