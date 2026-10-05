// The world of the `live` mode and its rules, with no model in them: named places, who is where, and a clock in whole
// seconds since the story's start. There is no map and nobody judges outcomes: the rules say only how long an action
// takes, who perceives it and when each character is free to act again.
import { boundedOf, amountOf, closed, countOf, cut, isObject, listOf, refuse, secondsOfDay, textOf, TIME, wordsOf } from './reading.ts';
import type { Sleep } from './sleep.ts';
import type { Weather } from './weather.ts';

export { CHARS_PER_WORD, cut, sizeOf, wordsOf, WorldError } from './reading.ts';

export const MAX_WORDS = 65;
export const MAX_SECONDS = 3600;
export const MAX_SLEEP = 43_200;
// The most words one `facts` of a world file may hold, so that the request to the world has a largest size.
export const MAX_FACTS = 300;
// What an answer that cannot be used becomes: a wait of this many seconds.
export const LOST_SECONDS = 30;

// `facts` is what is true of the world, of a place or of a person and is not seen at once. It is for the world's own
// answers to what people do and never for a character: no character is sent any of it.
// `things` is what lies in a place and can be moved, taken or changed. Of a person, `looks` is what anyone near sees
// and never changes, the body and the face and no clothes, `pose` how and where in the place it is, `holds` what is in its hands or worn, and `has`
// what it carries out of sight. The world file gives how these begin; `things`, `pose`, `holds` and `has` then belong
// to the run's state and change only by the world's answer to a deed. A place that is `open` lies under the open sky.
// `hidden` is what lies in a place and is not found without a search: each thing with the `minutes` one person must
// have searched the place to find it, or which a deed finds at once by going straight to the spot its text names.
// The world is told it apart from `things`, under its `id`, a label that is its number in the place's list.
// `crowd` is the people of a place whom nobody plays, as anyone there sees them, and `figures` those of them who
// have a name: each with `looks` and `facts` as a character has them, and with no sheet, memory or turn. A figure
// stays in its place and does nothing but answer a `say` addressed to it, in the words the world gives it.
// `at` is where a place lies, in metres east and north of any point the world file likes, or null.
// A place with a `clock` shows the time to everyone in it, and a character with one, a watch or a phone, reads it
// anywhere. Neither changes in a run: a clock is not yet a thing that can be handed over.
export type Figure = { id: string; name: string; looks: string | null; facts: string | null };
export type Place = { id: string; name: string; about: string; facts: string | null; things: string | null; hidden: Hidden[]; open: boolean; clock: boolean;
  crowd: string | null; figures: Figure[];
  at: [number, number] | null; minutesTo: { [place: string]: number } };
export type Hidden = { id: string; text: string; minutes: number };
export type Character = { id: string; name: string; place: string; sheet: string; facts: string | null; looks: string | null; pose: string | null;
  holds: string | null; has: string | null; clock: boolean };
// The most words each of these texts may hold, in the world file and in the world's answer alike.
export const LIMITS = { looks: 60, pose: 20, holds: 30, has: 60, things: 120, hidden: 60, crowd: 60 };
// One change the world's answer makes: the whole new text of what a person of the deed's place has, holds or how it
// is placed, or of the things of that place. An empty text means that nothing is left.
export type Change = { of: string; what: 'pose' | 'holds' | 'has' | 'things'; text: string };
const CHANGES = ['pose', 'holds', 'has', 'things'] as const;
// `remote` names the means by which people reach each other from afar; a world with null has none.
// `walkMetresPerMinute` is the pace at which everyone walks between places that say where they lie.
// `shortWords` and `longWords` are the sizes of a character's two memories, which `memory.ts` keeps. `sleep` and
// `weather` are the settings of the laws the clock drives (`laws.ts`), as the world file and its environment give them.
export type World = { title: string; about: string; facts: string | null; clock: string; wordsPerMinute: number; remote: string | null;
  travelMinutes: number; walkMetresPerMinute: number; shortWords: number; longWords: number; sleep: Sleep; weather: Weather | null; places: Place[]; characters: Character[] };

