// The journal of a live world: an append-only sequence of records, and the only state there is. A record is what was
// decided outside the rules: what a character answered, that an arrival or a waking came due, what a character wrote
// as its memory. `advance` is the one way a record changes the world, for a run and for a replay alike, and it gives
// the record's event. So the same records always give the same world, and any beginning of a journal is a whole world
// at that moment. No model and no disk here.
import { isDeepStrictEqual } from 'node:util';

import { blank, lineOf, remember, rewrite } from './memory.ts';
import type { Line, Mind } from './memory.ts';
import { apply, arrive, clockAt, isRefusal, LOST_SECONDS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, next, readAction, readResult, result, sizeOf, start, wake } from './world.ts';
import type { Action, Event, Person, Refusal, World } from './world.ts';

// The sentences about a journal that the rules cannot have written; they are this file's own and may be shown.
export class JournalError extends Error {}

// `act`: the action as it was read from the answer, or the reason why the answer could not be used, with that turn's
// word limit. `memory`: the new long-term text, or null for a rewrite that was lost, and the record up to which the
// short-term lines were folded into it. `result`: the world's answer to the `do` just before it, of the same `who` and
// `at`: what came of the deed, or null, and the sleepers it wakes.
export type Record = { kind: 'act'; who: string; at: number; limit: number; action: Action | Refusal }
  | { kind: 'arrive' | 'wake'; who: string; at: number }
  | { kind: 'memory'; who: string; at: number; text: string | null; upTo: number; cut: boolean }
  | { kind: 'result'; who: string; at: number; text: string | null; wakes: string[] };
// `by` is the name of the model whose answer the record came of, and null for a record no answer is behind. The rules
// never read it: the same records give the same world whoever answered.
export type Entry = { seq: number; record: Record; event: Event; by: string | null };
// Everything a journal amounts to: where everyone is and what each one remembers. `seq` is the next record's number.
// `deed` is a `do` the world has not answered yet: its answer is the only record that can come next. `results` holds,
// for each place, the latest of what came of the deeds done there, which the world is shown when it answers the next.
export type State = { people: Person[]; minds: Map<string, Mind>; seq: number; deed: Event | null; results: Map<string, Line[]> };
// How many words of earlier results a place keeps. The newest one stays whatever its size.
export const RESULT_WORDS = 400;
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
  time: `A \`do\` or a \`wait\` lasts 1 to ${MAX_SECONDS} seconds and a \`sleep\` 1 to ${MAX_SLEEP}, given as \`seconds\` or as \`until\`, a time of day like 06:30.`,
};
const NO_REMOTE = 'There is no means of remote contact here: to reach someone, go where they are.';
export const refused = (world: World, reason: Refusal) => `${UNUSABLE} ${reason === 'to' && world.remote === null ? NO_REMOTE : INSTEAD[reason]}`;
export const CUT = 'Your speech was longer than the limit: the others heard only its first words.';
const NOTHING = 'Nothing came of it that could be noticed.';

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';

// An event as one who perceived it remembers it. A note is never part of it.
function perceived(world: World, event: Event, viewer: string): string {
  const who = named(world.characters, event.who);
  const what = event.kind === 'say' ? `${who} says: "${event.text}"`
    : event.kind === 'call' ? `${who} calls ${event.to === viewer ? 'you' : named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `${who} leaves towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `${who} arrives.`
          : event.kind === 'sleep' ? `${who} falls asleep.`
            : event.kind === 'wake' ? `${who} wakes.` : `${who} does (${event.seconds} s): ${event.text}`;
  return `${event.clock} ${what}`;
}

// What a character remembers of its own action: the action, its note, and the sentence about a speech that was cut.
function own(world: World, event: Event): string[] {
  const what = event.kind === 'say' ? `You say: "${event.text}"`
    : event.kind === 'call' ? `You call ${named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `You leave towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `You arrive in ${named(world.places, event.place)}.`
          : event.kind === 'sleep' ? `You lie down to sleep (${event.seconds} s).`
            : event.kind === 'wake' ? 'You wake.'
              : event.kind === 'do' ? `You do (${event.seconds} s): ${event.text}` : `You wait (${event.seconds} s).`;
  return [what, ...(event.note ? [`Your note: ${event.note}`] : []), ...(event.cut ? [CUT] : [])].map(line => `${event.clock} ${line}`);
}

export const begin = (world: World): State =>
  ({ people: start(world), minds: new Map(world.characters.map(character => [character.id, blank()])), seq: 0, deed: null,
    results: new Map(world.places.map(place => [place.id, []])) });

// One record applied to the world: the event it makes, with everyone moved on and every memory brought up to date.
// A record that the rules could not have produced in this state is refused, and the state is then not to be used.
export function advance(world: World, state: State, record: Record): Event {
  const { people, minds, seq } = state;
  const refuse = (problem: string): never => { throw new JournalError(`The journal cannot be used: record ${seq} ${problem}.`); };
  const deed = state.deed;
  if (deed || record.kind === 'result') {
    // A deed is followed by the world's answer and by nothing else, and the world answers nothing but a deed.
    if (!deed || record.kind !== 'result' || record.who !== deed.who || record.at !== deed.at) return refuse('is not the world\'s answer to a deed just before it');
    const sleepers = people.filter(person => person.asleep && person.place === deed.place).map(person => person.id);
    if (!isDeepStrictEqual(readResult(JSON.stringify({ result: record.text, wakes: record.wakes }), sleepers), { text: record.text, wakes: record.wakes })) {
      return refuse('holds an answer of the world that the deed cannot have');
    }
    const event = result(world, people, deed, record.text, record.wakes);
    const doer = named(world.characters, deed.who);
    remember(minds.get(deed.who)!, lineOf(seq, `${event.clock} ${record.text === null ? NOTHING : `What came of it: ${record.text}`}`));
    for (const id of event.heard) remember(minds.get(id)!, lineOf(seq, `${event.clock} What came of what ${doer} did: ${record.text}`));
    for (const id of record.wakes) minds.get(id)!.waiting.push(lineOf(seq, `${clockAt(world, deed.at + deed.seconds)} ${doer} woke you by this: ${deed.text}`));
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
    remember(mind, ...(reason ? [`${event.clock} ${refused(world, reason)}`] : own(world, event)).map(line => lineOf(seq, line)));
    if (event.kind === 'do') state.deed = event;
  } else {
    // A sleeper wakes with nothing but its long-term memory, so its lines were folded first.
    const due = record.kind === 'wake' ? actor.asleep && !mind.lines.length : record.kind === 'arrive' && actor.place === null;
    if (!due) return refuse('is a waking or an arrival of someone who is not due one');
    event = record.kind === 'wake' ? wake(world, people, actor, record.at) : arrive(world, people, actor, record.at);
    remember(mind, ...mind.waiting.splice(0), ...own(world, event).map(line => lineOf(seq, line)));
  }
  for (const id of event.heard) remember(minds.get(id)!, lineOf(seq, perceived(world, event, id)));
  if (event.kind === 'call' && !event.heard.includes(event.to as string)) {
    // The call was not heard: it waits for the arrival or the waking of the one called.
    const callee = people.find(person => person.id === event.to)!;
    minds.get(callee.id)!.waiting.push(lineOf(seq, `${event.clock} ${named(world.characters, event.who)} called you (${world.remote}) while you were ${
      callee.asleep ? 'asleep' : 'on the way'}: "${event.text}"`));
  }
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
