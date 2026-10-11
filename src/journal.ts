// Run and replay must both use advance() so the same records give the same world.
import { isDeepStrictEqual } from 'node:util';

import { blank, idle, lineOf, remember, rewrite } from './memory.ts';
import type { Line, Mind } from './memory.ts';
import { beginLaws, LAWS } from './laws.ts';
import type { LawRecord, Parts } from './laws.ts';
import { apply, arrive, attend, isRefusal, next, readAction, sleepersNear, start, wake, waysOf } from './action.ts';
import { labelsOn, marked as traced, readReply, reply, readResult, result } from './answer.ts';
import { all, pay, stocked } from './things.ts';
import { touched } from './touch.ts';
import type { Touch } from './touch.ts';
import { marked, marksAt } from './marks.ts';
import type { Mark } from './marks.ts';
import { busAt, busRound, clockAt, driveSeconds, hasClock, timeFor } from './time.ts';
import { secondsOfDay, closed } from './reading.ts';
import { namesOf, LOST_SECONDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, sizeOf } from './world.ts';
import type { Action, Refusal } from './action.ts';
import type { Answer, Traces } from './answer.ts';
import type { Move, Things } from './things.ts';
import type { Event, Person, Place, World } from './world.ts';

// These sentences are ours, so cli.ts may show them.
export class JournalError extends Error {}

export type Record = { kind: 'act'; who: string; at: number; limit: number; action: Action | Refusal; fromDeed?: number; place?: string; drive?: { vehicle: string; from: string; to: string; at: number } }
  | { kind: 'park'; who: string; at: number }
  | { kind: 'arrive' | 'wake'; who: string; at: number }
  | { kind: 'memory'; who: string; at: number; text: string | null; upTo: number; cut: boolean }
  | { kind: 'reply'; who: string; at: number; figure: string; text: string | null; moves: Move[] }
  | ({ kind: 'result'; who: string; at: number } & Answer)
  | LawRecord;
// Replay must not depend on which model answered.
export type Entry = { seq: number; record: Record; event: Event; by: string | null };
// An immediate reply or a stopped deed must be answered before another record.
// Use marksAt() in marks.ts for expiry since the last result.
export type State = { places: Place[]; vehicleLines?: Map<string, Map<string, string>>; people: Person[]; minds: Map<string, Mind>; seq: number; deed: Event | null; results: Map<string, Line[]>;
  pending?: Map<string, { event: Event; seq: number }>; said: Map<string, Line[]>; things: Things; laws: Parts; touches: Touch[]; marks: Mark[]; traces: Traces | null; ways?: Map<string, { place: string; seq: number }>; buses?: { at: number; passed: string[]; waiting: Set<string>; doors: Map<string, { place: string; at: number }> } };
export const RESULT_WORDS = 400;
export const SAID_WORDS = 300;
// state.ts must append a step's entries together or not at all.
export type Store = { entries(): Iterable<Entry>; append(entries: Entry[]): void };
// These sentences are ours, so cli.ts may show them.
export class StateError extends Error {}

export const memoryStore = (): Store & { all: Entry[] } => {
  const all: Entry[] = [];
  return { all, entries: () => all, append: entries => { all.push(...entries); } };
};

export const UNUSABLE = `Your answer could not be used and counted as a wait of ${LOST_SECONDS} seconds.`;
// The resident model reads this, so give it a usable alternative.
const INSTEAD = {
  json: 'Answer with one JSON object and nothing else, with one of the listed actions.',
  action: '`action` must be one of the listed actions.',
  text: 'That action needs a `text`.',
  to: 'A call reaches one person: `to` must be the id of one other person from the list of people.',
  here: 'You are already in that place. `go` leads only to another place of the list; moving about inside a place is a `do`.',
  place: '`place` must be the id of a place from the list of places.',
  round: 'This vehicle goes its round by itself.',
  vehicle: 'That vehicle is not standing where you are.',
  full: 'That vehicle has no free seat.',
  driving: 'You cannot go anywhere while the vehicle is driving.',
  driver: 'You may not drive this vehicle.',
  reach: 'This vehicle cannot drive to that place.',
  long: 'It ran on to the limit of one answer and was lost whole. Answer with the one JSON object, at once and briefly.',
  time: `A \`do\` or a \`wait\` lasts 1 to ${MAX_SECONDS} seconds and a \`sleep\` 1 to ${MAX_SLEEP}, given as \`seconds\` or as \`until\`, a time of day like 06:30.`,
};
const NO_REMOTE = 'There is no means of remote contact here: to reach someone, go where they are.';
export const refused = (world: World, reason: Refusal, place?: string) => `${UNUSABLE} ${reason === 'fare' ? `You need ${world.places.find(item => item.id === place)!.vehicle!.fare!.n} ${world.places.find(item => item.id === place)!.vehicle!.fare!.name} for the fare.`
  : reason === 'to' && world.remote === null ? NO_REMOTE : INSTEAD[reason === 'declined' ? 'json' : reason]}`;
