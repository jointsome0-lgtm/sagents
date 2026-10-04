// The world of the `live` mode and its rules, with no model in them: named places, who is where, and a clock in whole
// seconds since the story's start. There is no map and nobody judges outcomes: the rules say only how long an action
// takes, who perceives it and when each character is free to act again.
export const MAX_WORDS = 65;
export const MAX_SECONDS = 3600;
// What an answer that cannot be used becomes: a wait of this many seconds.
export const LOST_SECONDS = 30;

// The sentences about a world file that cannot be used; they are this file's own and may be shown.
export class WorldError extends Error {}

export type Place = { id: string; name: string; about: string; minutesTo: { [place: string]: number } };
export type Character = { id: string; name: string; place: string; sheet: string };
// `remote` names the means by which people reach each other from afar; a world with null has none.
export type World = { title: string; about: string; clock: string; wordsPerMinute: number; remote: string | null;
  travelMinutes: number; places: Place[]; characters: Character[] };

export type Kind = 'say' | 'call' | 'go' | 'do' | 'wait';
// One answer of a character, as the schema asks for it: every field is there and an unused one is null.
export type Action = { action: Kind; text: string | null; to: string | null; place: string | null; seconds: number | null; note: string | null };
// `place` is where it happened; `to` is the character called, or the place a `go` leads to; `heard` holds the ids of
// those who perceived it when it happened, without the one who did it.
export type Event = { at: number; clock: string; kind: Kind | 'arrive'; who: string; place: string; to: string | null; text: string | null;
  seconds: number; cut: boolean; heard: string[]; note: string | null };
// A character in the run. On the way it is in no place and `heading` names where it will arrive. `speaking` and
// `listening` are the ends of its own last speech and of the latest speech it heard; `began` is the start of its own
// last action; `missed` holds the calls made to it while it was on the way.
export type Person = { id: string; place: string | null; heading: string | null; freeAt: number; began: number | null; speaking: number;
  listening: number; missed: Event[] };

const ID = /^[A-Za-z][\w-]{0,39}$/;
const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
const refuse = (field: string, problem: string): never => { throw new WorldError(`The world file cannot be used: \`${field}\` ${problem}.`); };
const textOf = (value: unknown, field: string): string => typeof value === 'string' && value.trim() ? value : refuse(field, 'must be a text that is not empty');
const amountOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : refuse(field, 'must be a number above zero');
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
    travelMinutes: amountOf(value.travelMinutes, 'travelMinutes', 5), places, characters };
}

// The story's clock at so many seconds from its start, as a time of day.
export function clockAt(world: World, at: number): string {
  const [hours, minutes] = world.clock.split(':').map(Number);
  const second = (hours * 3600 + minutes * 60 + at) % 86_400;
  return [Math.floor(second / 3600), Math.floor(second / 60) % 60, second % 60].map(part => String(part).padStart(2, '0')).join(':');
}

export const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);
export const speechSeconds = (world: World, words: number) => Math.max(2, Math.ceil(words / world.wordsPerMinute * 60));
// How many words one speech may hold when so many seconds are left before the horizon.
export const wordLimit = (world: World, secondsLeft: number) => Math.max(1, Math.min(MAX_WORDS, Math.floor(secondsLeft * world.wordsPerMinute / 60)));

// `minutesTo` is read both ways, and a pair that is not listed takes the world's `travelMinutes`.
export function travelSeconds(world: World, from: string, to: string): number {
  const minutesTo = (a: string, b: string) => world.places.find(place => place.id === a)?.minutesTo[b];
  return Math.max(1, Math.round((minutesTo(from, to) ?? minutesTo(to, from) ?? world.travelMinutes) * 60));
}

export const start = (world: World): Person[] => world.characters.map(({ id, place }) =>
  ({ id, place, heading: null, freeAt: 0, began: null, speaking: 0, listening: 0, missed: [] }));