export type Kind = 'say' | 'call' | 'go' | 'do' | 'wait' | 'sleep';
// One answer of a character, as the schema asks for it: every field is there and an unused one is null. `to` is the
// character a `call` reaches, or the figure of the speaker's place a `say` is addressed to.
// `do`, `wait` and `sleep` last `seconds`, or `until` the next moment the clock shows that time of day, `HH:MM`.
export type Action = { action: Kind; text: string | null; to: string | null; place: string | null; seconds: number | null; until: string | null;
  note: string | null };
// Why an answer could not be used as an action: it was not a JSON object, named no action, lacked its text, called
// nobody who can be called, led to the place the character is in or to no place, or lasted no time the action allows;
// or it never arrived whole, because the model wrote on to the limit of one answer (`long`).
export const REFUSALS = ['json', 'action', 'text', 'to', 'here', 'place', 'time', 'long'] as const;
export type Refusal = typeof REFUSALS[number];
export const isRefusal = (value: unknown): value is Refusal => REFUSALS.some(reason => reason === value);
// `place` is where it happened; `to` is the character called, the figure spoken to, or the place a `go` leads to; `heard` holds the ids of
// those who perceived it when it happened, without the one who did it. A `memory` is a character's long-term text
// written anew, which nobody else perceives: `text` is the new text, or null when the rewrite was lost.
// A `result` is the world's answer to the `do` before it, of the same `who`: `text` is what came of the deed, or null
// when nothing did that could be noticed, and `wakes` and `changes`, the sleepers the deed
// wakes and what it changes of bodies and belongings, which a result and a reply have. A `reply` is what a figure
// answers to the `say` before it: `who` is the figure, `to` the speaker, `text` its words, or null when it says
// nothing, and `seconds` how long they take from the end of that `say`. A `weather` is a change of the weather, which nobody does and
// which has no place: `who` and `place` are empty, `text` is the new weather under the open sky and `indoors`, which
// only this kind has, what of it reaches someone under a roof, or null. A result also says whether the world called
// the deed a `search` of the place, which hidden things it says the deed went straight to, `finds`, and what hidden
// things were `found` by it either way.
export type Event = { at: number; clock: string; kind: Kind | 'arrive' | 'wake' | 'memory' | 'result' | 'reply' | 'weather'; who: string; place: string; to: string | null;
  text: string | null; seconds: number; cut: boolean; heard: string[]; note: string | null; wakes?: string[]; changes?: Change[];
  indoors?: string | null; search?: boolean; finds?: string[]; found?: string[] };
// A character in the run. On the way it is in no place and `heading` names where it will arrive; asleep it stays in
// its place. `speaking` and `listening` are the ends of its own last speech and of the latest speech it heard; `began`
// is the start of its own last action.
// `pose`, `holds` and `has` are its body and belongings as they are now.
export type Person = { id: string; place: string | null; heading: string | null; asleep: boolean; freeAt: number; began: number | null;
  speaking: number; listening: number; pose: string | null; holds: string | null; has: string | null };

const ID = /^[A-Za-z][\w-]{0,39}$/;
const factsOf = (value: unknown, field: string) => boundedOf(value, field, MAX_FACTS);
function idOf(value: unknown, field: string, taken: string[]): string {
  if (typeof value !== 'string' || !ID.test(value)) return refuse(field, 'must be a short id of Latin letters, digits, `_` and `-`');
  return taken.includes(value) ? refuse(field, 'repeats an id') : value;
}

