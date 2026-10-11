import { cut, isObject, wordsOf } from './reading.ts';
import { attend, awakeIn, presentAt } from './action.ts';
import { speechSeconds } from './time.ts';
import { all, keep, MAX_MOVES, MAX_SETS, settle, SINKS, sought } from './things.ts';
import type { Move, Refused, Setting, Things } from './things.ts';
import { readTouches } from './touch.ts';
import type { Change, Touch } from './touch.ts';
import { readLingers } from './marks.ts';
import type { Change as Lingering, Mark } from './marks.ts';
import { LIMITS, MAX_TRACES, MAX_WORDS, namesOf, traceOf } from './world.ts';
import type { Event, Mark as Trace, Person, World } from './world.ts';

// Optional fields stay absent in worlds that do not use them so older journal records read back unchanged.
export type Answer = { text: string | null; wakes: string[]; moves: Move[]; sets: Setting[]; poses: { of: string; text: string }[]; feels: { of: string; text: string }[];
  beyond: string | null; search: boolean; finds: string[]; touches?: Change[]; lingers?: Lingering[]; traces?: { of: string; text: string }[]; wipes?: string[]; goes?: string | null };

export type Traces = { of: Map<string, { label: string; text: string }[]>; next: number };
export function marked(world: World): Traces | null {
  if (!world.characters.some(character => character.traces)) return null;
  const traces: Traces = { of: new Map(), next: 1 };
  for (const character of world.characters) traces.of.set(character.id, (character.traces ?? []).map(text => ({ label: `m${traces.next++}`, text })));
  return traces;
}
export const labelsOn = (traces: Traces, people: string[]) => people.flatMap(id => traces.of.get(id)!.map(trace => trace.label));
export const TRACE_CODES = ['traces'] as const;
export type Rejected = Refused | { code: typeof TRACE_CODES[number]; entry: { of: string; text: string } };

// Repeating a trace's wording is not evidence of a second trace.
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

export type Allowed = { [field: string]: string[] };
const allowedIn = (value: { [key: string]: unknown }, allowed?: Allowed) => !allowed || Object.entries(allowed).every(([field, names]) => {
  const [key, part] = field.split('.'), items = value[key];
  if (key === 'leads') return typeof items === 'string' && names.includes(items);
  return Array.isArray(items) && items.every(item => {
    const name = part && isObject(item) ? item[part] : part ? undefined : item;
    return typeof name === 'string' && names.includes(name);
  });
});

// Reading does not show whether the rules accept the moves and states: `refusal`, `result` and `reply` find that out.
export function readResult(answer: string, sleepers: string[], present: string[], hidden: string[], held?: Touch[], lasting?: { marks: Mark[]; at: number; end: number }, labels?: string[], ways?: string[], here?: string, allowed?: Allowed): Answer | null {
  const value = parsed(answer);
  if (!isObject(value) || !allowedIn(value, allowed) || (value.result !== null && typeof value.result !== 'string') || (value.beyond !== null && typeof value.beyond !== 'string') || !Array.isArray(value.wakes) || !Array.isArray(value.poses) || !Array.isArray(value.feels)
    || !Array.isArray(value.sets) || value.sets.length > MAX_SETS) return null;
  const goes = here === undefined ? value.goes : value.leads === here ? null : value.leads;
  if (ways && goes !== null && (typeof goes !== 'string' || !ways.includes(goes))) return null;
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
    ...(ways ? { goes: goes as string | null } : {}), ...(touches ? { touches } : {}), ...(lingers ? { lingers } : {}),
    ...(labels ? { traces, wipes: labels.filter(label => (wipes as unknown[]).includes(label)) } : {}) };
}

export function readReply(answer: string, allowed?: Allowed): { text: string | null; moves: Move[] } | null {
  const value = parsed(answer);
  if (!isObject(value) || !allowedIn(value, allowed) || (value.reply !== null && typeof value.reply !== 'string')) return null;
  const moves = movesOf(value.moves);
  return moves && { text: line(value.reply, MAX_WORDS) || null, moves };
}

