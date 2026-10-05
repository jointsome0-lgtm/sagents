// What the world of a live run answers, with no model in it: what came of a deed and what a figure says, each read
// from the answer and applied to the people of the place and to the things there, which `things.ts` keeps.
import { cut, isObject, wordsOf } from './reading.ts';
import { attend, awakeIn } from './action.ts';
import { speechSeconds } from './time.ts';
import { keep, MAX_MOVES, MAX_SETS, settle, sought } from './things.ts';
import type { Move, Refused, Setting, Things } from './things.ts';
import { LIMITS, MAX_WORDS, namesOf } from './world.ts';
import type { Event, Person, World } from './world.ts';

// The world's answer to a deed as it was read: what came of it in words, the sleepers it wakes, what it moved and
// which states it changed, the poses it changed, what it makes a body feel, whether it was a search, and the hidden
// things it went straight to.
export type Answer = { text: string | null; wakes: string[]; moves: Move[]; sets: Setting[]; poses: { of: string; text: string }[]; feels: { of: string; text: string }[];
  search: boolean; finds: string[] };

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
// told nothing, the one this deed wakes included. `search` is true only when the answer says so. Whether the moves
// and the states can be taken is not looked at here: `refusal` says that.
export function readResult(answer: string, sleepers: string[], present: string[], hidden: string[]): Answer | null {
  const value = parsed(answer);
  if (!isObject(value) || (value.result !== null && typeof value.result !== 'string') || !Array.isArray(value.wakes) || !Array.isArray(value.poses) || !Array.isArray(value.feels)
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
  return moves && { text: line(value.result, MAX_WORDS) || null, wakes: sleepers.filter(id => named.includes(id)), moves, sets,
    poses: [...poses].map(([of, text]) => ({ of, text })), feels: [...feels].map(([of, text]) => ({ of, text })), search: value.search === true, finds: hidden.filter(id => Array.isArray(value.finds) && value.finds.includes(id)) };
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
// Why an answer to `deed` cannot be taken as it was read, or null when it can. Nothing is changed by asking.
export function refusal(world: World, people: Person[], things: Things, deed: Event, answer: Partial<Answer> & { moves: Move[] }): Refused | null {
  const made = settled(world, people, things, deed, answer);
  return 'code' in made ? made : null;
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

// The world's answer to a deed takes effect: each sleeper it wakes has its sleep end when the deed ends, and the
// waking itself comes at that sleeper's turn, as every waking does. Its moves and states are settled by the rules
// of things, whole or not at all, and its poses replace those of the people of the place; an empty pose is none.
// A deed the world calls a search counts towards its doer's search of the place. What is found is hidden no longer,
// for anyone. Those awake in the place perceive what came of the deed when it came to words or to anything else.
// What a body feels is not perceived in that way: the event holds it for its owner, and `heard` is as without it.
// An answer that the rules refuse changes nothing and gives the refusal.
export function result(world: World, people: Person[], things: Things, deed: Event, answer: Answer): Event | Refused {
  const made = settled(world, people, things, deed, answer), { text, wakes, poses, feels, search, finds } = answer;
  if ('code' in made) return made;
  keep(things, deed.place, made);
  const doer = people.find(person => person.id === deed.who)!, { moved, set, found } = made;
  if (search) things.searched.set(`${deed.who} ${deed.place}`, (things.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds);
  for (const pose of poses) people.find(person => person.id === pose.of)!.pose = pose.text || null;
  for (const sleeper of people) if (wakes.includes(sleeper.id)) sleeper.freeAt = Math.min(sleeper.freeAt, deed.at + deed.seconds);
  return { at: deed.at, clock: deed.clock, kind: 'result', who: deed.who, place: deed.place, to: null, text, seconds: 0, cut: false,
    heard: text === null && !moved.length && !set.length && !found.length ? [] : awakeIn(people, deed.place, doer).map(person => person.id), note: null,
    wakes, search, finds, moved, set, poses, feels, found };
}