// A world file as it was parsed from JSON, without the settings of the laws, which `readWorld` of `laws.ts` adds.
// The first thing wrong is one sentence that names the field.
export function readCore(value: unknown): Omit<World, 'sleep' | 'weather'> {
  if (!isObject(value)) return refuse('the file', 'must be a JSON object');
  if (typeof value.clock !== 'string' || !TIME.test(value.clock)) return refuse('clock', 'must be a time of day like `21:00`');
  if (value.remote !== undefined && value.remote !== null) textOf(value.remote, 'remote');
  const places: Place[] = [];
  for (const [index, place] of listOf(value.places, 'places').entries()) {
    const field = `places[${index}]`;
    if (!isObject(place)) return refuse(field, 'must be an object');
    if (place.open !== undefined && typeof place.open !== 'boolean') return refuse(`${field}.open`, 'must be true or false');
    if (place.clock !== undefined && typeof place.clock !== 'boolean') return refuse(`${field}.clock`, 'must be true or false');
    if (place.minutesTo !== undefined && !isObject(place.minutesTo)) return refuse(`${field}.minutesTo`, 'must be an object');
    if (place.hidden !== undefined && !Array.isArray(place.hidden)) return refuse(`${field}.hidden`, 'must be a list');
    const hidden = ((place.hidden ?? []) as unknown[]).map((thing, at) => {
      if (!isObject(thing)) return refuse(`${field}.hidden[${at}]`, 'must be an object');
      return { id: `h${at + 1}`, text: boundedOf(textOf(thing.text, `${field}.hidden[${at}].text`), `${field}.hidden[${at}].text`, LIMITS.hidden) as string,
        minutes: amountOf(thing.minutes ?? null, `${field}.hidden[${at}].minutes`, 0) };
    });
    if (place.figures !== undefined && !Array.isArray(place.figures)) return refuse(`${field}.figures`, 'must be a list');
    const figures = ((place.figures ?? []) as unknown[]).map((figure, at): Figure => {
      const name = `${field}.figures[${at}]`;
      if (!isObject(figure)) return refuse(name, 'must be an object');
      return { id: figure.id as string, name: textOf(figure.name, `${name}.name`), looks: boundedOf(figure.looks, `${name}.looks`, LIMITS.looks),
        facts: factsOf(figure.facts, `${name}.facts`) };
    });
    const at = place.at === undefined || place.at === null ? null : place.at;
    if (at !== null && !(Array.isArray(at) && at.length === 2 && at.every(part => typeof part === 'number' && Number.isFinite(part)))) {
      return refuse(`${field}.at`, 'must be two numbers, the metres east and north');
    }
    const minutesTo: { [place: string]: number } = {};
    for (const [to, minutes] of Object.entries(place.minutesTo ?? {})) minutesTo[to] = amountOf(minutes ?? null, `${field}.minutesTo.${to}`, 0);
    places.push({ id: idOf(place.id, `${field}.id`, places.map(known => known.id)), name: textOf(place.name, `${field}.name`),
      about: textOf(place.about, `${field}.about`), facts: factsOf(place.facts, `${field}.facts`),
      things: boundedOf(place.things, `${field}.things`, LIMITS.things), hidden, open: place.open === true, clock: place.clock === true,
      crowd: boundedOf(place.crowd, `${field}.crowd`, LIMITS.crowd), figures, at: at as [number, number] | null, minutesTo });
  }
  for (const [index, place] of places.entries()) {
    const unknown = Object.keys(place.minutesTo).find(to => to === place.id || !places.some(known => known.id === to));
    if (unknown !== undefined) return refuse(`places[${index}].minutesTo.${unknown}`, 'must name another place of the list');
  }
  const characters: Character[] = [];
  for (const [index, character] of listOf(value.characters, 'characters').entries()) {
    const field = `characters[${index}]`;
    if (!isObject(character)) return refuse(field, 'must be an object');
    if (!places.some(place => place.id === character.place)) return refuse(`${field}.place`, 'must name a place of the list');
    if (character.clock !== undefined && typeof character.clock !== 'boolean') return refuse(`${field}.clock`, 'must be true or false');
    characters.push({ id: idOf(character.id, `${field}.id`, characters.map(known => known.id)), name: textOf(character.name, `${field}.name`),
      place: character.place as string, sheet: textOf(character.sheet, `${field}.sheet`), facts: factsOf(character.facts, `${field}.facts`),
      looks: boundedOf(character.looks, `${field}.looks`, LIMITS.looks), pose: boundedOf(character.pose, `${field}.pose`, LIMITS.pose),
      holds: boundedOf(character.holds, `${field}.holds`, LIMITS.holds), has: boundedOf(character.has, `${field}.has`, LIMITS.has),
      clock: character.clock === true });
  }
  // An id names one thing: a figure's is no place's, no character's and no other figure's.
  const taken = [...places, ...characters].map(known => known.id);
  for (const [index, place] of places.entries()) {
    for (const [at, figure] of place.figures.entries()) taken.push(idOf(figure.id, `places[${index}].figures[${at}].id`, taken));
  }
  return { title: textOf(value.title, 'title'), about: textOf(value.about, 'about'), facts: factsOf(value.facts, 'facts'), clock: value.clock,
    wordsPerMinute: amountOf(value.wordsPerMinute, 'wordsPerMinute', 130), remote: typeof value.remote === 'string' ? value.remote : null,
    travelMinutes: amountOf(value.travelMinutes, 'travelMinutes', 5),
    walkMetresPerMinute: amountOf(value.walkMetresPerMinute, 'walkMetresPerMinute', 80), shortWords: countOf(value.shortWords, 'shortWords', 2000),
    longWords: countOf(value.longWords, 'longWords', 400), places, characters };
}

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
function lasting(world: World, actor: Person, kind: 'do' | 'wait' | 'sleep', now: number, until: string): number {
  const span = secondsUntil(world, now, until);
  if (hasClock(world, actor.id, actor.place)) return span;
  const { part, most } = DRIFT[kind], off = Math.min(Math.floor(span / part), most);
  let mixed = 2166136261;
  for (const letter of `${actor.id} ${now} ${until}`) mixed = Math.imul(mixed ^ letter.codePointAt(0)!, 16777619) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846CA68B) >>> 0;
  return Math.max(1, Math.min(kind === 'sleep' ? MAX_SLEEP : MAX_SECONDS, span - off + ((mixed ^ (mixed >>> 16)) >>> 0) % (2 * off + 1)));
}

