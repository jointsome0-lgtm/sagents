// What a resident of a live world does, with no model in it: its answer read as an action it can take now, and the
// action as an event, with the actor and those who perceive it moved on.
import { all } from './things.ts';
import type { Things } from './things.ts';
import { cut, isObject, wordsOf } from './reading.ts';
import { clockAt, driveSeconds, lasting, secondsUntil, speechSeconds, travelSeconds } from './time.ts';
import { GESTURE_WORDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, SAYS_WORDS } from './world.ts';
import type { Event, Kind, Person, Place, World } from './world.ts';

// One answer of a character, as the schema asks for it, the note first: every field is there and an unused one is null. `to` is the
// character a `call` reaches, or the figure of the speaker's place a `say` is addressed to.
// `do`, `wait` and `sleep` last `seconds`, or `until` the next moment the clock shows that time of day, `HH:MM`.
// `gesture`, what the body of one who makes a `say` does meanwhile, and `says`, the words said aloud with a `do`, are
// the two fields that are absent when there is none and never null, so that an action recorded before they existed
// still reads back as itself. `capped` is there only when the answer asked for a longer span than the action allows
// and it lasts the longest one instead: a mark for whoever counts a journal, which no line, request or event holds.
export type Action = { note: string | null; action: Kind; text: string | null; to: string | null; place: string | null; seconds: number | null; until: string | null;
  gesture?: string; says?: string; capped?: true };
// Why an answer could not be used as an action: it was not a JSON object, named no action, lacked its text, called
// nobody who can be called, led to the place the character is in or to no place, or lasted no time the action allows;
// or it never arrived whole, because the model wrote on to the limit of one answer (`long`); or the service declined to
// write one (`declined`).
export const REFUSALS = ['json', 'action', 'text', 'to', 'here', 'place', 'time', 'long', 'declined', 'vehicle', 'full', 'driving', 'driver', 'reach', 'round', 'fare'] as const;
export type Refusal = typeof REFUSALS[number];
export const isRefusal = (value: unknown): value is Refusal => REFUSALS.some(reason => reason === value);

// Everyone begins awake and placed as the world file says.
export const start = (world: World): Person[] => world.characters.map(({ id, place, pose }) =>
  ({ id, place, pose, heading: null, asleep: false, freeAt: 0, began: null, speaking: 0, listening: 0 }));

// What the clock brings someone who is free, before any turn: an arrival for one on the way, then a waking for a sleeper.
const due = (person: Person) => person.place === null ? 0 : person.asleep ? 1 : 2;
// The next to play: the one free first. Of those free at one instant, whoever arrives comes first and whoever wakes
// after them, so that everyone who comes or wakes at an instant has done so before anyone takes a turn at it and no
// turn is told that someone who is there is not. Then the one whose own last action began earliest, then the world
// file's order.
export const next = (people: Person[]): Person => people.reduce((first, person) =>
  person.freeAt < first.freeAt || (person.freeAt === first.freeAt && (due(person) < due(first)
    || (due(person) === due(first) && (person.began ?? -1) < (first.began ?? -1)))) ? person : first);

// A character's answer as an action it can take now, or the reason why it cannot be used. A field the action does not
// use is dropped whatever it held, and of `until` and `seconds` only one is kept: `until` when it was given, and the
// longest span in `seconds` when either asked for more. A text
// becomes one line; a note and what a `do` describes keep their first `MAX_WORDS` words, a gesture its first
// `GESTURE_WORDS` and the words said with a `do` their first `SAYS_WORDS`, and a speech is cut when it
// is made, at that turn's limit. The actor's `freeAt` is the moment of the turn.
export function readAction(world: World, actor: Person, answer: string, people: Person[] = [], things?: Things): Action | Refusal {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return 'json';
  }
  if (!isObject(value)) return 'json';
  const line = (field: unknown) => typeof field === 'string' && field.trim() ? wordsOf(field).join(' ') : null;
  const short = (field: unknown, most = MAX_WORDS) => { const whole = line(field); return whole === null ? null : cut(whole, most).text || null; };
  const text = line(value.text);
  const none = { note: short(value.note), text: null, to: null, place: null, seconds: null, until: null };
  // How long the action lasts, as the field that says it, or null when that is no whole number of seconds from 1 on
  // and no time of day. A span longer than `most`, in seconds or to a time of day, is `most` seconds and is marked.
  const span = (most: number): { seconds: number | null; until: string | null; capped?: true } | null => {
    const capped = { seconds: most, until: null, capped: true as const };
    if (value.until === undefined || value.until === null || (typeof value.until === 'string' && !value.until.trim())) {
      const seconds = value.seconds;
      return typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 ? null : seconds > most ? capped : { seconds, until: null };
    }
    const time = typeof value.until === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.until.trim()) : null;
    const until = time ? `${time[1].padStart(2, '0')}:${time[2]}` : null;
    return !until ? null : secondsUntil(world, actor.freeAt, until) > most ? capped : { seconds: null, until };
  };
  // A `say` is addressed only to a figure of the place the speaker is in; any other `to` is dropped.
  const figure = world.places.find(place => place.id === actor.place)?.figures.find(item => item.id === value.to)?.id ?? null;
  const gesture = short(value.gesture, GESTURE_WORDS), says = short(value.says, SAYS_WORDS);
  if (value.action === 'say') return text ? { ...none, action: 'say', text, to: figure, ...(gesture === null ? {} : { gesture }) } : 'text';
  if (value.action === 'call') {
    const known = world.remote !== null && value.to !== actor.id && world.characters.some(character => character.id === value.to);
    return !known ? 'to' : text ? { ...none, action: 'call', text, to: value.to as string } : 'text';
  }
  if (value.action === 'go') {
    const inside = world.places.find(place => place.id === actor.place)?.vehicle;
    const destination = value.place;
    if (inside?.route && destination !== inside.at && world.places.some(place => !place.vehicle && place.id === destination)) return 'round';
    if (inside?.heading) return 'driving';
    if (destination === actor.place) return 'here';
    const to = world.places.find(place => place.id === destination);
    if (!to) return 'place';
    if (to.vehicle) {
      if (inside || to.vehicle.at !== actor.place || to.vehicle.heading) return 'vehicle';
      if (people.filter(person => person.place === to.id).length >= to.vehicle.seats) return 'full';
      const fare = to.vehicle.fare;
      if (fare && all(things?.people.get(actor.id) ?? world.characters.find(person => person.id === actor.id)!.carries).reduce((sum, thing) => sum + (thing.money && thing.name === fare.name ? thing.n! : 0), 0) < fare.n) return 'fare';
      return { ...none, action: 'go', place: to.id };
    }
    if (inside) {
      if (to.id === inside.at) return { ...none, action: 'go', place: to.id };
      if (inside.drivers !== null && !inside.drivers.includes(actor.id)) return 'driver';
      if (!inside.reach.includes(to.id)) return 'reach';
      return { ...none, action: 'go', place: to.id };
    }
    return { ...none, action: 'go', place: to.id };
  }
  if (value.action === 'do') {
    const done = short(text), lasts = span(MAX_SECONDS);
    return !done ? 'text' : lasts ? { ...none, ...lasts, action: 'do', text: done, ...(says === null ? {} : { says }) } : 'time';
  }
  if (value.action === 'wait' || value.action === 'sleep') {
    const lasts = span(value.action === 'wait' ? MAX_SECONDS : MAX_SLEEP);
    return lasts ? { ...none, ...lasts, action: value.action } : 'time';
  }
  return 'action';
}

