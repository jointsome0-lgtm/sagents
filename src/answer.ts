// What the world of a live run answers, with no model in it: what came of a deed and what a figure says, each read
// from the answer and applied to the people of the place and to the things there, which `things.ts` keeps.
import { cut, isObject, wordsOf } from './reading.ts';
import { attend, awakeIn } from './action.ts';
import { speechSeconds } from './time.ts';
import { keep, MAX_MOVES, MAX_SETS, settle, sought } from './things.ts';
import type { Move, Refused, Setting, Things } from './things.ts';
import { readTouches } from './touch.ts';
import type { Change, Touch } from './touch.ts';
import { readLingers } from './marks.ts';
import type { Change as Lingering, Mark } from './marks.ts';
import { LIMITS, MAX_TRACES, MAX_WORDS, namesOf, traceOf } from './world.ts';
import type { Event, Mark as Trace, Person, World } from './world.ts';

// The world's answer to a deed as it was read: what came of it in words, the sleepers it wakes, what it moved and
// which states it changed, the poses it changed, what it makes a body feel, what of it is heard next door, whether it
// was a search, and the hidden things it went straight to. In a world with `touch`, and only there, also the touches
// it began, changed or ended, and in a world with `marks`, and only there, what it did to the lasting feelings of bodies.
// In a world that keeps traces it has two fields more, absent in any other so that a record of such a world is what
// it was: `traces`, what the deed leaves on people, and `wipes`, the labels of the traces it takes off.
export type Answer = { text: string | null; wakes: string[]; moves: Move[]; sets: Setting[]; poses: { of: string; text: string }[]; feels: { of: string; text: string }[];
  beyond: string | null; search: boolean; finds: string[]; touches?: Change[]; lingers?: Lingering[]; traces?: { of: string; text: string }[]; wipes?: string[] };

// The traces of a run: what is seen on each person's body or clothes for the time being, each under a label like
// `m7`, which is the world's own as a thing's is and is never used again; `next` is the number of the next one. A
// trace is on one person and goes where that person goes. Nothing changes it but the world's answer to a deed.
export type Traces = { of: Map<string, { label: string; text: string }[]>; next: number };
// The traces of a run as it begins, labelled in the world file's order, or null for a world that keeps none.
export function marked(world: World): Traces | null {
  if (!world.characters.some(character => character.traces)) return null;
  const traces: Traces = { of: new Map(), next: 1 };
  for (const character of world.characters) traces.of.set(character.id, (character.traces ?? []).map(text => ({ label: `m${traces.next++}`, text })));
  return traces;
}
// The labels of the traces on some people, which an answer may take off.
export const labelsOn = (traces: Traces, people: string[]) => people.flatMap(id => traces.of.get(id)!.map(trace => trace.label));
// Why the rules refuse an answer whole: an entry of things that they cannot take, or a trace that would be one more
// than a person may have.
export type Rejected = Refused | { code: 'traces'; entry: { of: string; text: string } };

// What an answer's `wipes` and `traces` make of the traces of the people `present`: first each trace named is taken
// off, then each entry is put on its person under the next label. An entry in the very words of a trace that the
// person has then is dropped, so that a trace told again is not there twice. The entry that would give a person more
// than `MAX_TRACES` refuses the whole answer. Nothing of `traces` is changed here.
function retraced(traces: Traces, present: string[], { traces: left = [], wipes = [] }: Partial<Answer>): Traces & { traced: Trace[]; wiped: Trace[] } | Rejected {
  const lists = new Map(present.map(id => [id, [...traces.of.get(id)!]])), traced: Trace[] = [], wiped: Trace[] = [];
  let next = traces.next;
  for (const [of, list] of lists) {
    wiped.push(...list.filter(trace => wipes.includes(trace.label)).map(trace => ({ of, ...trace })));
    lists.set(of, list.filter(trace => !wipes.includes(trace.label)));
  }
  for (const entry of left) {
    const list = lists.get(entry.of)!;
    if (list.some(trace => trace.text === entry.text)) continue;
    if (list.length === MAX_TRACES) return { code: 'traces', entry };
    list.push({ label: `m${next++}`, text: entry.text });
    traced.push({ of: entry.of, ...list.at(-1)! });
  }
  return { of: lists, next, traced, wiped };
}