// Everyone with a name whom nobody plays, and everyone a line may name: the characters and those.
export const figuresOf = (world: World) => world.places.flatMap(place => place.figures);
export const namesOf = (world: World) => [...world.characters, ...figuresOf(world)];

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

// What lies in the places of a run: the things of each, what is still hidden in each, and the seconds each person has
// searched each place, under the person's id and the place's.
export type Lying = { things: Map<string, string | null>; hidden: Map<string, Hidden[]>; searched: Map<string, number> };
// What lies in each place when the story starts, and nobody has searched anywhere.
export const lying = (world: World): Lying => ({ things: new Map(world.places.map(place => [place.id, place.things])),
  hidden: new Map(world.places.map(place => [place.id, place.hidden])), searched: new Map() });
// What of the hidden things of a deed's place the deed finds if the world says it is a search, and what such a
// search leaves: a thing is found when the doer's searches of the place, this deed with them, have lasted its minutes.
export function sought(lies: Lying, deed: Event): { found: Hidden[]; left: Hidden[] } {
  const seconds = (lies.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds, hidden = lies.hidden.get(deed.place)!;
  return { found: hidden.filter(thing => seconds >= thing.minutes * 60), left: hidden.filter(thing => seconds < thing.minutes * 60) };
}
// Everyone begins awake, placed, holding and carrying what the world file says.
export const start = (world: World): Person[] => world.characters.map(({ id, place, pose, holds, has }) =>
  ({ id, place, pose, holds, has, heading: null, asleep: false, freeAt: 0, began: null, speaking: 0, listening: 0 }));

// The next to play: the one free first, then the one whose own last action began earliest, then the world file's order.
export const next = (people: Person[]): Person => people.reduce((first, person) =>
  person.freeAt < first.freeAt || (person.freeAt === first.freeAt && (person.began ?? -1) < (first.began ?? -1)) ? person : first);

// The moment of the story `at` seconds from its start, as seconds since the midnight before the start.
const sinceMidnight = (world: World, at: number) => secondsOfDay(world.clock) + at;
// The seconds from `at` to the next moment the story's clock shows the time of day `until`, a whole day when it shows it now.
export function secondsUntil(world: World, at: number, until: string): number {
  return (secondsOfDay(until) - sinceMidnight(world, at) % 86_400 + 86_400 - 1) % 86_400 + 1;
}

// A character's answer as an action it can take now, or the reason why it cannot be used. A field the action does not
// use is dropped whatever it held, and of `until` and `seconds` only one is kept: `until` when it was given. A text
// becomes one line; a note and what a `do` describes keep their first `MAX_WORDS` words, and a speech is cut when it
// is made, at that turn's limit. The actor's `freeAt` is the moment of the turn.
export function readAction(world: World, actor: Person, answer: string): Action | Refusal {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return 'json';
  }
  if (!isObject(value)) return 'json';
  const line = (field: unknown) => typeof field === 'string' && field.trim() ? wordsOf(field).join(' ') : null;
  const short = (field: unknown) => { const whole = line(field); return whole === null ? null : cut(whole, MAX_WORDS).text || null; };
  const text = line(value.text);
  const none = { text: null, to: null, place: null, seconds: null, until: null, note: short(value.note) };
  // How long the action lasts, as the field that says it, or null when that is no span of 1 to `most` seconds.
  const span = (most: number): { seconds: number | null; until: string | null } | null => {
    const within = (seconds: unknown) => typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= most;
    if (value.until === undefined || value.until === null || (typeof value.until === 'string' && !value.until.trim())) return within(value.seconds) ? { seconds: value.seconds as number, until: null } : null;
    const time = typeof value.until === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.until.trim()) : null;
    const until = time ? `${time[1].padStart(2, '0')}:${time[2]}` : null;
    return until && within(secondsUntil(world, actor.freeAt, until)) ? { seconds: null, until } : null;
  };
  // A `say` is addressed only to a figure of the place the speaker is in; any other `to` is dropped.
  const figure = world.places.find(place => place.id === actor.place)?.figures.find(item => item.id === value.to)?.id ?? null;
  if (value.action === 'say') return text ? { ...none, action: 'say', text, to: figure } : 'text';
  if (value.action === 'call') {
    const known = world.remote !== null && value.to !== actor.id && world.characters.some(character => character.id === value.to);
    return !known ? 'to' : text ? { ...none, action: 'call', text, to: value.to as string } : 'text';
  }
  if (value.action === 'go') {
    if (value.place === actor.place) return 'here';
    return world.places.some(place => place.id === value.place) ? { ...none, action: 'go', place: value.place as string } : 'place';
  }
  if (value.action === 'do') {
    const done = short(text), lasts = span(MAX_SECONDS);
    return !done ? 'text' : lasts ? { ...none, ...lasts, action: 'do', text: done } : 'time';
  }
  if (value.action === 'wait' || value.action === 'sleep') {
    const lasts = span(value.action === 'wait' ? MAX_SECONDS : MAX_SLEEP);
    return lasts ? { ...none, ...lasts, action: value.action } : 'time';
  }
  return 'action';
}

