// The journal of a live world: an append-only sequence of records, and the only state there is. A record is what was
// decided outside the rules: what a character answered, that an arrival or a waking came due, what a character wrote
// as its memory. `advance` is the one way a record changes the world, for a run and for a replay alike, and it gives
// the record's event. So the same records always give the same world, and any beginning of a journal is a whole world
// at that moment. No model and no disk here.
import { isDeepStrictEqual } from 'node:util';

import { blank, idle, lineOf, remember, rewrite } from './memory.ts';
import type { Line, Mind } from './memory.ts';
import { beginLaws, LAWS } from './laws.ts';
import type { LawRecord, Parts } from './laws.ts';
import { apply, arrive, attend, isRefusal, next, readAction, sleepersNear, start, wake } from './action.ts';
import { readReply, reply, readResult, result } from './answer.ts';
import { all, pay, stocked } from './things.ts';
import { busAt, busRound, clockAt, driveSeconds, hasClock, timeFor } from './time.ts';
import { secondsOfDay, closed } from './reading.ts';
import { namesOf, LOST_SECONDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, sizeOf } from './world.ts';
import type { Action, Refusal } from './action.ts';
import type { Answer } from './answer.ts';
import type { Move, Things } from './things.ts';
import type { Event, Person, Place, World } from './world.ts';

// The sentences about a journal that the rules cannot have written; they are this file's own and may be shown.
export class JournalError extends Error {}

// `act`: the action as it was read from the answer, or the reason why the answer could not be used, with that turn's
// word limit. `memory`: the new long-term text, or null for a rewrite that was lost, and the record up to which the
// short-term lines were folded into it. `result`: the world's answer to the `do` just before it, of the same `who` and
// `at`: what came of the deed, or null, the sleepers it wakes, what it moved by label and where to, the states and
// the poses it changed, what it makes a body feel, each line with its owner, what of it is heard next door, whether the deed was a search of its
// place, and the labels of the hidden things it went straight to. `reply`: what a figure answers to the `say` addressed to it just before, of the same `who` and `at`:
// its words, or null, and what changed hands with them. Neither is ever an answer that the rules of things refuse.
// A record of a law (`laws.ts`) is put by the rules when the clock reaches its moment; like an arrival and a waking,
// no answer is behind it.
export type Record = { kind: 'act'; who: string; at: number; limit: number; action: Action | Refusal; place?: string; drive?: { vehicle: string; from: string; to: string; at: number } }
  | { kind: 'park'; who: string; at: number }
  | { kind: 'arrive' | 'wake'; who: string; at: number }
  | { kind: 'memory'; who: string; at: number; text: string | null; upTo: number; cut: boolean }
  | { kind: 'reply'; who: string; at: number; figure: string; text: string | null; moves: Move[] }
  | ({ kind: 'result'; who: string; at: number } & Answer)
  | LawRecord;
// `by` is the name of the model whose answer the record came of, and null for a record no answer is behind. The rules
// never read it: the same records give the same world whoever answered.
export type Entry = { seq: number; record: Record; event: Event; by: string | null };
// Everything a journal amounts to: where everyone is and what each one remembers. `seq` is the next record's number.
// `deed` is a `do`, or a `say` to a figure, that the world has not answered yet: its answer is the only record that
// can come next. `results` holds, for each place, the latest of what came of the deeds done there, in the world's
// words and in what the rules moved, set and found, which the world is shown when it answers the next, and `said` the latest of what was said to the figures of the place and answered.
// `things` is what each place and each person holds now, with how long each person has searched each place, and `laws`
// holds the parts of the state that the laws of `laws.ts` keep.
export type State = { places: Place[]; vehicleLines?: Map<string, Map<string, string>>; people: Person[]; minds: Map<string, Mind>; seq: number; deed: Event | null; results: Map<string, Line[]>;
  said: Map<string, Line[]>; things: Things; laws: Parts; buses?: { at: number; passed: string[]; waiting: Set<string>; doors: Map<string, { place: string; at: number }> } };
