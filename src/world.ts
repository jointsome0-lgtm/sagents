// The world of the `live` mode and its rules, with no model in them: named places, who is where, and a clock in whole
// seconds since the story's start. There is no map and nobody judges outcomes: the rules say only how long an action
// takes, who perceives it and when each character is free to act again.
export const MAX_WORDS = 65;
export const MAX_SECONDS = 3600;
export const MAX_SLEEP = 43_200;
// A text of so many words holds at most this many characters for each of them, so that a limit in words is a limit
// in characters too, whatever a model writes.
export const CHARS_PER_WORD = 10;
// What an answer that cannot be used becomes: a wait of this many seconds.
export const LOST_SECONDS = 30;

// The sentences about a world file that cannot be used; they are this file's own and may be shown.
export class WorldError extends Error {}

export type Place = { id: string; name: string; about: string; minutesTo: { [place: string]: number } };
export type Character = { id: string; name: string; place: string; sheet: string };
// `remote` names the means by which people reach each other from afar; a world with null has none.
// `shortWords` and `longWords` are the sizes of a character's two memories, which `memory.ts` keeps.
export type World = { title: string; about: string; clock: string; wordsPerMinute: number; remote: string | null;
  travelMinutes: number; shortWords: number; longWords: number; places: Place[]; characters: Character[] };

export type Kind = 'say' | 'call' | 'go' | 'do' | 'wait' | 'sleep';
// One answer of a character, as the schema asks for it: every field is there and an unused one is null.
// `do`, `wait` and `sleep` last `seconds`, or `until` the next moment the clock shows that time of day, `HH:MM`.
export type Action = { action: Kind; text: string | null; to: string | null; place: string | null; seconds: number | null; until: string | null;
  note: string | null };
// Why an answer could not be used as an action: it was not a JSON object, named no action, lacked its text, called
// nobody who can be called, led to the place the character is in or to no place, or lasted no time the action allows.
export const REFUSALS = ['json', 'action', 'text', 'to', 'here', 'place', 'time'] as const;
export type Refusal = typeof REFUSALS[number];
export const isRefusal = (value: unknown): value is Refusal => REFUSALS.some(reason => reason === value);
// `place` is where it happened; `to` is the character called, or the place a `go` leads to; `heard` holds the ids of
// those who perceived it when it happened, without the one who did it. A `memory` is a character's long-term text
// written anew, which nobody else perceives: `text` is the new text, or null when the rewrite was lost.
export type Event = { at: number; clock: string; kind: Kind | 'arrive' | 'wake' | 'memory'; who: string; place: string; to: string | null; text: string | null;
  seconds: number; cut: boolean; heard: string[]; note: string | null };
// A character in the run. On the way it is in no place and `heading` names where it will arrive; asleep it stays in
// its place. `speaking` and `listening` are the ends of its own last speech and of the latest speech it heard; `began`
// is the start of its own last action.
export type Person = { id: string; place: string | null; heading: string | null; asleep: boolean; freeAt: number; began: number | null;
  speaking: number; listening: number };

const ID = /^[A-Za-z][\w-]{0,39}$/;
const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
const refuse = (field: string, problem: string): never => { throw new WorldError(`The world file cannot be used: \`${field}\` ${problem}.`); };
const textOf = (value: unknown, field: string): string => typeof value === 'string' && value.trim() ? value : refuse(field, 'must be a text that is not empty');
const amountOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : refuse(field, 'must be a number above zero');
const countOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : refuse(field, 'must be a whole number above zero');
const listOf = (value: unknown, field: string): unknown[] => Array.isArray(value) && value.length ? value : refuse(field, 'must be a list that is not empty');
function idOf(value: unknown, field: string, taken: string[]): string {
  if (typeof value !== 'string' || !ID.test(value)) return refuse(field, 'must be a short id of Latin letters, digits, `_` and `-`');
  return taken.includes(value) ? refuse(field, 'repeats an id') : value;
}

// A world file as it was parsed from JSON, checked whole. The first thing wrong is one sentence that names the field.
export function readWorld(value: unknown): World {
  if (!isObject(value)) return refuse('the file', 'must be a JSON object');
  if (typeof value.clock !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.clock)) return refuse('clock', 'must be a time of day like `21:00`');
  if (value.remote !== undefined && value.remote !== null) textOf(value.remote, 'remote');
  const places: Place[] = [];
  for (const [index, place] of listOf(value.places, 'places').entries()) {
    const field = `places[${index}]`;
    if (!isObject(place)) return refuse(field, 'must be an object');
    if (place.minutesTo !== undefined && !isObject(place.minutesTo)) return refuse(`${field}.minutesTo`, 'must be an object');
    const minutesTo: { [place: string]: number } = {};
    for (const [to, minutes] of Object.entries(place.minutesTo ?? {})) minutesTo[to] = amountOf(minutes ?? null, `${field}.minutesTo.${to}`, 0);
    places.push({ id: idOf(place.id, `${field}.id`, places.map(known => known.id)), name: textOf(place.name, `${field}.name`),
      about: textOf(place.about, `${field}.about`), minutesTo });
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
    characters.push({ id: idOf(character.id, `${field}.id`, characters.map(known => known.id)), name: textOf(character.name, `${field}.name`),
      place: character.place as string, sheet: textOf(character.sheet, `${field}.sheet`) });
  }
  return { title: textOf(value.title, 'title'), about: textOf(value.about, 'about'), clock: value.clock,
    wordsPerMinute: amountOf(value.wordsPerMinute, 'wordsPerMinute', 130), remote: typeof value.remote === 'string' ? value.remote : null,
    travelMinutes: amountOf(value.travelMinutes, 'travelMinutes', 5), shortWords: countOf(value.shortWords, 'shortWords', 2000),
    longWords: countOf(value.longWords, 'longWords', 400), places, characters };
}

