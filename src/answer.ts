// What the world of a live run answers, with no model in it: what came of a deed and what a figure says, each read
// from the answer and applied to the people and the things of the place.
import { closed, cut, isObject, wordsOf } from './reading.ts';
import { attend, awakeIn } from './action.ts';
import { speechSeconds } from './time.ts';
import { LIMITS, MAX_WORDS } from './world.ts';
import type { Event, Hidden, Person, World } from './world.ts';

// One change the world's answer makes: the whole new text of what a person of the deed's place has, holds or how it
// is placed, or of the things of that place. An empty text means that nothing is left.
export type Change = { of: string; what: 'pose' | 'holds' | 'has' | 'things'; text: string };
const CHANGES = ['pose', 'holds', 'has', 'things'] as const;

// What lies in the places of a run: the things of each, what is still hidden in each, and the seconds each person has
// searched each place, under the person's id and the place's.
export type Lying = { things: Map<string, string | null>; hidden: Map<string, Hidden[]>; searched: Map<string, number> };
// What lies in each place when the story starts, and nobody has searched anywhere.
export const lying = (world: World): Lying => ({ things: new Map(world.places.map(place => [place.id, place.things])),
  hidden: new Map(world.places.map(place => [place.id, place.hidden])), searched: new Map() });
// What of the hidden things of a deed's place the deed finds if the world says it is a search, and what such a
// search leaves: a thing is found when the doer's searches of the place, this deed with them, have lasted its minutes.
export function sought(lies: Lying, deed: Event): { found: Hidden[]; left: Hidden[] } {
  const seconds = (lies.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds, hidden = lies.hidden.get(deed.place)!;
  return { found: hidden.filter(thing => seconds >= thing.minutes * 60), left: hidden.filter(thing => seconds < thing.minutes * 60) };
}

// The world's answer to a deed as it can be taken, or null when it cannot be used. `text` becomes one line of
// `MAX_WORDS` words at most, and null when there is nothing in it; of `wakes` only the ids in `sleepers` are kept,
// each once, in their order.
// Of `changes` only those are kept that name a person in `present`, or `place` for its things; each text becomes
// one line cut at its limit, and of two changes of one thing the later counts. `search` is true only when the answer
// says so, and of `finds` only the labels in `hidden` are kept, each once, in their order.
export function readResult(answer: string, sleepers: string[], present: string[], place: string, hidden: string[]): { text: string | null; wakes: string[]; changes: Change[]; search: boolean;
  finds: string[] } | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  if (!isObject(value) || (value.result !== null && typeof value.result !== 'string') || !Array.isArray(value.wakes) || !Array.isArray(value.changes)) return null;
  const named: unknown[] = value.wakes, given: unknown[] = value.changes;
  const changes = new Map<string, Change>();
  for (const change of given) {
    if (!isObject(change) || typeof change.text !== 'string') continue;
    const what = CHANGES.find(kind => kind === change.what), of = (what === 'things' ? [place] : present).find(id => id === change.of);
    if (!what || !of) continue;
    changes.delete(`${what} ${of}`);
    changes.set(`${what} ${of}`, { of, what, text: cut(wordsOf(change.text).join(' '), LIMITS[what]).text });
  }
  return { text: cut(wordsOf(value.result ?? '').join(' '), MAX_WORDS).text || null, wakes: sleepers.filter(id => named.includes(id)), changes: [...changes.values()],
    search: value.search === true, finds: hidden.filter(id => Array.isArray(value.finds) && value.finds.includes(id)) };
}

// The world's answer for a figure as it can be taken, or null when it cannot be used: `reply` becomes one line of
// `MAX_WORDS` words at most, or null when the figure says nothing, and `changes` are read as a deed's are.
export function readReply(answer: string, present: string[], place: string): { text: string | null; changes: Change[] } | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  if (!isObject(value) || (value.reply !== null && typeof value.reply !== 'string')) return null;
  const read = readResult(JSON.stringify({ result: null, wakes: [], changes: value.changes }), [], present, place, []);
  return read && { text: cut(wordsOf(value.reply ?? '').join(' '), MAX_WORDS).text || null, changes: read.changes };
}

// A figure's answer to a `say` takes effect. Its words begin when the speech ends and hold the speaker and everyone
// who heard the speech as speech does; nobody asleep is woken by them. Its changes are a deed's. The event stands at
// the moment of the speech, as a result stands at its deed's, so that the journal's time never goes back.
export function reply(world: World, people: Person[], lies: Lying, said: Event, text: string | null, changes: Change[]): Event {
  for (const change of changes) {
    if (change.what === 'things') lies.things.set(change.of, change.text || null);
    else people.find(person => person.id === change.of)![change.what] = change.text || null;
  }
  const seconds = text === null ? 0 : speechSeconds(world, wordsOf(text).length), end = said.at + said.seconds + seconds;
  const hearers = text === null ? [] : people.filter(person => person.id === said.who || said.heard.includes(person.id));
  for (const hearer of hearers) {
    hearer.listening = Math.max(hearer.listening, end);
    attend(hearer, said.at);
  }
  return { at: said.at, clock: said.clock, kind: 'reply', who: said.to as string, place: said.place, to: said.who, text, seconds, cut: false,
    heard: hearers.map(person => person.id), note: null, changes };
}

// The world's answer to a deed takes effect: each sleeper it wakes has its sleep end when the deed ends, at `end`.
// The waking itself comes at that sleeper's turn, as every waking does. Those awake in the place perceive the answer.
// Its changes replace what the people of the place have, hold and how they are placed, and the things lying there.
// A deed the world calls a search counts towards its doer's search of the place and finds what that search has
// lasted long enough for; `finds` are the hidden things the world says the deed went straight to. What is found
// either way is hidden no longer, for anyone: it is among the things of the place, at their end and within their
// limit, unless the answer wrote those things anew, which then says where it went.
export function result(world: World, people: Person[], lies: Lying, deed: Event, text: string | null, wakes: string[], changes: Change[], search: boolean,
  finds: string[]): Event {
  const doer = people.find(person => person.id === deed.who)!, { things } = lies;
  const timed = search ? sought(lies, deed).found : [], hidden = lies.hidden.get(deed.place)!;
  const found = hidden.filter(thing => timed.includes(thing) || finds.includes(thing.id)), left = hidden.filter(thing => !found.includes(thing));
  if (search) lies.searched.set(`${deed.who} ${deed.place}`, (lies.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds);
  lies.hidden.set(deed.place, left);
  if (found.length && !changes.some(change => change.what === 'things')) {
    things.set(deed.place, cut([things.get(deed.place), ...found.map(thing => thing.text)].filter(part => part !== null).map(part => closed(part as string)).join(' '), LIMITS.things).text);
  }
  for (const change of changes) {
    if (change.what === 'things') things.set(change.of, change.text || null);
    else people.find(person => person.id === change.of)![change.what] = change.text || null;
  }
  for (const sleeper of people) if (wakes.includes(sleeper.id)) sleeper.freeAt = Math.min(sleeper.freeAt, deed.at + deed.seconds);
  return { at: deed.at, clock: deed.clock, kind: 'result', who: deed.who, place: deed.place, to: null, text, seconds: 0, cut: false,
    heard: text === null ? [] : awakeIn(people, deed.place, doer).map(person => person.id), note: null, wakes, changes, search, finds, found: found.map(thing => thing.text) };
}