// Someone spoke, came or left near this character, or the weather changed over it: its wait or its activity ends. It is free now, or when its own
// speech and the speech it is hearing have ended.
export const attend = (person: Person, now: number) => { person.freeAt = Math.max(now, person.speaking, person.listening); };

// Those who perceive what happens in a place: everyone there who is awake.
export const awakeIn = (people: Person[], place: string, but: Person) => people.filter(person => person !== but && person.place === place && !person.asleep);

// One action of a character in a place, at `now`: the event, with the actor and those who perceive it moved on.
// `limit` is the number of words a speech may hold this turn; a longer one is cut there.
export function apply(world: World, people: Person[], actor: Person, action: Action, now: number, limit: number): Event {
  const place = actor.place as string;
  const here = awakeIn(people, place, actor);
  const event: Event = { at: now, clock: clockAt(world, now), kind: action.action, who: actor.id, place, to: null, text: action.text,
    seconds: action.until === null ? action.seconds ?? 0 : lasting(world, actor, action.action as 'do' | 'wait' | 'sleep', now, action.until), cut: false,
    heard: here.map(person => person.id),
    note: action.note };
  actor.began = now;
  if (action.action === 'say' || action.action === 'call') {
    Object.assign(event, cut(action.text as string, limit));
    event.seconds = speechSeconds(world, wordsOf(event.text as string).length);
    if (action.action === 'say') event.to = action.to;
    const listeners = [...here];
    const callee = people.find(person => person.id === action.to);
    if (action.action === 'call' && callee) {
      event.to = callee.id;
      // A call to someone on the way or asleep is not heard now: it waits for the arrival or the waking.
      if (callee.place !== null && !callee.asleep && !here.includes(callee)) listeners.push(callee);
    }
    event.heard = people.filter(person => listeners.includes(person)).map(person => person.id);
    // Speech holds its listeners until it ends.
    for (const listener of listeners) {
      listener.listening = Math.max(listener.listening, now + event.seconds);
      attend(listener, now);
    }
    actor.speaking = now + event.seconds;
  } else if (action.action === 'go') {
    event.to = action.place;
    event.seconds = travelSeconds(world, place, action.place as string);
    for (const witness of here) attend(witness, now);
    // Whoever leaves is no longer placed as it was.
    Object.assign(actor, { place: null, heading: action.place, pose: null });
  } else if (action.action === 'wait') event.heard = [];
  else if (action.action === 'sleep') actor.asleep = true;
  // A `do`, and a falling asleep, are left: they are seen and interrupt nobody, and a witness learns of them at its
  // own next turn. Otherwise every gesture in a room would cost one call to the model for each person who waits there.
  actor.freeAt = now + event.seconds;
  return event;
}