const hereAt = (people: Person[], deed: Event) => presentAt(people, deed).map(person => person.id);
const settled = (world: World, people: Person[], things: Things, deed: Event, { moves, sets = [], search = false, finds = [] }: Partial<Answer> & { moves: Move[] }) => {
  const present = hereAt(people, deed);
  if (deed.onWay) {
    const into = [...present, ...all(present.flatMap(id => things.people.get(id)!)).filter(thing => thing.holds).map(thing => thing.label), ...(deed.kind === 'do' ? [...SINKS, ...(world.portions ? ['tasted'] : [])] : [])];
    const entry = moves.find(move => !into.includes(move.to));
    if (entry) return { code: 'to' as const, entry };
  }
  const made = settle(deed.onWay ? { ...things, places: new Map(things.places).set(deed.place, []) } : things, deed.place, present,
    new Map([...namesOf(world), ...world.places].map(item => [item.id, item.name])),
    deed.onWay ? [] : [...(search ? sought(things, deed).found.map(thing => thing.label) : []), ...finds], moves, sets, deed.kind === 'do', world.hunger === true, world.portions === true, world.prices && deed.kind === 'say' ? deed.who : undefined);
  if (deed.onWay && !('code' in made)) made.lists.delete(deed.place);
  return made;
};
export function refusal(world: World, people: Person[], things: Things, deed: Event, answer: Partial<Answer> & { moves: Move[] }, traces: Traces | null = null): Rejected | null {
  const made = settled(world, people, things, deed, answer), marks = traces && retraced(traces, hereAt(people, deed), answer);
  return 'code' in made ? made : marks && 'code' in marks ? marks : null;
}

export function reply(world: World, people: Person[], things: Things, said: Event, text: string | null, moves: Move[]): Event | Refused {
  const made = settled(world, people, things, said, { moves });
  if ('code' in made) return made;
  keep(things, said.place, made);
  const seconds = text === null ? 0 : speechSeconds(world, said.to as string, wordsOf(text).length), end = said.at + said.seconds + seconds;
  const hearers = text === null && !made.moved.length ? [] : people.filter(person => person.id === said.who || said.heard.includes(person.id));
  for (const hearer of text === null ? [] : hearers) {
    hearer.listening = Math.max(hearer.listening, end);
    attend(hearer, said.at);
  }
  return { at: said.at, clock: said.clock, kind: 'reply', who: said.to as string, place: said.place, to: said.who, text, seconds, cut: false,
    heard: hearers.map(person => person.id), note: null, moved: made.moved };
}

// advance() in journal.ts keeps touches and marks; wakings wait for the sleeper's turn.
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
  if (search && !deed.onWay) things.searched.set(`${deed.who} ${deed.place}`, (things.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds);
  const placed = world.ways && !deed.onWay && answer.goes !== null ? poses.filter(pose => pose.of !== deed.who) : poses;
  for (const pose of placed) people.find(person => person.id === pose.of)!.pose = pose.text || null;
  for (const sleeper of people) if (wakes.includes(sleeper.id)) sleeper.freeAt = Math.min(sleeper.freeAt, deed.at + (world.deedEnds ? 0 : deed.seconds));
  const doors = deed.onWay ? [] : world.places.find(place => place.id === deed.place)!.nextDoor;
  const nearby = beyond === null ? [] : people.filter(person => !person.asleep && doors.includes(person.place!));
  for (const hearer of nearby) attend(hearer, deed.at);
  return { at: deed.at, clock: deed.clock, kind: 'result', who: deed.who, place: deed.place, to: null, text, seconds: 0, cut: false,
    heard: !world.deedEnds && text === null && !moved.length && !set.length && !found.length ? [] : (deed.onWay ? presentAt(people, deed).filter(person => person !== doer) : awakeIn(people, deed.place, doer)).map(person => person.id), note: null,
    wakes, search, finds, moved, set, poses: placed, feels, beyond, ...(world.ways && !deed.onWay ? { goes: answer.goes } : {}), ...(deed.onWay ? { onWay: deed.onWay } : {}), nearby: nearby.map(person => person.id), found, ...(answer.touches ? { touches: answer.touches } : {}), ...(answer.lingers ? { lingers: answer.lingers } : {}),
    ...(marks ? { traced: marks.traced, wiped: marks.wiped } : {}) };
}
