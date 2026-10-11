import { all } from './things.ts';
import type { Things } from './things.ts';
import { cut, isObject, wordsOf } from './reading.ts';
import { clockAt, driveSeconds, figureHere, lasting, secondsUntil, speechSeconds, travelSeconds, walkAt, legAt } from './time.ts';
import { GESTURE_WORDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, SAYS_WORDS } from './world.ts';
import type { Event, Kind, Person, Place, World } from './world.ts';

// `gesture` and `says` stay absent when unused so older journal records read back unchanged.
// `capped` is for journal counts only; requests and events must not carry it.
export type Action = { note: string | null; action: Kind; text: string | null; to: string | null; place: string | null; seconds: number | null; until: string | null;
  gesture?: string; says?: string; capped?: true; deedCut?: true };
export const REFUSALS = ['json', 'action', 'text', 'to', 'here', 'place', 'time', 'long', 'declined', 'vehicle', 'full', 'driving', 'driver', 'reach', 'round', 'fare', 'roadSleep'] as const;
export type Refusal = typeof REFUSALS[number];
export const isRefusal = (value: unknown): value is Refusal => REFUSALS.some(reason => reason === value);

export const start = (world: World): Person[] => world.characters.map(({ id, place, pose }) =>
  ({ id, place, pose, heading: null, asleep: false, freeAt: 0, began: null, speaking: 0, listening: 0 }));

export const onWay = (person: Person) => person.walk !== undefined && person.freeAt < person.walk.arrival;
const due = (person: Person) => person.place === null && !onWay(person) ? 0 : person.asleep ? 1 : 2;
// Arrivals and wakings must precede turns at the same instant, or a turn could report someone present as absent.
export const next = (people: Person[]): Person => people.reduce((first, person) =>
  person.freeAt < first.freeAt || (person.freeAt === first.freeAt && (due(person) < due(first)
    || (due(person) === due(first) && (person.began ?? -1) < (first.began ?? -1)))) ? person : first);

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
  const figure = world.places.find(place => place.id === actor.place)?.figures.find(item => item.id === value.to && figureHere(world, item, actor.freeAt))?.id ?? null;
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
    const done = text === null ? null : cut(text, MAX_WORDS), lasts = span(MAX_SECONDS);
    return !done?.text ? 'text' : lasts ? { ...none, ...lasts, action: 'do', text: done.text, ...(says === null ? {} : { says }), ...(done.cut ? { deedCut: true as const } : {}) } : 'time';
  }
  if (value.action === 'sleep' && actor.walk) return 'roadSleep';
  if (value.action === 'wait' || value.action === 'sleep') {
    const lasts = span(value.action === 'wait' ? MAX_SECONDS : MAX_SLEEP);
    return lasts ? { ...none, ...lasts, action: value.action } : 'time';
  }
  return 'action';
}

// The world may name a way even when the rules will refuse it and tell the doer why.
const TOLD: readonly unknown[] = ['full', 'fare', 'driver', 'reach', 'round'];
export const waysOf = (world: World, people: Person[], actor: Person, things: Things): string[] => world.places.filter(place => {
  const read = readAction(world, actor, JSON.stringify({ action: 'go', place: place.id }), people, things);
  return typeof read !== 'string' || TOLD.includes(read);
}).map(place => place.id);

export const attend = (person: Person, now: number) => {
  person.freeAt = Math.max(now, person.speaking, person.listening, person.passageUntil ?? 0, person.walk?.turnAfter ?? person.walk?.since ?? 0);
  if (person.walk && person.walk.arrival - person.freeAt < 60) person.freeAt = person.walk.arrival;
};