// Someone spoke, came or left near this character, or the weather changed over it: its wait or its activity ends. It is free now, or when its own
// speech and the speech it is hearing have ended.
export const attend = (person: Person, now: number) => { person.freeAt = Math.max(now, person.speaking, person.listening, person.passageUntil ?? 0); };

// Those who perceive what happens in a place: everyone there who is awake.
export const awakeIn = (people: Person[], place: string, but: Person) => people.filter(person => person !== but && person.place === place && !person.asleep);
// Those a deed done in a place can wake: the sleepers of the place and of the places next door to it.
export const sleepersNear = (people: Person[], place: Place) => people.filter(person => person.asleep && (person.place === place.id || place.nextDoor.includes(person.place!)));

// One action of a character in a place, at `now`: the event, with the actor and those who perceive it moved on.
// `limit` is the number of words a speech may hold this turn; a longer one is cut there.
export function apply(world: World, people: Person[], actor: Person, action: Action, now: number, limit: number): Event {
  const place = actor.place as string;
  const here = awakeIn(people, place, actor);
  const event: Event = { at: now, clock: clockAt(world, now), kind: action.action, who: actor.id, place, to: null, text: action.text,
    seconds: action.until === null ? action.seconds ?? 0 : lasting(world, actor, action.action as 'do' | 'wait' | 'sleep', now, action.until), cut: false,
    heard: here.map(person => person.id),
    note: action.note, ...(action.gesture === undefined ? {} : { gesture: action.gesture }) };
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
    const to = world.places.find(place => place.id === action.place);
    const inside = world.places.find(item => item.id === place)?.vehicle;
    if (inside && to!.id !== inside.at) {
      Object.assign(event, { kind: 'drive', from: inside.at, arrival: now + driveSeconds(world, inside.at!, to!.id, inside.faster), seconds: 10 });
      event.nearby = people.filter(person => person.place === inside.at && !person.asleep).map(person => person.id);
      for (const witness of people.filter(person => event.nearby!.includes(person.id))) attend(witness, now);
    } else if (inside || to?.vehicle) {
      // Crossing the door places the person at once; the ten seconds still hold its next turn.
      Object.assign(event, { transfer: true, seconds: 10 });
      Object.assign(actor, { place: action.place, pose: null, passageUntil: now + 10 });
      event.nearby = people.filter(person => person !== actor && person.place === action.place && !person.asleep).map(person => person.id);
      for (const witness of people.filter(person => event.nearby!.includes(person.id))) attend(witness, now);
    } else event.seconds = travelSeconds(world, place, action.place as string);
    for (const witness of here) attend(witness, now);
    // Whoever leaves is no longer placed as it was.
    if (!event.transfer && event.kind !== 'drive') Object.assign(actor, { place: null, heading: action.place, pose: null });
    else actor.passageUntil = now + 10;
  } else if (action.action === 'do' && action.says !== undefined) {
    // Words said with a deed are a speech of that moment, cut at the turn's limit: they hold those who hear them
    // until they end, and the deed lasts at least as long as they take.
    const said = cut(action.says, limit), ends = now + speechSeconds(world, wordsOf(said.text).length);
    Object.assign(event, { says: said.text, cut: said.cut, seconds: Math.max(event.seconds, ends - now) });
    for (const listener of here) {
      listener.listening = Math.max(listener.listening, ends);
      attend(listener, now);
    }
    actor.speaking = ends;
  } else if (action.action === 'wait') event.heard = [];
  // Whoever falls asleep is no longer placed as it was awake: a sleeper has no pose unless a deed gives it one.
  else if (action.action === 'sleep') Object.assign(actor, { asleep: true, pose: null });
  // A `do` with no words, and a falling asleep, are left: they are seen and interrupt nobody, and a witness learns of them at its
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