// The story's clock at so many seconds from its start, as a time of day. From the second day on it names the day.
export function clockAt(world: World, at: number): string {
  const [hours, minutes] = world.clock.split(':').map(Number);
  const since = hours * 3600 + minutes * 60 + at, second = since % 86_400, day = Math.floor(since / 86_400) + 1;
  const time = [Math.floor(second / 3600), Math.floor(second / 60) % 60, second % 60].map(part => String(part).padStart(2, '0')).join(':');
  return day > 1 ? `day ${day} ${time}` : time;
}

export const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);
// The size of a text for every limit in words: its words, or more when it holds more characters than words take.
export const sizeOf = (text: string) => Math.max(wordsOf(text).length, Math.ceil(text.length / CHARS_PER_WORD));
// A text as it fits a limit in words: whole, or its beginning, marked as cut.
export function cut(text: string, limit: number): { text: string; cut: boolean } {
  if (sizeOf(text) <= limit) return { text, cut: false };
  let end = 0, count = 0;
  for (const word of text.matchAll(/\S+/g)) {
    if (count++ === limit) break;
    end = word.index + word[0].length;
  }
  // The end is not left on half a character.
  const kept = text.slice(0, Math.min(end, limit * CHARS_PER_WORD)).replace(/[\uD800-\uDBFF]$/, '');
  return { text: kept.trimEnd(), cut: true };
}
export const speechSeconds = (world: World, words: number) => Math.max(2, Math.ceil(words / world.wordsPerMinute * 60));
// How many words one speech may hold when so many seconds are left before the horizon.
export const wordLimit = (world: World, secondsLeft: number) => Math.max(1, Math.min(MAX_WORDS, Math.floor(secondsLeft * world.wordsPerMinute / 60)));

// `minutesTo` is read both ways, and a pair that is not listed takes the world's `travelMinutes`.
export function travelSeconds(world: World, from: string, to: string): number {
  const minutesTo = (a: string, b: string) => world.places.find(place => place.id === a)?.minutesTo[b];
  return Math.max(1, Math.round((minutesTo(from, to) ?? minutesTo(to, from) ?? world.travelMinutes) * 60));
}

export const start = (world: World): Person[] => world.characters.map(({ id, place }) =>
  ({ id, place, heading: null, asleep: false, freeAt: 0, began: null, speaking: 0, listening: 0 }));

// The next to play: the one free first, then the one whose own last action began earliest, then the world file's order.
export const next = (people: Person[]): Person => people.reduce((first, person) =>
  person.freeAt < first.freeAt || (person.freeAt === first.freeAt && (person.began ?? -1) < (first.began ?? -1)) ? person : first);

// The moment of the story `at` seconds from its start, as seconds since the midnight before the start.
const sinceMidnight = (world: World, at: number) => { const [hours, minutes] = world.clock.split(':').map(Number); return hours * 3600 + minutes * 60 + at; };
// The seconds from `at` to the next moment the story's clock shows the time of day `until`, a whole day when it shows it now.
export function secondsUntil(world: World, at: number, until: string): number {
  const [hours, minutes] = until.split(':').map(Number);
  return (hours * 3600 + minutes * 60 - sinceMidnight(world, at) % 86_400 + 86_400 - 1) % 86_400 + 1;
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
  if (value.action === 'say') return text ? { ...none, action: 'say', text } : 'text';
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

// Someone spoke, came or left near this character: its wait or its activity ends. It is free now, or when its own
// speech and the speech it is hearing have ended.
const attend = (person: Person, now: number) => { person.freeAt = Math.max(now, person.speaking, person.listening); };

// Those who perceive what happens in a place: everyone there who is awake.
const awakeIn = (people: Person[], place: string, but: Person) => people.filter(person => person !== but && person.place === place && !person.asleep);

// One action of a character in a place, at `now`: the event, with the actor and those who perceive it moved on.
// `limit` is the number of words a speech may hold this turn; a longer one is cut there.
export function apply(world: World, people: Person[], actor: Person, action: Action, now: number, limit: number): Event {
  const place = actor.place as string;
  const here = awakeIn(people, place, actor);
  const event: Event = { at: now, clock: clockAt(world, now), kind: action.action, who: actor.id, place, to: null, text: action.text,
    seconds: action.until === null ? action.seconds ?? 0 : secondsUntil(world, now, action.until), cut: false, heard: here.map(person => person.id),
    note: action.note };
  actor.began = now;
  if (action.action === 'say' || action.action === 'call') {
    Object.assign(event, cut(action.text as string, limit));
    event.seconds = speechSeconds(world, wordsOf(event.text as string).length);
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
    Object.assign(actor, { place: null, heading: action.place });
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