export const together = (people: Person[], actor: Person, now: number) => {
  if (!actor.walk) return [];
  const [leg] = walkAt(actor.walk, now).legs;
  return people.filter(person => {
    if (!person.walk || person.asleep || person.walk.arrival <= now) return false;
    const [other] = walkAt(person.walk, now).legs;
    return other.from === leg.from && other.to === leg.to && Math.abs(person.walk.arrival - actor.walk!.arrival) <= 60;
  });
};
export const presentAt = (people: Person[], event: Event) => event.onWay ? people.filter(person => person.id === event.who || event.heard.includes(person.id)) : people.filter(person => person.place === event.place);
export const roadPlace = (): Place => ({ id: '@way', name: 'the way', about: '', facts: null, things: [], open: true, clock: false, crowd: null, figures: [], at: null, minutesTo: {}, nextDoor: [] });

export const awakeIn = (people: Person[], place: string, but: Person) => people.filter(person => person !== but && person.place === place && !person.asleep);
export const sleepersNear = (people: Person[], place: Place) => people.filter(person => person.asleep && (person.place === place.id || place.nextDoor.includes(person.place!)));

export function apply(world: World, people: Person[], actor: Person, action: Action, now: number, limit: number, pending?: Event, refused = false): Event {
  const walk = actor.walk && walkAt(actor.walk, now), leg = walk?.legs[0];
  const place = leg?.from ?? actor.place as string;
  const here = walk ? together(people, actor, now).filter(person => person !== actor) : awakeIn(people, place, actor);
  const event: Event = { at: now, clock: clockAt(world, now), kind: action.action, who: actor.id, place, to: null, text: action.text,
    seconds: action.until === null ? action.seconds ?? 0 : lasting(world, actor, action.action as 'do' | 'wait' | 'sleep', now, action.until), cut: false,
    heard: here.map(person => person.id),
    note: action.note, ...(leg ? { onWay: { from: leg.from, to: leg.to, behind: leg.behind, ahead: leg.seconds - leg.behind } } : {}), ...(action.gesture === undefined ? {} : { gesture: action.gesture }), ...(action.deedCut ? { deedCut: true } : {}) };
  actor.began = now;
  if (pending && ['do', 'go', 'sleep'].includes(action.action)) return { at: now, clock: event.clock, kind: 'stop', who: actor.id, place, to: null, text: null, seconds: 0, cut: false, heard: [], note: action.note };
  if (action.action === 'say' || action.action === 'call') {
    Object.assign(event, cut(action.text as string, limit));
    event.seconds = speechSeconds(world, actor.id, wordsOf(event.text as string).length);
    if (action.action === 'say') event.to = action.to;
    const listeners = [...here];
    const callee = people.find(person => person.id === action.to);
    if (action.action === 'call' && callee) {
      event.to = callee.id;
      // Calls to travellers and sleepers wait in `Mind.waiting`: journal.ts delivers them on arrival or waking.
      if ((callee.place !== null || callee.walk) && !callee.asleep && !here.includes(callee)) listeners.push(callee);
    }
    event.heard = people.filter(person => listeners.includes(person)).map(person => person.id);
    for (const listener of listeners) {
      listener.listening = Math.max(listener.listening, now + event.seconds);
      attend(listener, now);
    }
    actor.speaking = now + event.seconds;
  } else if (action.action === 'go') {
    event.to = action.place;
    if (walk && action.place === actor.heading) event.heard = [];
    const to = world.places.find(place => place.id === action.place);
    const inside = world.places.find(item => item.id === place)?.vehicle;
    if (walk) {
      if (action.place !== actor.heading) {
        const back = leg!.behind + (action.place === leg!.from ? 0 : travelSeconds(world, leg!.from, action.place!));
        const ahead = leg!.seconds - leg!.behind + (action.place === leg!.to ? 0 : travelSeconds(world, leg!.to, action.place!));
        const reverse = action.place === leg!.from || back <= ahead, end = reverse ? leg!.from : leg!.to;
        walk.legs = [{ from: reverse ? leg!.to : leg!.from, to: end, seconds: leg!.seconds, behind: reverse ? leg!.seconds - leg!.behind : leg!.behind },
          ...(action.place === end ? [] : [{ from: end, to: action.place!, seconds: travelSeconds(world, end, action.place!), behind: 0 }])];
        walk.arrival = now + (reverse ? back : ahead);
      }
      event.seconds = Math.max(0, legAt(world, walk, now) - now);
    } else if (inside && to!.id !== inside.at) {
      Object.assign(event, { kind: 'drive', from: inside.at, arrival: now + driveSeconds(world, inside.at!, to!.id, inside.faster), seconds: 10 });
      event.nearby = people.filter(person => person.place === inside.at && !person.asleep).map(person => person.id);
      for (const witness of people.filter(person => event.nearby!.includes(person.id))) attend(witness, now);
    } else if (inside || to?.vehicle) {
      Object.assign(event, { transfer: true, seconds: 10 });
      Object.assign(actor, { place: action.place, pose: null, passageUntil: now + 10 });
      event.nearby = people.filter(person => person !== actor && person.place === action.place && !person.asleep).map(person => person.id);
      for (const witness of people.filter(person => event.nearby!.includes(person.id))) attend(witness, now);
    } else event.seconds = travelSeconds(world, place, action.place as string);
    if (!walk) for (const witness of here) attend(witness, now);
    if (!event.transfer && event.kind !== 'drive') {
      Object.assign(actor, { place: null, heading: action.place, pose: null });
      if (walk || world.legMinutes !== undefined && event.seconds - world.legMinutes * 60 >= 60) {
        actor.walk = walk ?? { legs: [{ from: place, to: action.place!, seconds: event.seconds, behind: 0 }], since: now, arrival: now + event.seconds };
        actor.freeAt = legAt(world, actor.walk, now);
      }
    } else actor.passageUntil = now + 10;
  } else if (action.action === 'do' && action.says !== undefined) {
    const said = cut(action.says, limit), ends = now + speechSeconds(world, actor.id, wordsOf(said.text).length);
    Object.assign(event, { says: said.text, cut: said.cut, seconds: Math.max(event.seconds, ends - now) });
    for (const listener of here) {
      listener.listening = Math.max(listener.listening, ends);
      attend(listener, now);
    }
    actor.speaking = ends;
  } else if (action.action === 'wait') {
    event.heard = [];
    if (pending) event.seconds = refused ? Math.min(event.seconds, pending.at + pending.seconds - now) : pending.at + pending.seconds - now;
  } else if (action.action === 'sleep') Object.assign(actor, { asleep: true, pose: null });
  // Interrupting for every silent deed would cost a model call for each waiting witness.
  if (walk) {
    if (!refused && (action.action === 'do' || action.action === 'wait')) {
      walk.arrival += event.seconds;
      walk.since = now + event.seconds;
      walk.turnAfter = legAt(world, walk, walk.since);
    } else if (refused) walk.turnAfter = Math.min(walk.arrival, now + event.seconds);
    actor.walk = walk;
    actor.freeAt = Math.max(legAt(world, walk, walk.since + (refused ? event.seconds : 0)), actor.speaking, actor.listening);
    if (walk.arrival - actor.freeAt < 60) actor.freeAt = walk.arrival;
  } else if (!actor.walk) actor.freeAt = Math.max(now + event.seconds, pending && action.action !== 'wait' ? pending.at + pending.seconds : 0);
  return event;
}

export function arrive(world: World, people: Person[], traveller: Person, now: number): Event {
  const place = traveller.heading as string;
  const here = awakeIn(people, place, traveller);
  for (const witness of here) attend(witness, now);
  Object.assign(traveller, { place, heading: null });
  if (traveller.walk) { delete traveller.walk; attend(traveller, now); }
  return { at: now, clock: clockAt(world, now), kind: 'arrive', who: traveller.id, place, to: null, text: null, seconds: 0, cut: false,
    heard: here.map(person => person.id), note: null };
}

export function wake(world: World, people: Person[], sleeper: Person, now: number): Event {
  const place = sleeper.place as string;
  sleeper.asleep = false;
  return { at: now, clock: clockAt(world, now), kind: 'wake', who: sleeper.id, place, to: null, text: null, seconds: 0, cut: false,
    heard: awakeIn(people, place, sleeper).map(person => person.id), note: null };
}