// The next to play: the one free first, then the one whose own last action began earliest, then the world file's order.
export const next = (people: Person[]): Person => people.reduce((first, person) =>
  person.freeAt < first.freeAt || (person.freeAt === first.freeAt && (person.began ?? -1) < (first.began ?? -1)) ? person : first);

// A character's answer as an action it can take now, or null when it cannot be used. A field the action does not
// use is dropped whatever it held.
export function readAction(world: World, actor: Person, answer: string): Action | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch { return null; }
  if (!isObject(value)) return null;
  const line = (field: unknown) => typeof field === 'string' && field.trim() ? field.trim() : null;
  const text = line(value.text);
  const seconds = typeof value.seconds === 'number' && Number.isInteger(value.seconds) && value.seconds >= 1 && value.seconds <= MAX_SECONDS ? value.seconds : null;
  const none = { text: null, to: null, place: null, seconds: null, note: line(value.note) };
  if (value.action === 'say') return text ? { ...none, action: 'say', text } : null;
  if (value.action === 'call') {
    const known = world.remote !== null && value.to !== actor.id && world.characters.some(character => character.id === value.to);
    return known && text ? { ...none, action: 'call', text, to: value.to as string } : null;
  }
  if (value.action === 'go') {
    const known = value.place !== actor.place && world.places.some(place => place.id === value.place);
    return known ? { ...none, action: 'go', place: value.place as string } : null;
  }
  if (value.action === 'do') return text && seconds ? { ...none, action: 'do', text, seconds } : null;
  if (value.action === 'wait') return seconds ? { ...none, action: 'wait', seconds } : null;
  return null;
}

// Someone spoke, came or left near this character: its wait or its activity ends. It is free now, or when its own
// speech and the speech it is hearing have ended.
const attend = (person: Person, now: number) => { person.freeAt = Math.max(now, person.speaking, person.listening); };

// One action of a character in a place, at `now`: the event, with the actor and those who perceive it moved on.
// `limit` is the number of words a speech may hold this turn; a longer one is cut there.
export function apply(world: World, people: Person[], actor: Person, action: Action, now: number, limit: number): Event {
  const place = actor.place as string;
  const here = people.filter(person => person !== actor && person.place === place);
  const event: Event = { at: now, clock: clockAt(world, now), kind: action.action, who: actor.id, place, to: null, text: action.text,
    seconds: action.seconds ?? 0, cut: false, heard: here.map(person => person.id), note: action.note };
  actor.began = now;
  if (action.action === 'say' || action.action === 'call') {
    const words = wordsOf(action.text as string);
    if (words.length > limit) Object.assign(event, { text: words.slice(0, limit).join(' '), cut: true });
    event.seconds = speechSeconds(world, Math.min(words.length, limit));
    const listeners = [...here];
    const callee = people.find(person => person.id === action.to);
    if (action.action === 'call' && callee) {
      event.to = callee.id;
      // A call to someone on the way waits for the arrival.
      if (callee.place === null) callee.missed.push(event);
      else if (!here.includes(callee)) listeners.push(callee);
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
  // A `do` is left: it is seen and interrupts nobody, and a witness learns of it at its own next turn. Otherwise every
  // gesture in a room would cost one call to the model for each person who waits there.
  actor.freeAt = now + event.seconds;
  return event;
}

// A traveller whose turn has come at its arrival time is put in the destination. The event is the arrival as those
// there see it; `missed` holds the calls that waited for the traveller, which it hears now, whole.
export function arrive(world: World, people: Person[], traveller: Person, now: number): { event: Event; missed: Event[] } {
  const place = traveller.heading as string;
  const here = people.filter(person => person.place === place);
  for (const witness of here) attend(witness, now);
  const missed = traveller.missed;
  Object.assign(traveller, { place, heading: null, missed: [] });
  return { missed, event: { at: now, clock: clockAt(world, now), kind: 'arrive', who: traveller.id, place, to: null, text: null, seconds: 0,
    cut: false, heard: here.map(person => person.id), note: null } };
}
