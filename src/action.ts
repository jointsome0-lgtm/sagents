// What a resident of a live world does, with no model in it: its answer read as an action it can take now, and the
// action as an event, with the actor and those who perceive it moved on.
import { cut, isObject, wordsOf } from './reading.ts';
import { clockAt, lasting, secondsUntil, speechSeconds, travelSeconds } from './time.ts';
import { MAX_SECONDS, MAX_SLEEP, MAX_WORDS } from './world.ts';
import type { Event, Kind, Person, World } from './world.ts';

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

// Everyone begins awake, placed, holding and carrying what the world file says.
export const start = (world: World): Person[] => world.characters.map(({ id, place, pose, holds, has }) =>
  ({ id, place, pose, holds, has, heading: null, asleep: false, freeAt: 0, began: null, speaking: 0, listening: 0 }));

// The next to play: the one free first, then the one whose own last action began earliest, then the world file's order.
export const next = (people: Person[]): Person => people.reduce((first, person) =>
  person.freeAt < first.freeAt || (person.freeAt === first.freeAt && (person.began ?? -1) < (first.began ?? -1)) ? person : first);

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
  // Whoever falls asleep is no longer placed as it was awake: a sleeper has no pose unless a deed gives it one.
  else if (action.action === 'sleep') Object.assign(actor, { asleep: true, pose: null });
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