// How many words of earlier results a place keeps. The newest one stays whatever its size.
export const RESULT_WORDS = 400;
// How many words of earlier speeches to its figures and their answers a place keeps, the newest whatever its size.
export const SAID_WORDS = 300;
// Where a journal is kept. `append` is one step: its entries are written together or not at all.
export type Store = { entries(): Iterable<Entry>; append(entries: Entry[]): void };
// The sentences about a place where a journal is kept that cannot be used, a state file for one; they may be shown.
export class StateError extends Error {}

export const memoryStore = (): Store & { all: Entry[] } => {
  const all: Entry[] = [];
  return { all, entries: () => all, append: entries => { all.push(...entries); } };
};

// The fixed sentences a character's own lines may hold.
export const UNUSABLE = `Your answer could not be used and counted as a wait of ${LOST_SECONDS} seconds.`;
// What follows it, for each reason. The model that plays the character reads it, so it says what to do instead.
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
// A turn that the service declined to write has no sentence of its own: its character reads what one reads whose
// answer was no JSON object, and only the record says which of the two it was.
export const refused = (world: World, reason: Refusal, place?: string) => `${UNUSABLE} ${reason === 'fare' ? `You need ${world.places.find(item => item.id === place)!.vehicle!.fare!.n} ${world.places.find(item => item.id === place)!.vehicle!.fare!.name} for the fare.`
  : reason === 'to' && world.remote === null ? NO_REMOTE : INSTEAD[reason === 'declined' ? 'json' : reason]}`;
export const CUT = 'Your speech was longer than the limit: the others heard only its first words.';
const NOTHING = 'Nothing came of it that could be noticed.';

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
// What an answer did to things, as everyone who perceived it is told: from the postings the rules made, never from
// the answer's words. No label is in it, and a thing that stayed on one person or in one thing of the place is not.
const told = (event: Event, doer: string) => [
  ...(event.moved ?? []).filter(posting => posting.out !== posting.into).map(({ name, n, to, out, into }) => `${name}${n === null ? '' : ` ×${n}`} ${
    to === 'eaten' ? `was eaten or drunk up by ${doer}` : to === 'burned' ? 'burned up' : `went from ${out} to ${into}`}.`),
  ...(event.set ?? []).map(({ name, state }) => `${name} is now ${state}.`),
  ...(event.found ?? []).map(({ name, spot }) => `${name} was found: ${spot}.`)].join(' ');
// The same for the world, in the line a place keeps: every posting, each thing under the label it has now, and where
// it went as the answer's `to` said it and as a request writes that holder, a thing by its label, a person or the
// place by its id. The other wording names the person and not the pocket, and a model that reads it answers so.
const listed = (world: World, things: Things, event: Event, doer: string) => {
  const within = [...things.places.get(event.place)!, ...[...things.people.values()].flat()];
  const holder = (id: string) => { const one = [...world.characters, ...world.places].find(item => item.id === id); return one ? `${one.name} (${id})` : `${id} ${all(within).find(thing => thing.label === id)?.name ?? ''}`.trim(); };
  return [...(event.moved ?? []).map(({ what, name, n, to, as }) => `${as ?? what} ${name}${n === null ? '' : ` ×${n}`} ${
    to === 'eaten' ? `was eaten or drunk up by ${doer}` : to === 'burned' ? 'burned up' : `went to ${holder(to)}`}.`),
  ...(event.set ?? []).map(({ what, name, state }) => `${what} ${name} is now ${state}.`),
  ...(event.found ?? []).map(({ what, name, spot }) => `${what} ${name} was found: ${spot}.`)].join(' ');
};
// A speech as it opens when it is addressed to a figure of the place.
const toFigure = (world: World, event: Event) => event.kind === 'say' && event.to !== null ? ` to ${named(namesOf(world), event.to)}` : '';
// What the speaker's body did meanwhile, as the line of a speech holds it before the words.
const gestured = (event: Event) => event.gesture === undefined ? '' : ` (${event.gesture})`;