// A traveller whose turn has come at its arrival time is put in the destination. The event is the arrival as those
// there see it.
export function arrive(world: World, people: Person[], traveller: Person, now: number): Event {
  const place = traveller.heading as string;
  const here = awakeIn(people, place, traveller);
  for (const witness of here) attend(witness, now);
  Object.assign(traveller, { place, heading: null });
  return { at: now, clock: clockAt(world, now), kind: 'arrive', who: traveller.id, place, to: null, text: null, seconds: 0, cut: false,
    heard: here.map(person => person.id), note: null };
}

// A sleeper whose sleep has run out wakes where it lay. Those there see it and nobody is interrupted.
export function wake(world: World, people: Person[], sleeper: Person, now: number): Event {
  const place = sleeper.place as string;
  sleeper.asleep = false;
  return { at: now, clock: clockAt(world, now), kind: 'wake', who: sleeper.id, place, to: null, text: null, seconds: 0, cut: false,
    heard: awakeIn(people, place, sleeper).map(person => person.id), note: null };
}

// The world's answer to a deed as it can be taken, or null when it cannot be used. `text` becomes one line of
// `MAX_WORDS` words at most, and null when there is nothing in it; of `wakes` only the ids in `sleepers` are kept,
// each once, in their order.
// Of `changes` only those are kept that name a person in `present`, or `place` for its things; each text becomes
// one line cut at its limit, and of two changes of one thing the later counts. `search` is true only when the answer
// says so, and of `finds` only the labels in `hidden` are kept, each once, in their order.
export function readResult(answer: string, sleepers: string[], present: string[], place: string, hidden: string[]): { text: string | null; wakes: string[]; changes: Change[]; search: boolean;
  finds: string[] } | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  if (!isObject(value) || (value.result !== null && typeof value.result !== 'string') || !Array.isArray(value.wakes) || !Array.isArray(value.changes)) return null;
  const named: unknown[] = value.wakes, given: unknown[] = value.changes;
  const changes = new Map<string, Change>();
  for (const change of given) {
    if (!isObject(change) || typeof change.text !== 'string') continue;
    const what = CHANGES.find(kind => kind === change.what), of = (what === 'things' ? [place] : present).find(id => id === change.of);
    if (!what || !of) continue;
    changes.delete(`${what} ${of}`);
    changes.set(`${what} ${of}`, { of, what, text: cut(wordsOf(change.text).join(' '), LIMITS[what]).text });
  }
  return { text: cut(wordsOf(value.result ?? '').join(' '), MAX_WORDS).text || null, wakes: sleepers.filter(id => named.includes(id)), changes: [...changes.values()],
    search: value.search === true, finds: hidden.filter(id => Array.isArray(value.finds) && value.finds.includes(id)) };
}