export const CUT = 'Your speech was longer than the limit: the others heard only its first words.';
const DEED_CUT = 'Your deed was longer than the limit: only its first words were done.';
const NOTHING = 'Nothing came of it that could be noticed.';

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
const told = (event: Event, doer: string) => [
  ...(event.moved ?? []).filter(posting => posting.out !== posting.into).map(({ name, n, to, out, into }) => `${name}${n === null ? '' : ` ×${n}`} ${
    to === 'eaten' ? `was eaten or drunk up by ${doer}` : to === 'burned' ? 'burned up' : `went from ${out} to ${into}`}.`),
  ...(event.set ?? []).map(({ name, state }) => `${name} is now ${state}.`),
  ...(event.found ?? []).map(({ name, spot }) => `${name} was found: ${spot}.`)].join(' ');
// The resident wording names the person rather than the pocket, which leads the model to answer that way.
const listed = (world: World, things: Things, event: Event, doer: string) => {
  const within = [...things.places.get(event.place)!, ...[...things.people.values()].flat()];
  const holder = (id: string) => { const one = [...world.characters, ...world.places].find(item => item.id === id); return one ? `${one.name} (${id})` : `${id} ${all(within).find(thing => thing.label === id)?.name ?? ''}`.trim(); };
  return [...(event.moved ?? []).map(({ what, name, n, to, as }) => `${as ?? what} ${name}${n === null ? '' : ` ×${n}`} ${
    to === 'eaten' ? `was eaten or drunk up by ${doer}` : to === 'burned' ? 'burned up' : `went to ${holder(to)}`}.`),
  ...(event.set ?? []).map(({ what, name, state }) => `${what} ${name} is now ${state}.`),
  ...(event.found ?? []).map(({ what, name, spot }) => `${what} ${name} was found: ${spot}.`),
  ...(event.traced ?? []).map(({ of, label, text }) => `${holder(of)} now has the trace ${label} ${text}.`),
  ...(event.wiped ?? []).map(({ of, label, text }) => `${holder(of)} no longer has the trace ${label} ${text}.`)].join(' ');
};
const toFigure = (world: World, event: Event) => event.kind === 'say' && event.to !== null ? ` to ${named(namesOf(world), event.to)}` : '';
const gestured = (event: Event) => event.gesture === undefined ? '' : ` (${event.gesture})`;

function perceived(world: World, event: Event, viewer: string, when: string): string[] {
  if (event.kind === 'drive') return [`${when} ${named(world.places, event.place)} has driven off.`];
  if (event.kind === 'park') return [`${when} ${named(world.places, event.who)} has pulled up.`];
  if (event.transfer) return [`${when} ${named(world.characters, event.who)} ${world.places.find(place => place.id === event.to)?.vehicle
    ? `gets into ${named(world.places, event.to)}` : `gets out of ${named(world.places, event.place)}`}.`];
  const who = named(world.characters, event.who);
  const what = event.kind === 'say' ? `${who} says${toFigure(world, event)}${gestured(event)}: "${event.text}"`
    : event.kind === 'call' ? `${who} calls ${event.to === viewer ? 'you' : named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `${who} leaves towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `${who} arrives.`
          : event.kind === 'sleep' ? `${who} falls asleep.`
            : event.kind === 'wake' ? `${who} wakes.` : world.deedEnds ? `${who} begins, for ${event.seconds} s: ${event.text}` : `${who} does (${event.seconds} s): ${event.text}`;
  return [...(event.says === undefined ? [] : [`${who} says: "${event.says}"`]), what].map(line => `${when} ${line}`);
}

function own(world: World, event: Event, when: string, span = `${event.seconds} s`): string[] {
  const what = event.kind === 'stop' ? null : event.transfer ? world.places.find(place => place.id === event.to)?.vehicle
    ? `You get into ${named(world.places, event.to)}.` : `You get out of ${named(world.places, event.place)}.`
    : event.kind === 'drive' ? `You drive ${named(world.places, event.place)} towards ${named(world.places, event.to)}.`
    : event.kind === 'say' ? `You say${toFigure(world, event)}${gestured(event)}: "${event.text}"`
    : event.kind === 'call' ? `You call ${named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `You leave towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `You arrive in ${named(world.places, event.place)}.`
          : event.kind === 'sleep' ? `You lie down to sleep (${span}).`
            : event.kind === 'wake' ? 'You wake.'
              : event.kind === 'do' ? world.deedEnds ? `You begin, ${span.startsWith('until') ? span : `for ${span}`}: ${event.text}` : `You do (${span}): ${event.text}` : `You wait (${span}).`;
  return [...(event.says === undefined ? [] : [`You say: "${event.says}"`]), ...(what === null ? [] : [what]), ...(event.moved?.some(posting => posting.sink === 'fare') ? [`You pay ${event.moved.reduce((sum, posting) => sum + posting.n!, 0)} ${event.moved[0].name}.`] : []), ...(event.note ? [`Your note: ${event.note}`] : []), ...(event.cut ? [CUT] : []), ...(event.deedCut ? [DEED_CUT] : [])].map(line => `${when} ${line}`);
}