// An event as one who perceived it remembers it, under the time as that one could tell it, `when`: one line, and
// before the line of a deed done with words the line of those words, as of a speech. A note is never part of it.
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
            : event.kind === 'wake' ? `${who} wakes.` : `${who} does (${event.seconds} s): ${event.text}`;
  return [...(event.says === undefined ? [] : [`${who} says: "${event.says}"`]), what].map(line => `${when} ${line}`);
}

// What a character remembers of its own action: the action, its note, and the sentence about a speech that was cut.
// The first line is the action itself, or the words said with a deed, and the deed is then the second. `when` is the time as the character could tell it, and `span` how long the
// action lasts as the character knows it.
function own(world: World, event: Event, when: string, span = `${event.seconds} s`): string[] {
  const what = event.transfer ? world.places.find(place => place.id === event.to)?.vehicle
    ? `You get into ${named(world.places, event.to)}.` : `You get out of ${named(world.places, event.place)}.`
    : event.kind === 'drive' ? `You drive ${named(world.places, event.place)} towards ${named(world.places, event.to)}.`
    : event.kind === 'say' ? `You say${toFigure(world, event)}${gestured(event)}: "${event.text}"`
    : event.kind === 'call' ? `You call ${named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `You leave towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `You arrive in ${named(world.places, event.place)}.`
          : event.kind === 'sleep' ? `You lie down to sleep (${span}).`
            : event.kind === 'wake' ? 'You wake.'
              : event.kind === 'do' ? `You do (${span}): ${event.text}` : `You wait (${span}).`;
  return [...(event.says === undefined ? [] : [`You say: "${event.says}"`]), what, ...(event.moved?.some(posting => posting.sink === 'fare') ? [`You pay ${event.moved.reduce((sum, posting) => sum + posting.n!, 0)} ${event.moved[0].name}.`] : []), ...(event.note ? [`Your note: ${event.note}`] : []), ...(event.cut ? [CUT] : [])].map(line => `${when} ${line}`);
}

export const worldOf = (world: World, state: State, at = state.buses?.at ?? 0): World => {
  const current = state.places === world.places ? world : { ...world, places: state.places };
  return state.buses ? { ...current, places: doorsOf(current.places.map(place => place.vehicle?.route
    ? { ...place, vehicle: busAt(current, place.vehicle, at) } : place)) } : current;
};
// Only the door of a standing vehicle joins it to another place. Each change makes a new list for the run.
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
// Standing vehicles are told when first seen or when their seats change, never for the passing of time alone.
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
    results: new Map(world.places.map(place => [place.id, []])), said: new Map(world.places.map(place => [place.id, []])), things: stocked(world), laws: beginLaws(world),
    ...(world.vehicles?.length ? { vehicleLines: new Map(world.characters.map(character => [character.id, new Map()])) } : {}),
    ...(world.vehicles?.some(place => place.vehicle?.route) ? { buses: { at: 0, passed: [], waiting: new Set(), doors: new Map() } } : {}) };
  if (state.buses) state.places = worldOf(world, state).places;
  return state;
}