// The world's answer for a figure as it can be taken, or null when it cannot be used: `reply` becomes one line of
// `MAX_WORDS` words at most, or null when the figure says nothing, and `changes` are read as a deed's are.
export function readReply(answer: string, present: string[], place: string): { text: string | null; changes: Change[] } | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  if (!isObject(value) || (value.reply !== null && typeof value.reply !== 'string')) return null;
  const read = readResult(JSON.stringify({ result: null, wakes: [], changes: value.changes }), [], present, place, []);
  return read && { text: cut(wordsOf(value.reply ?? '').join(' '), MAX_WORDS).text || null, changes: read.changes };
}

// A figure's answer to a `say` takes effect. Its words begin when the speech ends and hold the speaker and everyone
// who heard the speech as speech does; nobody asleep is woken by them. Its changes are a deed's. The event stands at
// the moment of the speech, as a result stands at its deed's, so that the journal's time never goes back.
export function reply(world: World, people: Person[], lies: Lying, said: Event, text: string | null, changes: Change[]): Event {
  for (const change of changes) {
    if (change.what === 'things') lies.things.set(change.of, change.text || null);
    else people.find(person => person.id === change.of)![change.what] = change.text || null;
  }
  const seconds = text === null ? 0 : speechSeconds(world, wordsOf(text).length), end = said.at + said.seconds + seconds;
  const hearers = text === null ? [] : people.filter(person => person.id === said.who || said.heard.includes(person.id));
  for (const hearer of hearers) {
    hearer.listening = Math.max(hearer.listening, end);
    attend(hearer, said.at);
  }
  return { at: said.at, clock: said.clock, kind: 'reply', who: said.to as string, place: said.place, to: said.who, text, seconds, cut: false,
    heard: hearers.map(person => person.id), note: null, changes };
}

// The world's answer to a deed takes effect: each sleeper it wakes has its sleep end when the deed ends, at `end`.
// The waking itself comes at that sleeper's turn, as every waking does. Those awake in the place perceive the answer.
// Its changes replace what the people of the place have, hold and how they are placed, and the things lying there.
// A deed the world calls a search counts towards its doer's search of the place and finds what that search has
// lasted long enough for; `finds` are the hidden things the world says the deed went straight to. What is found
// either way is hidden no longer, for anyone: it is among the things of the place, at their end and within their
// limit, unless the answer wrote those things anew, which then says where it went.
export function result(world: World, people: Person[], lies: Lying, deed: Event, text: string | null, wakes: string[], changes: Change[], search: boolean,
  finds: string[]): Event {
  const doer = people.find(person => person.id === deed.who)!, { things } = lies;
  const timed = search ? sought(lies, deed).found : [], hidden = lies.hidden.get(deed.place)!;
  const found = hidden.filter(thing => timed.includes(thing) || finds.includes(thing.id)), left = hidden.filter(thing => !found.includes(thing));
  if (search) lies.searched.set(`${deed.who} ${deed.place}`, (lies.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds);
  lies.hidden.set(deed.place, left);
  if (found.length && !changes.some(change => change.what === 'things')) {
    things.set(deed.place, cut([things.get(deed.place), ...found.map(thing => thing.text)].filter(part => part !== null).map(part => closed(part as string)).join(' '), LIMITS.things).text);
  }
  for (const change of changes) {
    if (change.what === 'things') things.set(change.of, change.text || null);
    else people.find(person => person.id === change.of)![change.what] = change.text || null;
  }
  for (const sleeper of people) if (wakes.includes(sleeper.id)) sleeper.freeAt = Math.min(sleeper.freeAt, deed.at + deed.seconds);
  return { at: deed.at, clock: deed.clock, kind: 'result', who: deed.who, place: deed.place, to: null, text, seconds: 0, cut: false,
    heard: text === null ? [] : awakeIn(people, deed.place, doer).map(person => person.id), note: null, wakes, changes, search, finds, found: found.map(thing => thing.text) };
}

