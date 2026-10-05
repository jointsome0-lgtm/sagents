// What one character remembers, with no model and no disk in it. The long-term memory is one text the character wrote
// itself; the short-term memory is what it perceived and did since, as lines in the order they came. Both have a
// size in words that the world sets, and that is what keeps a request to the model from growing with the story.
import { cut, sizeOf } from './world.ts';

// `seq` is the journal record the line came from. An `idle` line says only that the character fell asleep or woke.
export type Line = { seq: number; text: string; size: number; idle?: true };
// `folded` is the record up to which the lines were folded into `long`, or -1; `waiting` holds the calls made to the
// character while it was on the way or asleep, which become lines when it arrives or wakes.
export type Mind = { long: string; lines: Line[]; size: number; folded: number; waiting: Line[] };

export const blank = (): Mind => ({ long: '', lines: [], size: 0, folded: -1, waiting: [] });
export const lineOf = (seq: number, text: string): Line => ({ seq, text, size: sizeOf(text) });
// Whether the character lived through nothing since its last rewrite but falling asleep and waking: then a waking has
// nothing to fold, and asks no model.
export const idle = (mind: Mind) => mind.lines.every(line => line.idle);

export function remember(mind: Mind, ...lines: Line[]): void {
  mind.lines.push(...lines);
  mind.size += lines.reduce((sum, line) => sum + line.size, 0);
}

// The lines one fold takes when the short-term memory is over `most` words: the oldest, record by record, until half
// of `most` is left or the fold itself holds `most`. At least one record's lines, so that every fold moves on.
export function oldest(mind: Mind, most: number): Line[] {
  let count = 0, taken = 0;
  while (count < mind.lines.length) {
    let end = count, size = 0;
    do size += mind.lines[end++].size; while (end < mind.lines.length && mind.lines[end].seq === mind.lines[count].seq);
    if (count && (taken + size > most || mind.size - taken <= most / 2)) break;
    count = end;
    taken += size;
  }
  return mind.lines.slice(0, count);
}

// A rewrite of the long-term memory that folded the lines up to the record `upTo`. Those lines are gone whatever
// came of it: a null `text` is a rewrite that was lost, which leaves the old text.
export function rewrite(mind: Mind, upTo: number, text: string | null): void {
  const kept = mind.lines.filter(line => line.seq > upTo);
  Object.assign(mind, { long: text ?? mind.long, lines: kept, size: kept.reduce((sum, line) => sum + line.size, 0), folded: upTo });
}

// A character's answer to the request to rewrite its memory, as the text that fits `limit` words, or null when it
// cannot be used. An empty text cannot: forgetting everything is not one of the things a rewrite may do.
export function readMemory(answer: string, limit: number): { text: string; cut: boolean } | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  const text = value && typeof value === 'object' && 'memory' in value && typeof value.memory === 'string' ? value.memory.trim() : '';
  const kept = cut(text, limit);
  return kept.text ? kept : null;
}