export const worldOf = (world: World, state: State, at = state.buses?.at ?? 0): World => {
  const current = state.places === world.places ? world : { ...world, places: state.places };
  return state.buses ? { ...current, places: doorsOf(current.places.map(place => place.vehicle?.route
    ? { ...place, vehicle: busAt(current, place.vehicle, at) } : place)) } : current;
};
// Check the way again when the doer is free; it may no longer be usable.
export function wayDue(world: World, state: State, actor: Person): Extract<Record, { kind: 'act' }> | null {
  const way = state.ways?.get(actor.id);
  if (!way || actor.asleep || actor.place === null) return null;
  const action = readAction(world, actor, JSON.stringify({ action: 'go', place: way.place }), state.people, state.things);
  const vehicle = world.places.find(place => place.id === actor.place)?.vehicle;
  const drive = vehicle && typeof action !== 'string' && action.place !== vehicle.at
    ? { vehicle: actor.place, from: vehicle.at!, to: action.place!, at: actor.freeAt + driveSeconds(world, vehicle.at!, action.place!, vehicle.faster) } : undefined;
  return { kind: 'act', who: actor.id, at: actor.freeAt, limit: MAX_WORDS, action, fromDeed: way.seq,
    ...(drive ? { drive } : {}), ...(action === 'fare' ? { place: way.place } : {}) };
}
export const stoppedOf = (deed: Event) => `stopped after ${deed.worked} of ${deed.planned} s: ${deed.worked! < deed.planned! ? `${closed(deed.text!)} It was cut short.` : deed.text}`;
const settlement = (world: World, pending: { event: Event; seq: number }, at: number): Event => ({ ...pending.event,
  at, clock: clockAt(world, at), seconds: Math.min(at, pending.event.at + pending.event.seconds) - pending.event.at,
  ofDeed: pending.seq, worked: Math.min(at, pending.event.at + pending.event.seconds) - pending.event.at, planned: pending.event.seconds });
