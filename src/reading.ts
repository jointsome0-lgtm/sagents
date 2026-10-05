// What every part of a world file is read with: the checks of single values, the sentence for a value that fails
// one, and the measure of a text in words. No model and no disk here.

// A text of so many words holds at most this many characters for each of them, so that a limit in words is a limit
// in characters too, whatever a model writes.
export const CHARS_PER_WORD = 10;

// The sentences about a world file that cannot be used; they are this program's own and may be shown.
export class WorldError extends Error {}

export const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);
// The size of a text for every limit in words: its words, or more when it holds more characters than words take.
export const sizeOf = (text: string) => Math.max(wordsOf(text).length, Math.ceil(text.length / CHARS_PER_WORD));
// A text as it fits a limit in words: whole, or its beginning, marked as cut.
export function cut(text: string, limit: number): { text: string; cut: boolean } {
  if (sizeOf(text) <= limit) return { text, cut: false };
  let end = 0, count = 0;
  for (const word of text.matchAll(/\S+/g)) {
    if (count++ === limit) break;
    end = word.index + word[0].length;
  }
  // The end is not left on half a character.
  const kept = text.slice(0, Math.min(end, limit * CHARS_PER_WORD)).replace(/[\uD800-\uDBFF]$/, '');
  return { text: kept.trimEnd(), cut: true };
}

// A text closed as a sentence.
export const closed = (text: string) => /[.!?…]$/.test(text) ? text : `${text}.`;

export const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// A time of day like `06:30` as seconds since midnight.
export const secondsOfDay = (time: string) => { const [hours, minutes] = time.split(':').map(Number); return hours * 3600 + minutes * 60; };

export const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
export const refuse = (field: string, problem: string): never => { throw new WorldError(`The world file cannot be used: \`${field}\` ${problem}.`); };
export const textOf = (value: unknown, field: string): string => typeof value === 'string' && value.trim() ? value : refuse(field, 'must be a text that is not empty');
export const amountOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : refuse(field, 'must be a number above zero');
export const countOf = (value: unknown, field: string, absent: number): number => value === undefined ? absent
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : refuse(field, 'must be a whole number above zero');
export const listOf = (value: unknown, field: string): unknown[] => Array.isArray(value) && value.length ? value : refuse(field, 'must be a list that is not empty');
// A text of `limit` words at most, or null when there is none.
export function boundedOf(value: unknown, field: string, limit: number): string | null {
  if (value === undefined || value === null) return null;
  const text = textOf(value, field);
  return sizeOf(text) <= limit ? text : refuse(field, `must hold ${limit} words at most`);
}
