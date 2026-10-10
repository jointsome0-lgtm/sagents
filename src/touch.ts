import { cut, isObject, wordsOf } from './reading.ts';
import { LIMITS } from './world.ts';

export const KINDS = ['touch', 'press', 'squeeze', 'hold', 'embrace', 'rub', 'lean'] as const;
export const FORCES = ['light', 'firm', 'hard'] as const;
export const NONE = 'none';
// Bound a request even when everyone in the place is touching.
export const MAX_TOUCHES = 8;

export type Touch = { of: string; to: string; kind: typeof KINDS[number]; force: typeof FORCES[number]; text: string; since: number };
export type Change = Omit<Touch, 'since'> | { of: string; to: string; kind: typeof NONE };

const one = <Name extends string>(names: readonly Name[], value: unknown) => names.find(name => name === value);

// Process entries in order so an ending makes room for a later beginning.
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

export const touched = (touches: Touch[], changes: Change[], at: number): Touch[] => changes.reduce((list, change) => {
  const old = list.find(touch => touch.of === change.of && touch.to === change.to);
  if (change.kind === NONE) return list.filter(touch => touch !== old);
  const now = { ...change, since: old && old.kind === change.kind && old.force === change.force ? old.since : at };
  return old ? list.map(touch => touch === old ? now : touch) : [...list, now];
}, touches);