// One record applied to the world: the event it makes, with everyone moved on and every memory brought up to date.
// A record that the rules could not have produced in this state is refused, and the state is then not to be used.
export function advance(world: World, state: State, record: Record): Event {
  const event = applied(worldOf(world, state, record.at), state, record);
  if (state.buses) {
    // A record closes its instant to the arrivals of every bus, but for two kinds: a vehicle's arrival closes it to that
    // vehicle alone, and a change of the weather to none, since it comes before the vehicles due at its instant.
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

// The record by itself, with the current vehicle positions.
function applied(world: World, state: State, record: Record): Event {
  const { people, minds, seq } = state;
  const refuse = (problem: string): never => { throw new JournalError(`The journal cannot be used: record ${seq} ${problem}.`); };
  // The time of a line as its owner can tell it where it is: the clock only when one is at hand.
  const when = (id: string, at: number) => timeFor(world, id, people.find(person => person.id === id)!.place, at);
  const deed = state.deed;
  if (deed?.kind === 'say' || record.kind === 'reply') {
    // A speech to a figure is followed by that figure's answer and by nothing else, and a figure answers nothing else.
    if (!deed || record.kind !== 'reply' || record.who !== deed.who || record.at !== deed.at || record.figure !== deed.to) return refuse('is not a figure\'s answer to a speech to it just before');
    const { text, moves } = record;
    if (!isDeepStrictEqual(readReply(JSON.stringify({ reply: text, moves })), { text, moves })) return refuse('holds an answer that the speech cannot have');
    const event = reply(world, people, state.things, deed, text, moves);
    if ('code' in event) return refuse('holds an answer that the rules of things refuse');
    const figure = named(namesOf(world), record.figure), speaker = named(world.characters, deed.who), end = deed.at + deed.seconds;
    // The speaker learns that nothing was answered; the others heard the speech and nothing after it.
    if (text === null) remember(minds.get(deed.who)!, lineOf(seq, `${when(deed.who, end)} ${figure} does not answer.`));
    const moved = told(event, '');
    for (const id of event.heard) {
      if (text !== null) remember(minds.get(id)!, lineOf(seq, `${when(id, end)} ${figure} answers ${id === deed.who ? 'you' : speaker}: "${text}"`));
      if (moved) remember(minds.get(id)!, lineOf(seq, `${when(id, end)} ${moved}`));
    }
    // The place keeps what was said to its figures and what they answered, the latest of it.
    const kept = state.said.get(deed.place)!;
    kept.push(lineOf(seq, `${event.clock} ${speaker} to ${figure}: "${deed.text}" ${text === null ? `${figure} did not answer.` : `${figure}: "${text}"`}`));
    while (kept.length > 1 && kept.reduce((sum, line) => sum + line.size, 0) > SAID_WORDS) kept.shift();
    Object.assign(state, { deed: null, seq: seq + 1 });
    return event;
  }
  if (deed || record.kind === 'result') {
    // A deed is followed by the world's answer and by nothing else, and the world answers nothing but a deed.
    if (!deed || record.kind !== 'result' || record.who !== deed.who || record.at !== deed.at) return refuse('is not the world\'s answer to a deed just before it');
    const spot = world.places.find(place => place.id === deed.place)!, sleepers = sleepersNear(people, spot).map(person => person.id);
    const present = people.filter(person => person.place === deed.place).map(person => person.id);
    const { text, wakes, moves, sets, poses, feels, beyond, search, finds } = record, answer = { text, wakes, moves, sets, poses, feels, beyond, search, finds };
    const hidden = state.things.places.get(deed.place)!.filter(thing => thing.hidden).map(thing => thing.label);
    // Nothing is heard next door of a deed in a place that has no place next door.
    if (!isDeepStrictEqual(readResult(JSON.stringify({ result: text, wakes, moves, sets, poses, feels, beyond, search, finds }), sleepers, present, hidden), answer)
      || (beyond !== null && !spot.nextDoor.length)) {
      return refuse('holds an answer of the world that the deed cannot have');
    }
    const event = result(world, people, state.things, deed, answer);
    if ('code' in event) return refuse('holds an answer that the rules of things refuse');
    const doer = named(world.characters, deed.who), moved = told(event, doer);
    // What the answer says came of the deed, and after it what the rules say went where, for the doer and for those there.
    // What a body feels is told to its owner alone, last, and also when nothing came of the deed for anyone else:
    // it is in no line of another person and in nothing that the place keeps for the world.
    const felt = (id: string) => feels.filter(entry => entry.of === id).map(entry => `You feel: ${entry.text}`);
    const lines = [...(text === null ? moved || felt(deed.who).length ? [] : [NOTHING] : [`What came of it: ${text}`]), ...(moved ? [moved] : []), ...felt(deed.who)];
    remember(minds.get(deed.who)!, ...lines.map(line => lineOf(seq, `${when(deed.who, event.at)} ${line}`)));
    for (const { id } of people) {
      if (id === deed.who) continue;
      const lines = [...(event.heard.includes(id) ? [...(text === null ? [] : [`What came of what ${doer} did: ${text}`]), ...(moved ? [moved] : [])] : []), ...felt(id)];
      remember(minds.get(id)!, ...lines.map(line => lineOf(seq, `${when(id, event.at)} ${line}`)));
    }
    // What is heard next door is one line with the deed's place and the world's words for the sound: it holds
    // nothing else of the deed, and a sleeper woken from next door wakes with no more than that. The place keeps none of it.
    const from = named(world.places, deed.place);
    for (const id of event.nearby!) remember(minds.get(id)!, lineOf(seq, `${when(id, event.at)} From ${from}, next door: ${beyond}`));
    for (const id of record.wakes) minds.get(id)!.waiting.push(lineOf(seq, `${when(id, deed.at + deed.seconds)} ${present.includes(id) ? `${doer} woke you by this: ${deed.text}`
      : `Something from ${from}, next door, woke you${beyond === null ? '.' : `: ${beyond}`}`}`));
    const lists = listed(world, state.things, event, doer);
    if (text !== null || lists) {
      // The place keeps what came of the deeds done in it, the latest ones: the world's words, and after them what the
      // rules say went where, under labels, so that a deed that only moved a thing leaves a line and no older line is the last word
      // about a thing that has gone since.
      const kept = state.results.get(deed.place)!;
      kept.push(lineOf(seq, `${event.clock} ${doer} did (${deed.seconds} s): ${text === null ? closed(deed.text as string) : `${deed.text} Result: ${lists ? closed(text) : text}`}${lists ? ` In the lists: ${lists}` : ''}`));
      while (kept.length > 1 && kept.reduce((sum, line) => sum + line.size, 0) > RESULT_WORDS) kept.shift();
    }
    Object.assign(state, { deed: null, seq: seq + 1 });
    return event;
  }
  const actor = next(people), parked = vehicleDue(world, state);
  const lawDue = LAWS.map(law => law.due(world, state.laws, actor)).find(record => record !== null);
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
      // Whoever the pull-up does not free reads the standing line at its own next turn, with the time left then.
      if (!state.buses!.waiting.has(person.id)) { state.vehicleLines!.get(person.id)!.delete(`vehicle ${vehicle.id}`); continue; }
      remember(mind, lineOf(seq, text));
      state.vehicleLines!.get(person.id)!.set(`vehicle ${vehicle.id}`, text);
    }
    // As with a call, a sleeper receives this notice when it wakes and hears nothing at the arrival.
    for (const person of people.filter(person => !vehicle.vehicle!.route && person.asleep && person.place === vehicle.id)) minds.get(person.id)!.waiting.push(
      lineOf(seq, `${when(person.id, parked.at)} ${vehicle.name} has arrived at ${named(world.places, heading.to)}.`));
    for (const law of LAWS) law.after?.(state.laws, event);
    state.seq += 1;
    return event;
  }
  if (record.kind === 'park') return refuse('is an arrival of a vehicle that is not due');
  // A record the clock brings comes where its law says it is due, and nothing else comes there.
  for (const law of LAWS) {
    const put = law.due(world, state.laws, actor);
    if (!put) continue;
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
  const mind = minds.get(actor.id)!;
  let event: Event;
  if (record.kind === 'memory') {
    // A sleeper folds everything it lived through before the sleep; anyone else folds its oldest lines.
    const reaches = actor.asleep ? mind.lines.at(-1)?.seq === record.upTo : mind.lines.some(line => line.seq === record.upTo);
    if (actor.place === null || !reaches) return refuse('folds lines its character does not hold');
    if (record.text === null ? record.cut : !record.text.trim() || sizeOf(record.text) > world.longWords) return refuse('holds a memory outside its limit');
    rewrite(mind, record.upTo, record.text);
    event = { at: record.at, clock: clockAt(world, record.at), kind: 'memory', who: actor.id, place: actor.place, to: null, text: record.text,
      seconds: 0, cut: record.cut, heard: [], note: null };
  } else if (record.kind === 'act') {
    if (actor.asleep || actor.place === null) return refuse('is an action of someone asleep or on the way');
    if (mind.size > world.shortWords) return refuse('is an action of someone whose memory was not folded first');
    if (!Number.isInteger(record.limit) || record.limit < 1 || record.limit > MAX_WORDS) return refuse('holds a word limit that no turn has');
    // An answer that could not be used is kept as its reason, which must be one of the list; an action must read as itself.
    // An action whose span was cut reads as itself from one second more, so the mark stands on nothing else.
    const reason = typeof record.action === 'string' ? record.action : null, taken = typeof record.action === 'string' ? null : record.action as Action | null,
      asked = taken?.capped === undefined ? taken : { ...taken, seconds: (taken.seconds ?? 0) + 1 };
    if (reason === 'fare' ? readAction(world, actor, JSON.stringify({ action: 'go', place: record.place }), people, state.things) !== reason
      : reason ? !isRefusal(reason) || (['vehicle', 'full', 'driving', 'driver', 'reach'].includes(reason) && !world.vehicles?.length) || (reason === 'round' && !state.buses) : !isDeepStrictEqual(readAction(world, actor, JSON.stringify(asked), people, state.things), record.action)) {
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
    event = apply(world, people, actor, action, record.at, record.limit);
    const fare = event.transfer ? world.places.find(place => place.id === event.to)?.vehicle?.fare : undefined;
    if (fare) event.moved = pay(state.things, actor.id, fare.name, fare.n, named(world.characters, actor.id));
    if (drive) state.places = doorsOf(world.places.map(place => place.id === drive.vehicle ? { ...place,
      vehicle: { ...place.vehicle!, at: null, heading: { from: drive.from, to: drive.to, at: drive.at } } } : place));
    // The actor may have left: its own lines are of the place where it acted. An action `until` a time of day is
    // remembered by its seconds only with a clock at hand; otherwise by the time it aimed at, which it may miss.
    const told = timeFor(world, actor.id, event.place, event.at);
    const span = action.until === null || hasClock(world, actor.id, event.place) ? undefined : `until about ${action.until}`;
    const lines = (reason ? [`${told} ${refused(world, reason, record.place)}`] : own(world, event, told, span)).map(line => lineOf(seq, line));
    if (event.kind === 'sleep') lines[0].idle = true;
    remember(mind, ...lines);
    if (event.kind === 'do' || (event.kind === 'say' && event.to !== null)) state.deed = event;
  } else {
    // A sleeper wakes with its long-term memory and no line of anything it lived through, so those were folded first.
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
    // The call was not heard: it waits for the arrival or the waking of the one called.
    const callee = people.find(person => person.id === event.to)!;
    minds.get(callee.id)!.waiting.push(lineOf(seq, `${when(callee.id, event.at)} ${named(world.characters, event.who)} called you (${world.remote}) while you were ${
      callee.asleep ? 'asleep' : 'on the way'}: "${event.text}"`));
  }
  for (const law of LAWS) law.after?.(state.laws, event);
  state.seq += 1;
  return event;
}

// The world a journal amounts to. Every record must give the event stored with it, to the letter.
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
