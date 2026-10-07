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
import { apply, arrive, isRefusal, next, readAction, sleepersNear, start, wake } from './action.ts';
import { readReply, reply, readResult, result } from './answer.ts';
import { all, stocked } from './things.ts';
import { clockAt, hasClock, timeFor } from './time.ts';
import { closed } from './reading.ts';
import { namesOf, LOST_SECONDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, sizeOf } from './world.ts';
import type { Action, Refusal } from './action.ts';
import type { Answer } from './answer.ts';
import type { Move, Things } from './things.ts';
import type { Event, Person, World } from './world.ts';

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
export type Record = { kind: 'act'; who: string; at: number; limit: number; action: Action | Refusal }
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
export type State = { people: Person[]; minds: Map<string, Mind>; seq: number; deed: Event | null; results: Map<string, Line[]>;
  said: Map<string, Line[]>; things: Things; laws: Parts };
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
  long: 'It ran on to the limit of one answer and was lost whole. Answer with the one JSON object, at once and briefly.',
  time: `A \`do\` or a \`wait\` lasts 1 to ${MAX_SECONDS} seconds and a \`sleep\` 1 to ${MAX_SLEEP}, given as \`seconds\` or as \`until\`, a time of day like 06:30.`,
};
const NO_REMOTE = 'There is no means of remote contact here: to reach someone, go where they are.';
// A turn that the service declined to write has no sentence of its own: its character reads what one reads whose
// answer was no JSON object, and only the record says which of the two it was.
export const refused = (world: World, reason: Refusal) => `${UNUSABLE} ${reason === 'to' && world.remote === null ? NO_REMOTE : INSTEAD[reason === 'declined' ? 'json' : reason]}`;
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
  const what = event.kind === 'say' ? `You say${toFigure(world, event)}${gestured(event)}: "${event.text}"`
    : event.kind === 'call' ? `You call ${named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `You leave towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `You arrive in ${named(world.places, event.place)}.`
          : event.kind === 'sleep' ? `You lie down to sleep (${span}).`
            : event.kind === 'wake' ? 'You wake.'
              : event.kind === 'do' ? `You do (${span}): ${event.text}` : `You wait (${span}).`;
  return [...(event.says === undefined ? [] : [`You say: "${event.says}"`]), what, ...(event.note ? [`Your note: ${event.note}`] : []), ...(event.cut ? [CUT] : [])].map(line => `${when} ${line}`);
}

export const begin = (world: World): State =>
  ({ people: start(world), minds: new Map(world.characters.map(character => [character.id, { ...blank(), long: character.memory ?? '' }])), seq: 0, deed: null,
    results: new Map(world.places.map(place => [place.id, []])), said: new Map(world.places.map(place => [place.id, []])), things: stocked(world), laws: beginLaws(world) });

// One record applied to the world: the event it makes, with everyone moved on and every memory brought up to date.
// A record that the rules could not have produced in this state is refused, and the state is then not to be used.
export function advance(world: World, state: State, record: Record): Event {
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
  const actor = next(people);
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
    const reason = typeof record.action === 'string' ? record.action : null;
    if (reason ? !isRefusal(reason) : !isDeepStrictEqual(readAction(world, actor, JSON.stringify(record.action)), record.action)) {
      return refuse('holds an action its character cannot take');
    }
    const action = typeof record.action === 'string' ? { action: 'wait' as const, text: null, to: null, place: null, seconds: LOST_SECONDS, until: null, note: null } : record.action;
    event = apply(world, people, actor, action, record.at, record.limit);
    // The actor may have left: its own lines are of the place where it acted. An action `until` a time of day is
    // remembered by its seconds only with a clock at hand; otherwise by the time it aimed at, which it may miss.
    const told = timeFor(world, actor.id, event.place, event.at);
    const span = action.until === null || hasClock(world, actor.id, event.place) ? undefined : `until about ${action.until}`;
    const lines = (reason ? [`${told} ${refused(world, reason)}`] : own(world, event, told, span)).map(line => lineOf(seq, line));
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
  for (const id of event.heard) remember(minds.get(id)!, ...perceived(world, event, id, when(id, event.at)).map(line => lineOf(seq, line)));
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