export function settlementDue(world: World, state: State): Event | null {
  if (!state.pending) return null;
  const actor = next(state.people), at = actor.freeAt;
  const law = LAWS.map(law => law.due?.(world, state.laws, actor)).find(record => record != null);
  const parked = vehicleDue(world, state);
  if (parked || law?.kind === 'weather' || actor.place === null || actor.asleep) return null;
  const due = [...state.pending.values()].filter(({ event }) => {
    const person = state.people.find(person => person.id === event.who)!;
    return person.freeAt === at && (at >= event.at + event.seconds || LAWS.some(law => law.due?.(world, state.laws, person)?.kind === 'spent'));
  }).sort((a, b) => a.seq - b.seq)[0];
  return due ? settlement(world, due, at) : null;
}
function doorsOf(places: Place[]): Place[] {
  return places.map(place => ({ ...place, nextDoor: places.filter(other => other !== place && (place.vehicle
    ? place.vehicle.at === other.id : other.vehicle ? other.vehicle.at === place.id : place.nextDoor.includes(other.id))).map(other => other.id) }));
}
export const vehicleDue = (world: World, state: State): { kind: 'park'; who: string; at: number } | null => {
  const until = next(state.people).freeAt;
  let first: { kind: 'park'; who: string; at: number } | null = null;
  for (const place of world.places) {
    const vehicle = place.vehicle;
    if (!vehicle) continue;
    const offer = (at: number) => { if (at <= until && (!first || at < first.at)) first = { kind: 'park', who: place.id, at }; };
    if (!vehicle.route) { if (vehicle.heading) offer(vehicle.heading.at); continue; }
    const after = state.buses!.at + (state.buses!.passed.includes(place.id) ? 1 : 0), clock = secondsOfDay(world.clock);
    for (const stop of busRound(world, vehicle)) {
      if (!state.people.some(person => !person.asleep && (person.place === place.id || person.place === stop.to))) continue;
      for (const time of vehicle.leaves!) {
        const offset = secondsOfDay(time) + stop.at - clock;
        offer(offset + Math.ceil((after - offset) / 86_400) * 86_400);
      }
    }
  }
  return first;
};
const tagged = ({ id, name }: { id: string; name: string }) => `${name} (${id})`;
export const standingAt = (world: World, people: Person[], id: string, at = 0) => world.places.filter(place => place.vehicle?.at === id).map(place => standingLine(world, people, place, at));
const standingLine = (world: World, people: Person[], place: Place, at: number) => {
  const seats = place.vehicle!.seats, free = seats - people.filter(person => person.place === place.id).length;
  return `Here stands: ${tagged(place)}, ${free} of ${seats} seat${seats === 1 ? '' : 's'} free${place.vehicle!.route ? `, leaving for ${named(world.places, place.vehicle!.departure!.to)} in ${remaining(place.vehicle!.departure!.at - at)}` : ''}.`;
};
const remaining = (seconds: number) => `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
// Passing time alone must not add another standing-vehicle line.
export function vehicleView(world: World, state: State, actor: Person, now: number): [string, string][] {
  if (!state.vehicleLines) return [];
  const shown = state.vehicleLines.get(actor.id)!;
  return world.places.filter(place => place.vehicle && place.id !== actor.place).flatMap(place => {
    const door = state.buses?.doors.get(`${actor.id} ${place.id}`), lines: [string, string][] = [];
    if (door?.place === actor.place && door.at <= now) lines.push([`departed ${place.id} ${door.at}`, `${place.name} has driven off.`]);
    if (place.vehicle!.at === actor.place) lines.push([`vehicle ${place.id}`, standingLine(world, state.people, place, now)]);
    return lines.filter(([key, text]) => shown.get(key)?.replace(/ in \d+ min \d+ s\.$/, '') !== text.replace(/ in \d+ min \d+ s\.$/, ''));
  });
}

export function begin(world: World): State {
  if (world.vehicles?.length) world = { ...world, places: doorsOf([...world.places, ...structuredClone(world.vehicles)]) };
  const state: State = { places: world.places, people: start(world), minds: new Map(world.characters.map(character => [character.id, { ...blank(), long: character.memory ?? '' }])), seq: 0, deed: null,
    results: new Map(world.places.map(place => [place.id, []])), said: new Map(world.places.map(place => [place.id, []])), things: stocked(world), laws: beginLaws(world), touches: [], traces: traced(world),
    marks: world.characters.flatMap(({ id, marks }) => marks.map(({ zone, kind, level, text }) => ({ of: id, zone, kind, layers: [{ level, text, since: null, until: null }] }))),
    ...(world.deedEnds ? { pending: new Map() } : {}),
    ...(world.ways ? { ways: new Map() } : {}),
    ...(world.vehicles?.length ? { vehicleLines: new Map(world.characters.map(character => [character.id, new Map()])) } : {}),
    ...(world.vehicles?.some(place => place.vehicle?.route) ? { buses: { at: 0, passed: [], waiting: new Set(), doors: new Map() } } : {}) };
  if (state.buses) state.places = worldOf(world, state).places;
  return state;
}

// After a refused record, the state may be partly changed and must not be used.
export function advance(world: World, state: State, record: Record): Event {
  const event = applied(worldOf(world, state, record.at), state, record);
  // The world must answer at the deed's end even while its doer is speaking or listening.
  for (const { event: deed } of state.pending?.values() ?? []) {
    const doer = state.people.find(person => person.id === deed.who)!;
    doer.freeAt = Math.min(doer.freeAt, deed.at + deed.seconds);
  }
  if (state.buses) {
    // Weather must leave bus arrivals due at its instant; parking closes it only for its own bus.
    const passed = state.buses.at === record.at ? state.buses.passed : [];
    state.buses = { ...state.buses, at: record.at, passed: record.kind === 'weather' ? passed : record.kind === 'park'
      ? [...passed, ...(state.places.find(place => place.id === record.who)?.vehicle?.route ? [record.who] : [])] : (world.vehicles ?? world.places).filter(place => place.vehicle?.route).map(place => place.id) };
    state.places = worldOf(world, state).places;
    if (record.kind === 'act') {
      if (event.kind === 'wait') state.buses.waiting.add(event.who);
      else state.buses.waiting.delete(event.who);
    }
    if (event.kind === 'sleep' || event.kind === 'wake' || event.kind === 'go' || event.kind === 'arrive') {
      for (const key of state.buses.doors.keys()) if (key.startsWith(`${event.who} `)) state.buses.doors.delete(key);
      if (event.kind === 'sleep' || event.kind === 'wake') state.buses.waiting.delete(event.who);
      if (event.transfer || event.kind === 'arrive') for (const place of state.places.filter(place => place.vehicle?.route && place.vehicle.at === state.people.find(person => person.id === event.who)!.place)) {
        state.buses.doors.set(`${event.who} ${place.id}`, { place: place.vehicle!.at!, at: place.vehicle!.departure!.at });
      }
    }
  }
  if (event.transfer || event.kind === 'arrive' || event.kind === 'wake' || event.kind === 'memory') state.vehicleLines?.get(event.who)?.clear();
  return event;
}

function applied(world: World, state: State, record: Record): Event {
  const { people, minds, seq } = state;
  const refuse = (problem: string): never => { throw new JournalError(`The journal cannot be used: record ${seq} ${problem}.`); };
  const when = (id: string, at: number) => timeFor(world, id, people.find(person => person.id === id)!.place, at);
  const deed = state.deed ?? settlementDue(world, state);
  if (deed?.kind === 'say' || record.kind === 'reply') {
    if (!deed || record.kind !== 'reply' || record.who !== deed.who || record.at !== deed.at || record.figure !== deed.to) return refuse('is not a figure\'s answer to a speech to it just before');
    const { text, moves } = record;
    if (!isDeepStrictEqual(readReply(JSON.stringify({ reply: text, moves })), { text, moves })) return refuse('holds an answer that the speech cannot have');
    const event = reply(world, people, state.things, deed, text, moves);
    if ('code' in event) return refuse('holds an answer that the rules of things refuse');
    const figure = named(namesOf(world), record.figure), speaker = named(world.characters, deed.who), end = deed.at + deed.seconds;
    if (text === null) remember(minds.get(deed.who)!, lineOf(seq, `${when(deed.who, end)} ${figure} does not answer.`));
    const moved = told(event, '');
    for (const id of event.heard) {
      if (text !== null) remember(minds.get(id)!, lineOf(seq, `${when(id, end)} ${figure} answers ${id === deed.who ? 'you' : speaker}: "${text}"`));
      if (moved) remember(minds.get(id)!, lineOf(seq, `${when(id, end)} ${moved}`));
    }
    const pending = state.pending?.get(deed.who)?.event;
    if (pending) people.find(person => person.id === deed.who)!.freeAt = Math.max(people.find(person => person.id === deed.who)!.freeAt, pending.at + pending.seconds);
    const kept = state.said.get(deed.place)!;
    kept.push(lineOf(seq, `${event.clock} ${speaker} to ${figure}: "${deed.text}" ${text === null ? `${figure} did not answer.` : `${figure}: "${text}"`}`));
    while (kept.length > 1 && kept.reduce((sum, line) => sum + line.size, 0) > SAID_WORDS) kept.shift();
    Object.assign(state, { deed: null, seq: seq + 1 });
    return event;
  }
  if (deed || record.kind === 'result') {
    if (!deed || record.kind !== 'result' || record.who !== deed.who || record.at !== deed.at) return refuse('is not the world\'s answer to a deed just before it');
    const spot = world.places.find(place => place.id === deed.place)!, sleepers = sleepersNear(people, spot).map(person => person.id);
    const present = people.filter(person => person.place === deed.place).map(person => person.id);
    const held = world.touch ? state.touches.filter(touch => present.includes(touch.of)) : undefined;
    const end = deed.at + (world.deedEnds ? 0 : deed.seconds), lasting = world.marks ? { marks: marksAt(state.marks, deed.at).filter(mark => present.includes(mark.of)), at: deed.at, end } : undefined;
    const extra = { ...(state.traces ? { traces: record.traces, wipes: record.wipes } : {}), ...(world.ways ? { goes: record.goes } : {}) };
    const { text, wakes, moves, sets, poses, feels, beyond, search, finds, touches, lingers } = record,
      answer = { text, wakes, moves, sets, poses, feels, beyond, search, finds, ...(touches === undefined ? {} : { touches }), ...(lingers === undefined ? {} : { lingers }), ...extra };
    const hidden = state.things.places.get(deed.place)!.filter(thing => thing.hidden).map(thing => thing.label);
    if (!isDeepStrictEqual(readResult(JSON.stringify({ result: text, wakes, moves, sets, poses, feels, beyond, search, finds, touches, lingers, ...extra }), sleepers, present, hidden, held, lasting, state.traces ? labelsOn(state.traces, present) : undefined, world.ways ? waysOf(world, people, people.find(person => person.id === deed.who)!, state.things) : undefined), answer)
      || (beyond !== null && !spot.nextDoor.length)) {
      return refuse('holds an answer of the world that the deed cannot have');
    }
    if (deed.worked === 0 && (text !== null || wakes.length || moves.length || sets.length || poses.length || feels.length || beyond !== null || search || finds.length
      || touches?.length || lingers?.length || record.traces?.length || record.wipes?.length || record.goes != null)) return refuse('gives a result to a deed with no time spent');
    const event = result(world, people, state.things, deed, answer, state.traces);
    if ('code' in event) return refuse('holds an answer that the rules of things refuse');
    if (world.deedEnds) Object.assign(event, { ofDeed: deed.ofDeed, worked: deed.worked, planned: deed.planned });
    if (world.ways && answer.goes !== null) state.ways!.set(deed.who, { place: answer.goes!, seq });
    if (touches) state.touches = touched(state.touches, touches, deed.at);
    if (lingers) state.marks = marked(state.marks, lingers, deed.at, end);
    const doer = named(world.characters, deed.who), moved = told(event, doer);
    // A feeling must reach only its owner, never another memory or the place's lines for the world.
    const felt = (id: string) => feels.filter(entry => entry.of === id).map(entry => `You feel: ${entry.text}`);
    const lines = [...(world.deedEnds ? [`You ${stoppedOf(deed)}`] : []), ...(text === null ? moved || felt(deed.who).length ? [] : [NOTHING] : [`What came of it: ${text}`]), ...(moved ? [moved] : []), ...felt(deed.who)];
    remember(minds.get(deed.who)!, ...lines.map(line => lineOf(seq, `${when(deed.who, event.at)} ${line}`)));
    for (const { id } of people) {
      if (id === deed.who) continue;
      const lines = [...(event.heard.includes(id) ? [...(world.deedEnds ? [`${doer} ${stoppedOf(deed)}`] : []), ...(text === null ? [] : [`What came of what ${doer} did: ${text}`]), ...(moved ? [moved] : [])] : []), ...felt(id)];
      remember(minds.get(id)!, ...lines.map(line => lineOf(seq, `${when(id, event.at)} ${line}`)));
    }
    // Someone next door, including a sleeper woken there, must learn only the sound.
    const from = named(world.places, deed.place);
    for (const id of event.nearby!) remember(minds.get(id)!, lineOf(seq, `${when(id, event.at)} From ${from}, next door: ${beyond}`));
    for (const id of record.wakes) minds.get(id)!.waiting.push(lineOf(seq, `${when(id, end)} ${present.includes(id) ? `${doer} woke you by this: ${deed.text}`
      : `Something from ${from}, next door, woke you${beyond === null ? '.' : `: ${beyond}`}`}`));
    const lists = listed(world, state.things, event, doer);
    if (text !== null || lists) {
      // Keep a line even for a move without words, or an older line could still describe a thing that is gone.
      const kept = state.results.get(deed.place)!;
      kept.push(lineOf(seq, `${event.clock} ${doer} did (${deed.seconds} s): ${text === null ? closed(deed.text as string) : `${deed.text} Result: ${lists ? closed(text) : text}`}${lists ? ` In the lists: ${lists}` : ''}`));
      while (kept.length > 1 && kept.reduce((sum, line) => sum + line.size, 0) > RESULT_WORDS) kept.shift();
    }
    for (const law of LAWS) law.after?.(state.laws, event);
    state.pending?.delete(deed.who);
    if (world.deedEnds) attend(people.find(person => person.id === deed.who)!, event.at);
    Object.assign(state, { deed: null, seq: seq + 1 });
    return event;
  }
  const actor = next(people), parked = vehicleDue(world, state);
  const lawDue = LAWS.map(law => law.due?.(world, state.laws, actor) ?? null).find(record => record !== null);
  if (parked && (!lawDue || parked.at < lawDue.at || (parked.at === lawDue.at && lawDue.kind !== 'weather'))) {
    if (!isDeepStrictEqual(record, parked)) return refuse('comes where a vehicle is due to arrive');
    const vehicle = world.places.find(place => place.id === parked.who)!;
    const heading = vehicle.vehicle!.route ? busRound(world, vehicle.vehicle!).find(stop => vehicle.vehicle!.leaves!.some(time =>
      (secondsOfDay(world.clock) + parked.at - secondsOfDay(time) - stop.at) % 86_400 === 0))! : vehicle.vehicle!.heading!;
    if (!vehicle.vehicle!.route) state.places = doorsOf(world.places.map(place => place === vehicle ? { ...place, vehicle: { ...vehicle.vehicle!, at: heading.to, heading: null } } : place));
    const here = people.filter(person => !person.asleep && (person.place === vehicle.id || person.place === heading.to));
    const event: Event = { at: parked.at, clock: clockAt(world, parked.at), kind: 'park', who: vehicle.id, place: heading.to, to: null,
      from: heading.from, text: null, seconds: 0, cut: false, heard: here.map(person => person.id), note: null };
    for (const person of here) {
      if (vehicle.vehicle!.route && person.place === heading.to) {
        const door = state.buses!.doors.get(`${person.id} ${vehicle.id}`);
        if (door?.place === person.place && door.at <= parked.at) {
          const mind = minds.get(person.id)!, shown = state.vehicleLines!.get(person.id)!, key = `departed ${vehicle.id} ${door.at}`, left = `${vehicle.name} has driven off.`;
          if (!shown.has(key)) { remember(mind, lineOf(seq, left)); shown.set(key, left); }
        }
      }
      if (!vehicle.vehicle!.route || person.place === vehicle.id || state.buses!.waiting.has(person.id)) attend(person, parked.at);
      remember(minds.get(person.id)!, lineOf(seq, `${when(person.id, parked.at)} ${person.place === vehicle.id
        ? `${vehicle.name} has arrived at ${named(world.places, heading.to)}.` : `${vehicle.name} has pulled up.`}`));
    }
    if (vehicle.vehicle!.route) for (const person of here.filter(person => person.place === heading.to)) {
      const text = standingLine(world, people, vehicle, parked.at), mind = minds.get(person.id)!;
      state.buses!.doors.set(`${person.id} ${vehicle.id}`, { place: heading.to, at: vehicle.vehicle!.departure!.at });
      // Someone not freed by the arrival must read the time left at its own next turn.
      if (!state.buses!.waiting.has(person.id)) { state.vehicleLines!.get(person.id)!.delete(`vehicle ${vehicle.id}`); continue; }
      remember(mind, lineOf(seq, text));
      state.vehicleLines!.get(person.id)!.set(`vehicle ${vehicle.id}`, text);
    }
    for (const person of people.filter(person => !vehicle.vehicle!.route && person.asleep && person.place === vehicle.id)) minds.get(person.id)!.waiting.push(
      lineOf(seq, `${when(person.id, parked.at)} ${vehicle.name} has arrived at ${named(world.places, heading.to)}.`));
    for (const law of LAWS) law.after?.(state.laws, event);
    state.seq += 1;
    return event;
  }
  if (record.kind === 'park') return refuse('is an arrival of a vehicle that is not due');
  for (const law of LAWS) {
    const put = law.due?.(world, state.laws, actor);
    if (!put || !law.put) continue;
    if (!isDeepStrictEqual(record, put)) return refuse('comes where the rules put a record of their own by the clock');
    const { event, lines } = law.put(world, state.laws, people, put);
    for (const [id, line] of lines) remember(minds.get(id)!, { ...lineOf(seq, line.text), ...(line.idle ? { idle: true as const } : {}) });
    for (const id of event.heard) if (!lines.has(id)) remember(minds.get(id)!, ...perceived(world, event, id, when(id, event.at)).map(line => lineOf(seq, line)));
    for (const other of LAWS) other.after?.(state.laws, event);
    state.seq += 1;
    return event;
  }
  if (record.kind === 'spent' || record.kind === 'weather') return refuse('is a record that only the clock brings, and it is not due');
  if (record.who !== actor.id || record.at !== actor.freeAt) return refuse('is not the next thing to happen in its world');
  const way = wayDue(world, state, actor);
  if (way ? !isDeepStrictEqual(record, way) : record.kind === 'act' && record.fromDeed !== undefined) return refuse('is not the way due from a deed');
  const mind = minds.get(actor.id)!;
  let event: Event;
  if (record.kind === 'memory') {
    const reaches = actor.asleep ? mind.lines.at(-1)?.seq === record.upTo : mind.lines.some(line => line.seq === record.upTo);
    if (actor.place === null || !reaches) return refuse('folds lines its character does not hold');
    if (record.text === null ? record.cut : !record.text.trim() || sizeOf(record.text) > world.longWords) return refuse('holds a memory outside its limit');
    rewrite(mind, record.upTo, record.text);
    event = { at: record.at, clock: clockAt(world, record.at), kind: 'memory', who: actor.id, place: actor.place, to: null, text: record.text,
      seconds: 0, cut: record.cut, heard: [], note: null };
  } else if (record.kind === 'act') {
    if (actor.asleep || actor.place === null) return refuse('is an action of someone asleep or on the way');
    if (!way && mind.size > world.shortWords) return refuse('is an action of someone whose memory was not folded first');
    if (!Number.isInteger(record.limit) || record.limit < 1 || record.limit > MAX_WORDS) return refuse('holds a word limit that no turn has');
    // Read a capped span from one second more to verify that the cap could have come from readAction().
    const reason = typeof record.action === 'string' ? record.action : null, taken = typeof record.action === 'string' ? null : record.action as Action | null,
      asked = taken?.capped === undefined ? taken : { ...taken, seconds: (taken.seconds ?? 0) + 1 };
    const checked = reason ? null : readAction(world, actor, JSON.stringify(asked), people, state.things);
    // The original deed text is not kept, so replay checks the cut flag separately.
    if (checked && typeof checked !== 'string' && checked.action === 'do' && taken?.deedCut === true) checked.deedCut = true;
    if (reason === 'fare' ? readAction(world, actor, JSON.stringify({ action: 'go', place: record.place }), people, state.things) !== reason
      : reason ? !isRefusal(reason) || (['vehicle', 'full', 'driving', 'driver', 'reach'].includes(reason) && !world.vehicles?.length) || (reason === 'round' && !state.buses) : !isDeepStrictEqual(checked, record.action)) {
      return refuse('holds an action its character cannot take');
    }
    const action = typeof record.action === 'string' ? { action: 'wait' as const, text: null, to: null, place: null, seconds: LOST_SECONDS, until: null, note: null } : record.action;
    for (const [key, text] of vehicleView(world, state, actor, record.at)) {
      remember(mind, lineOf(seq, text));
      state.vehicleLines!.get(actor.id)!.set(key, text);
    }
    if (state.buses) for (const [key, door] of state.buses.doors) if (key.startsWith(`${actor.id} `) && door.at <= record.at) state.buses.doors.delete(key);
    for (const place of world.places.filter(place => place.vehicle?.route && place.vehicle.at === actor.place)) {
      state.buses!.doors.set(`${actor.id} ${place.id}`, { place: actor.place!, at: place.vehicle!.departure!.at });
    }
    const vehicle = world.places.find(place => place.id === actor.place)?.vehicle;
    const drive = vehicle && action.action === 'go' && action.place !== vehicle.at ? { vehicle: actor.place!, from: vehicle.at!, to: action.place!,
      at: record.at + driveSeconds(world, vehicle.at!, action.place!, vehicle.faster) } : undefined;
    if (!isDeepStrictEqual(record.drive, drive)) return refuse('holds a drive different from the one its character takes');
    const pending = state.pending?.get(actor.id)?.event;
    event = apply(world, people, actor, action, record.at, record.limit, pending, typeof record.action === 'string');
    if (way) {
      event.fromDeed = way.fromDeed;
      state.ways!.delete(actor.id);
    }
    const fare = event.transfer ? world.places.find(place => place.id === event.to)?.vehicle?.fare : undefined;
    if (fare) event.moved = pay(state.things, actor.id, fare.name, fare.n, named(world.characters, actor.id));
    if (drive && event.kind !== 'stop') state.places = doorsOf(world.places.map(place => place.id === drive.vehicle ? { ...place,
      vehicle: { ...place.vehicle!, at: null, heading: { from: drive.from, to: drive.to, at: drive.at } } } : place));
    if (event.kind === 'go') state.touches = state.touches.filter(touch => touch.of !== actor.id && touch.to !== actor.id);
    // The actor may have left; its memory must use the place where it acted.
    const told = timeFor(world, actor.id, event.place, event.at);
    const span = (pending && action.action === 'wait') || action.until === null || hasClock(world, actor.id, event.place) ? undefined : `until about ${action.until}`;
    const lines = (reason ? [`${told} ${refused(world, reason, record.place)}`] : own(world, event, told, span)).map(line => lineOf(seq, line));
    if (event.kind === 'sleep') lines[0].idle = true;
    remember(mind, ...lines);
    if (event.kind === 'do' && state.pending) state.pending.set(actor.id, { event, seq });
    else if (event.kind === 'stop') state.deed = settlement(world, state.pending!.get(actor.id)!, record.at);
    else if (event.kind === 'do' || (event.kind === 'say' && event.to !== null)) state.deed = event;
  } else {
    // Fold the sleeper's earlier lines before waking so it wakes with only its long-term memory.
    const due = record.kind === 'wake' ? actor.asleep && idle(mind) : actor.place === null;
    if (!due) return refuse('is a waking or an arrival of someone who is not due one');
    event = record.kind === 'wake' ? wake(world, people, actor, record.at) : arrive(world, people, actor, record.at);
    remember(mind, ...mind.waiting.splice(0), ...own(world, event, when(actor.id, event.at)).map(line => ({ ...lineOf(seq, line), ...(record.kind === 'wake' ? { idle: true as const } : {}) })));
  }
  for (const id of event.heard) remember(minds.get(id)!, ...(event.kind === 'drive'
    ? [`${when(id, event.at)} ${named(world.characters, event.who)} drives ${named(world.places, event.place)} towards ${named(world.places, event.to)}.`]
    : perceived(world, event, id, when(id, event.at))).map(line => lineOf(seq, line)));
  for (const id of event.nearby ?? []) remember(minds.get(id)!, ...perceived(world, event, id, when(id, event.at)).map(line => lineOf(seq, line)));
  if (event.kind === 'call' && !event.heard.includes(event.to as string)) {
    const callee = people.find(person => person.id === event.to)!;
    minds.get(callee.id)!.waiting.push(lineOf(seq, `${when(callee.id, event.at)} ${named(world.characters, event.who)} called you (${world.remote}) while you were ${
      callee.asleep ? 'asleep' : 'on the way'}: "${event.text}"`));
  }
  for (const law of LAWS) law.after?.(state.laws, event);
  state.seq += 1;
  return event;
}

// Saved events must match replay to the letter.
export function replay(world: World, entries: Iterable<Entry>): State {
  const state = begin(world);
  for (const entry of entries) {
    if (entry.seq !== state.seq) throw new JournalError(`The journal cannot be used: record ${state.seq} is missing.`);
    if (!isDeepStrictEqual(advance(world, state, entry.record), entry.event)) {
      throw new JournalError(`The journal cannot be used: record ${entry.seq} does not give the event stored with it.`);
    }
  }
  return state;
}
