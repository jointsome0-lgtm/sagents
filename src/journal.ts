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
import { apply, arrive, clockAt, hasClock, lying, isRefusal, namesOf, readReply, reply, LOST_SECONDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, next, readAction, readResult, result, sizeOf, start, timeFor, wake } from './world.ts';
import type { Action, Change, Event, Lying, Person, Refusal, World } from './world.ts';

// The sentences about a journal that the rules cannot have written; they are this file's own and may be shown.
export class JournalError extends Error {}

// `act`: the action as it was read from the answer, or the reason why the answer could not be used, with that turn's
// word limit. `memory`: the new long-term text, or null for a rewrite that was lost, and the record up to which the
// short-term lines were folded into it. `result`: the world's answer to the `do` just before it, of the same `who` and
// `at`: what came of the deed, or null, the sleepers it wakes, what it changes of bodies and belongings, whether
// the deed was a search of its place, and the labels of the hidden things it went straight to.
// `reply`: what a figure answers to the `say` addressed to it just before, of the same `who` and `at`: its words, or
// null, and what the answer changes of bodies and belongings.
// A record of a law (`laws.ts`) is put by the rules when the clock reaches its moment; like an arrival and a waking,
// no answer is behind it.
export type Record = { kind: 'act'; who: string; at: number; limit: number; action: Action | Refusal }
  | { kind: 'arrive' | 'wake'; who: string; at: number }
  | { kind: 'memory'; who: string; at: number; text: string | null; upTo: number; cut: boolean }
  | { kind: 'reply'; who: string; at: number; figure: string; text: string | null; changes: Change[] }
  | { kind: 'result'; who: string; at: number; text: string | null; wakes: string[]; changes: Change[]; search: boolean; finds: string[] }
  | LawRecord;
// `by` is the name of the model whose answer the record came of, and null for a record no answer is behind. The rules
// never read it: the same records give the same world whoever answered.
export type Entry = { seq: number; record: Record; event: Event; by: string | null };
// Everything a journal amounts to: where everyone is and what each one remembers. `seq` is the next record's number.
// `deed` is a `do`, or a `say` to a figure, that the world has not answered yet: its answer is the only record that
// can come next. `results` holds, for each place, the latest of what came of the deeds done there, which the world is
// shown when it answers the next, and `said` the latest of what was said to the figures of the place and answered.
// `lies` is what lies in each place now, hidden or not, with how long each person has searched each place, and `laws`
// holds the parts of the state that the laws of `laws.ts` keep.
export type State = { people: Person[]; minds: Map<string, Mind>; seq: number; deed: Event | null; results: Map<string, Line[]>;
  said: Map<string, Line[]>; lies: Lying; laws: Parts };
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
export const refused = (world: World, reason: Refusal) => `${UNUSABLE} ${reason === 'to' && world.remote === null ? NO_REMOTE : INSTEAD[reason]}`;
export const CUT = 'Your speech was longer than the limit: the others heard only its first words.';
const NOTHING = 'Nothing came of it that could be noticed.';

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
// A speech as it opens when it is addressed to a figure of the place.
const toFigure = (world: World, event: Event) => event.kind === 'say' && event.to !== null ? ` to ${named(namesOf(world), event.to)}` : '';

// An event as one who perceived it remembers it, under the time as that one could tell it, `when`. A note is never
// part of it.
function perceived(world: World, event: Event, viewer: string, when: string): string {
  const who = named(world.characters, event.who);
  const what = event.kind === 'say' ? `${who} says${toFigure(world, event)}: "${event.text}"`
    : event.kind === 'call' ? `${who} calls ${event.to === viewer ? 'you' : named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `${who} leaves towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `${who} arrives.`
          : event.kind === 'sleep' ? `${who} falls asleep.`
            : event.kind === 'wake' ? `${who} wakes.` : `${who} does (${event.seconds} s): ${event.text}`;
  return `${when} ${what}`;
}