const parsed = (answer: string): unknown => {
  try { return JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
};
const line = (value: unknown, limit: number) => cut(wordsOf(typeof value === 'string' ? value : '').join(' '), limit).text;
const movesOf = (value: unknown): Move[] | null => Array.isArray(value) && value.length <= MAX_MOVES
  && value.every(item => isObject(item) && typeof item.what === 'string' && Number.isSafeInteger(item.n) && typeof item.to === 'string')
  ? value.map(({ what, n, to }) => ({ what, n, to })) : null;

// The world's answer to a deed as it can be taken, or null when it cannot be used: when it is not one object with
// the fields of its schema, or lists more moves or states than one answer may. `text` becomes one line of
// `MAX_WORDS` words at most, and null when there is nothing in it. Of `wakes` only the ids in `sleepers` are kept
// and of `finds` only the labels in `hidden`, each once, in their order; of `poses` only those of a person in
// `present`, each one line cut at its limit, the later of two for one person. Of `feels` only those of a person in
// `present` who is not in `sleepers` are kept, cut and chosen alike, and one with no words is dropped: a sleeper is
// told nothing, the one this deed wakes included. `beyond` is read as a pose is: one line cut at its limit, and null
// when there is nothing in it. `search` is true only when the answer says so. Whether the moves and the states can
// be taken is not looked at here: `refusal` says that. `sleepers` are those the deed can wake, next door included.
// `held` are the touches of the place now, in a world with `touch`: the answer then has `touches`, read by
// `readTouches`, and is not usable without the list. With no `held` nothing of touches is read. `lasting` is the same
// for a world with `marks`: the marks of those in the place when the deed begins, and the deed's beginning and end,
// with which `readLingers` reads the list `lingers`.
// `labels`, which only a world that keeps traces gives, are those of the traces on the people of the place: the two
// fields of traces are then read, and an answer without them cannot be used. Of `traces` only those of a person in
// `present` are kept, each one line cut at its limit and one with no words dropped; of `wipes` only the labels in
// `labels`, each once, in their order.
export function readResult(answer: string, sleepers: string[], present: string[], hidden: string[], held?: Touch[], lasting?: { marks: Mark[]; at: number; end: number }, labels?: string[]): Answer | null {
  const value = parsed(answer);
  if (!isObject(value) || (value.result !== null && typeof value.result !== 'string') || (value.beyond !== null && typeof value.beyond !== 'string') || !Array.isArray(value.wakes) || !Array.isArray(value.poses) || !Array.isArray(value.feels)
    || !Array.isArray(value.sets) || value.sets.length > MAX_SETS) return null;
  const moves = movesOf(value.moves), named: unknown[] = value.wakes, sets: Setting[] = [], poses = new Map<string, string>(), feels = new Map<string, string>();
  for (const item of value.sets as unknown[]) {
    if (!isObject(item) || typeof item.what !== 'string' || typeof item.state !== 'string') return null;
    sets.push({ what: item.what, state: item.state });
  }
  for (const item of value.poses as unknown[]) {
    if (!isObject(item) || typeof item.text !== 'string') return null;
    const of = present.find(id => id === item.of);
    if (!of) continue;
    poses.delete(of);
    poses.set(of, line(item.text, LIMITS.pose));
  }
  for (const item of value.feels as unknown[]) {
    if (!isObject(item) || typeof item.text !== 'string') return null;
    const of = present.find(id => id === item.of && !sleepers.includes(id)), text = line(item.text, LIMITS.feels);
    if (!of || !text) continue;
    feels.delete(of);
    feels.set(of, text);
  }
  const touches = held && readTouches(value.touches, present, held);
  const lingers = lasting && readLingers(value.lingers, present, lasting.marks, lasting.at, lasting.end);
  if (touches === null || lingers === null) return null;
  const traces: { of: string; text: string }[] = [], wipes: unknown = value.wipes;
  if (labels) {
    if (!Array.isArray(value.traces) || !Array.isArray(wipes)) return null;
    for (const item of value.traces as unknown[]) {
      if (!isObject(item) || typeof item.text !== 'string') return null;
      const of = present.find(id => id === item.of), text = traceOf(line(item.text, LIMITS.trace));
      if (of && text) traces.push({ of, text });
    }
  }
  return moves && { text: line(value.result, MAX_WORDS) || null, wakes: sleepers.filter(id => named.includes(id)), moves, sets,
    poses: [...poses].map(([of, text]) => ({ of, text })), feels: [...feels].map(([of, text]) => ({ of, text })), beyond: line(value.beyond, LIMITS.beyond) || null, search: value.search === true, finds: hidden.filter(id => Array.isArray(value.finds) && value.finds.includes(id)),
    ...(touches ? { touches } : {}), ...(lingers ? { lingers } : {}),
    ...(labels ? { traces, wipes: labels.filter(label => (wipes as unknown[]).includes(label)) } : {}) };
}

// The world's answer for a figure as it can be taken, or null when it cannot be used: `reply` becomes one line of
// `MAX_WORDS` words at most, or null when the figure says nothing, and `moves` are read as a deed's are.
export function readReply(answer: string): { text: string | null; moves: Move[] } | null {
  const value = parsed(answer);
  if (!isObject(value) || (value.reply !== null && typeof value.reply !== 'string')) return null;
  const moves = movesOf(value.moves);
  return moves && { text: line(value.reply, MAX_WORDS) || null, moves };
}

// What the rules make of an answer's moves and states in the place of `deed`, a deed or a speech to a figure: what
// went where, or the entry they refuse the answer for. A deed the world calls a search finds what its doer's
// searches of the place have lasted long enough for, and `finds` are found whatever it lasted. A figure's answer
// finds nothing, sets nothing, and nothing is eaten or burned by it.
const settled = (world: World, people: Person[], things: Things, deed: Event, { moves, sets = [], search = false, finds = [] }: Partial<Answer> & { moves: Move[] }) =>
  settle(things, deed.place, people.filter(person => person.place === deed.place).map(person => person.id),
    new Map([...namesOf(world), ...world.places].map(item => [item.id, item.name])),
    [...(search ? sought(things, deed).found.map(thing => thing.label) : []), ...finds], moves, sets, deed.kind === 'do');
const hereAt = (people: Person[], deed: Event) => people.filter(person => person.place === deed.place).map(person => person.id);
// Why an answer to `deed` cannot be taken as it was read, or null when it can. Nothing is changed by asking.
// `traces` are those of a run that keeps them, for a deed's answer.
export function refusal(world: World, people: Person[], things: Things, deed: Event, answer: Partial<Answer> & { moves: Move[] }, traces: Traces | null = null): Rejected | null {
  const made = settled(world, people, things, deed, answer), marks = traces && retraced(traces, hereAt(people, deed), answer);
  return 'code' in made ? made : marks && 'code' in marks ? marks : null;
}

// A figure's answer to a `say` takes effect. Its words begin when the speech ends and hold the speaker and everyone
// who heard the speech as speech does; nobody asleep is woken by them. Its moves are a deed's. The event stands at
// the moment of the speech, as a result stands at its deed's, so that the journal's time never goes back. An answer
// that the rules refuse changes nothing and gives the refusal.
export function reply(world: World, people: Person[], things: Things, said: Event, text: string | null, moves: Move[]): Event | Refused {
  const made = settled(world, people, things, said, { moves });
  if ('code' in made) return made;
  keep(things, said.place, made);
  const seconds = text === null ? 0 : speechSeconds(world, wordsOf(text).length), end = said.at + said.seconds + seconds;
  const hearers = text === null && !made.moved.length ? [] : people.filter(person => person.id === said.who || said.heard.includes(person.id));
  for (const hearer of text === null ? [] : hearers) {
    hearer.listening = Math.max(hearer.listening, end);
    attend(hearer, said.at);
  }
  return { at: said.at, clock: said.clock, kind: 'reply', who: said.to as string, place: said.place, to: said.who, text, seconds, cut: false,
    heard: hearers.map(person => person.id), note: null, moved: made.moved };
}

// The world's answer to a deed takes effect: each sleeper it wakes, in the place or next door, has its sleep end when
// the deed ends, and the waking itself comes at that sleeper's turn, as every waking does. Its moves and states are settled by the rules
// of things, whole or not at all, and its poses replace those of the people of the place; an empty pose is none.
// A deed the world calls a search counts towards its doer's search of the place. What is found is hidden no longer,
// for anyone. Those awake in the place perceive what came of the deed when it came to words or to anything else.
// What a body feels is not perceived in that way: the event holds it for its owner, and `heard` is as without it.
// What is heard next door reaches everyone awake in a place next door, `nearby`, and ends their waiting as speech
// near them does; a sleeper there whom the answer does not wake, and someone on the way, hear nothing.
// The touches it began, changed or ended, and its entries about marks, go into the event as they were read, and `advance` keeps them.
// In a run that keeps `traces`, the traces the answer takes off are gone and those it leaves are on their people from
// now on, whole or not at all as the things are; the event holds both, and nobody is told them as something that
// happened: a turn says what is on whom as it then stands.
// An answer that the rules refuse changes nothing and gives the refusal.
export function result(world: World, people: Person[], things: Things, deed: Event, answer: Answer, traces: Traces | null = null): Event | Rejected {
  const made = settled(world, people, things, deed, answer), { text, wakes, poses, feels, beyond, search, finds } = answer;
  const marks = traces && retraced(traces, hereAt(people, deed), answer);
  if ('code' in made) return made;
  if (marks && 'code' in marks) return marks;
  keep(things, deed.place, made);
  if (traces && marks) {
    for (const [id, list] of marks.of) traces.of.set(id, list);
    traces.next = marks.next;
  }
  const doer = people.find(person => person.id === deed.who)!, { moved, set, found } = made;
  if (search) things.searched.set(`${deed.who} ${deed.place}`, (things.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds);
  for (const pose of poses) people.find(person => person.id === pose.of)!.pose = pose.text || null;
  for (const sleeper of people) if (wakes.includes(sleeper.id)) sleeper.freeAt = Math.min(sleeper.freeAt, deed.at + deed.seconds);
  const doors = world.places.find(place => place.id === deed.place)!.nextDoor;
  const nearby = beyond === null ? [] : people.filter(person => !person.asleep && doors.includes(person.place!));
  for (const hearer of nearby) attend(hearer, deed.at);
  return { at: deed.at, clock: deed.clock, kind: 'result', who: deed.who, place: deed.place, to: null, text, seconds: 0, cut: false,
    heard: text === null && !moved.length && !set.length && !found.length ? [] : awakeIn(people, deed.place, doer).map(person => person.id), note: null,
    wakes, search, finds, moved, set, poses, feels, beyond, nearby: nearby.map(person => person.id), found, ...(answer.touches ? { touches: answer.touches } : {}), ...(answer.lingers ? { lingers: answer.lingers } : {}),
    ...(marks ? { traced: marks.traced, wiped: marks.wiped } : {}) };
}
