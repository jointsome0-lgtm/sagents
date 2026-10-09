// The touches between two people of a place, with no model in it: a touch is a record of its own, one for the one
// who touches and the one touched together, and no part of either's pose. The world's answer to a deed says which
// touch the deed began, changed or ended, and the rules keep it until it ends. Only a world file with `touch` has any.
import { cut, isObject, wordsOf } from './reading.ts';
import { LIMITS } from './world.ts';

export const KINDS = ['touch', 'press', 'squeeze', 'hold', 'embrace', 'rub', 'lean'] as const;
export const FORCES = ['light', 'firm', 'hard'] as const;
// The kind an entry has when the deed ended the touch.
export const NONE = 'none';
// How many touches one place holds at once, so that a request has a largest size.
export const MAX_TOUCHES = 8;

// What `of` does to `to`: its kind, how hard, and with what of the one's body where on the other's. `since` is the
// moment it began, or last changed its kind or its force.
export type Touch = { of: string; to: string; kind: typeof KINDS[number]; force: typeof FORCES[number]; text: string; since: number };
// One entry of an answer as it was read: a touch as it now is, or that the touch of `of` on `to` has ended.
export type Change = Omit<Touch, 'since'> | { of: string; to: string; kind: typeof NONE };

const one = <Name extends string>(names: readonly Name[], value: unknown) => names.find(name => name === value);

// The `touches` of an answer as the rules can take them, or null when it is no list of objects. `held` are the
// touches of the place now and `present` everyone in it, awake or asleep. An entry is dropped when `of` and `to` are
// not two different people of the place, when its kind or its force is none of the list, when its text has no word,
// when it ends a touch that is not there, and when it would begin one more than a place holds. Of two entries for one
// `of` and `to` the later is kept, and the entries are taken in their order, so an ending makes room for what follows.
export function readTouches(value: unknown, present: string[], held: Touch[]): Change[] | null {
  if (!Array.isArray(value)) return null;
  const read = new Map<string, Change>();
  for (const item of value as unknown[]) {
    if (!isObject(item)) return null;
    const of = present.find(id => id === item.of), to = present.find(id => id === item.to), kind = one(KINDS, item.kind), force = one(FORCES, item.force);
    const text = cut(wordsOf(typeof item.text === 'string' ? item.text : '').join(' '), LIMITS.touch).text;
    if (!of || !to || of === to || (item.kind !== NONE && !(kind && force && text))) continue;
    read.delete(`${of} ${to}`);
    read.set(`${of} ${to}`, kind && force ? { of, to, kind, force, text } : { of, to, kind: NONE });
  }
  const pairs = new Set(held.map(touch => `${touch.of} ${touch.to}`));
  return [...read].filter(([pair, change]) => change.kind === NONE ? pairs.delete(pair) : pairs.has(pair) || (pairs.size < MAX_TOUCHES && !!pairs.add(pair))).map(([, change]) => change);
}

// The touches after the entries of an answer to a deed done at `at`. A touch stays where it stands in the list, which
// is the order in which the touches began. An entry with the kind and the force that the touch has changes its text
// and nothing else; another kind or force begins the count of its time anew.
export const touched = (touches: Touch[], changes: Change[], at: number): Touch[] => changes.reduce((list, change) => {
  const old = list.find(touch => touch.of === change.of && touch.to === change.to);
  if (change.kind === NONE) return list.filter(touch => touch !== old);
  const now = { ...change, since: old && old.kind === change.kind && old.force === change.force ? old.since : at };
  return old ? list.map(touch => touch === old ? now : touch) : [...list, now];
}, touches);