// What a character remembers of its own action: the action, its note, and the sentence about a speech that was cut.
// The first line is the action itself. `when` is the time as the character could tell it, and `span` how long the
// action lasts as the character knows it.
function own(world: World, event: Event, when: string, span = `${event.seconds} s`): string[] {
  const what = event.kind === 'say' ? `You say${toFigure(world, event)}: "${event.text}"`
    : event.kind === 'call' ? `You call ${named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `You leave towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `You arrive in ${named(world.places, event.place)}.`
          : event.kind === 'sleep' ? `You lie down to sleep (${span}).`
            : event.kind === 'wake' ? 'You wake.'
              : event.kind === 'do' ? `You do (${span}): ${event.text}` : `You wait (${span}).`;
  return [what, ...(event.note ? [`Your note: ${event.note}`] : []), ...(event.cut ? [CUT] : [])].map(line => `${when} ${line}`);
}

export const begin = (world: World): State =>
  ({ people: start(world), minds: new Map(world.characters.map(character => [character.id, blank()])), seq: 0, deed: null,
    results: new Map(world.places.map(place => [place.id, []])), said: new Map(world.places.map(place => [place.id, []])), lies: lying(world), laws: beginLaws(world) });

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
    const present = people.filter(person => person.place === deed.place).map(person => person.id);
    const { text, changes } = record;
    if (!isDeepStrictEqual(readReply(JSON.stringify({ reply: text, changes }), present, deed.place), { text, changes })) return refuse('holds an answer that the speech cannot have');
    const event = reply(world, people, state.lies, deed, text, changes);
    const figure = named(namesOf(world), record.figure), speaker = named(world.characters, deed.who), end = deed.at + deed.seconds;
    // The speaker learns that nothing was answered; the others heard the speech and nothing after it.
    if (text === null) remember(minds.get(deed.who)!, lineOf(seq, `${when(deed.who, end)} ${figure} does not answer.`));
    for (const id of event.heard) remember(minds.get(id)!, lineOf(seq, `${when(id, end)} ${figure} answers ${id === deed.who ? 'you' : speaker}: "${text}"`));
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
    const sleepers = people.filter(person => person.asleep && person.place === deed.place).map(person => person.id);
    const present = people.filter(person => person.place === deed.place).map(person => person.id);
    const { text, wakes, changes, search, finds } = record, hidden = state.lies.hidden.get(deed.place)!.map(thing => thing.id);
    if (!isDeepStrictEqual(readResult(JSON.stringify({ result: text, wakes, changes, search, finds }), sleepers, present, deed.place, hidden), { text, wakes, changes, search, finds })) {
      return refuse('holds an answer of the world that the deed cannot have');
    }
    const event = result(world, people, state.lies, deed, text, wakes, changes, search, finds);
    const doer = named(world.characters, deed.who);
    remember(minds.get(deed.who)!, lineOf(seq, `${when(deed.who, event.at)} ${record.text === null ? NOTHING : `What came of it: ${record.text}`}`));
    for (const id of event.heard) remember(minds.get(id)!, lineOf(seq, `${when(id, event.at)} What came of what ${doer} did: ${record.text}`));
    for (const id of record.wakes) minds.get(id)!.waiting.push(lineOf(seq, `${when(id, deed.at + deed.seconds)} ${doer} woke you by this: ${deed.text}`));
    if (record.text !== null) {
      // The place keeps what came of the deeds done in it, the latest ones.
      const kept = state.results.get(deed.place)!;
      kept.push(lineOf(seq, `${event.clock} ${doer} did (${deed.seconds} s): ${deed.text} Result: ${record.text}`));
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
    for (const id of event.heard) if (!lines.has(id)) remember(minds.get(id)!, lineOf(seq, perceived(world, event, id, when(id, event.at))));
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
  for (const id of event.heard) remember(minds.get(id)!, lineOf(seq, perceived(world, event, id, when(id, event.at))));
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
