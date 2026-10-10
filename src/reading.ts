
// Words alone would let text without spaces evade a request bound.
export const CHARS_PER_WORD = 10;

// These sentences are ours, so cli.ts may show them.
export class WorldError extends Error {}

export const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);
export const sizeOf = (text: string) => Math.max(wordsOf(text).length, Math.ceil(text.length / CHARS_PER_WORD));
export function cut(text: string, limit: number): { text: string; cut: boolean } {
  if (sizeOf(text) <= limit) return { text, cut: false };
  let end = 0, count = 0;
  for (const word of text.matchAll(/\S+/g)) {
    if (count++ === limit) break;
    end = word.index + word[0].length;
  }
  // Do not leave an unmatched high surrogate at the cut.
  const kept = text.slice(0, Math.min(end, limit * CHARS_PER_WORD)).replace(/[\uD800-\uDBFF]$/, '');
  return { text: kept.trimEnd(), cut: true };
}

export const closed = (text: string) => /[.!?…]$/.test(text) ? text : `${text}.`;

export const MAX_FACTS = 300;

export const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const secondsOfDay = (time: string) => { const [hours, minutes] = time.split(':').map(Number); return hours * 3600 + minutes * 60; };

export const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
export const refuse = (field: string, problem: string): never => { throw new WorldError(`The world file cannot be used: \`${field}\` ${problem}.`); };
export const textOf = (value: unknown, field: string): string => typeof value === 'string' && value.trim() ? value : refuse(field, 'must be a text that is not empty');
export const amountOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : refuse(field, 'must be a number above zero');
export const countOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : refuse(field, 'must be a whole number above zero');
// The journal requires whole seconds even when a setting uses other units.
// Threshold checks use the first whole second that reaches them.
export const durationOf = (seconds: number, field: string): number => Number.isInteger(seconds) && seconds >= 1 && seconds <= 1e12 ? seconds
  : refuse(field, 'must give a whole number of seconds from 1 to 1000000000000');
export const listOf = (value: unknown, field: string): unknown[] => Array.isArray(value) && value.length ? value : refuse(field, 'must be a list that is not empty');
export function boundedOf(value: unknown, field: string, limit: number): string | null {
  if (value === undefined || value === null) return null;
  const text = textOf(value, field);
  return sizeOf(text) <= limit ? text : refuse(field, `must hold ${limit} words at most`);
}
