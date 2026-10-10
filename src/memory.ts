import { cut, sizeOf } from './world.ts';

export type Line = { seq: number; text: string; size: number; idle?: true };
// A folded value of -1 means no record has been folded yet.
export type Mind = { long: string; lines: Line[]; size: number; folded: number; waiting: Line[] };

export const blank = (): Mind => ({ long: '', lines: [], size: 0, folded: -1, waiting: [] });
export const lineOf = (seq: number, text: string): Line => ({ seq, text, size: sizeOf(text) });
// Sleep and waking alone need no model call to fold memory.
export const idle = (mind: Mind) => mind.lines.every(line => line.idle);

export function remember(mind: Mind, ...lines: Line[]): void {
  mind.lines.push(...lines);
  mind.size += lines.reduce((sum, line) => sum + line.size, 0);
}

// Take at least one record so every fold makes progress.
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

// A null text means the rewrite was lost; dropping its lines still bounds the next request.
export function rewrite(mind: Mind, upTo: number, text: string | null): void {
  const kept = mind.lines.filter(line => line.seq > upTo);
  Object.assign(mind, { long: text ?? mind.long, lines: kept, size: kept.reduce((sum, line) => sum + line.size, 0), folded: upTo });
}

const SCRIPTS = [
  /\p{Script_Extensions=Latin}/u, /\p{Script_Extensions=Cyrillic}/u, /\p{Script_Extensions=Greek}/u,
  /\p{Script_Extensions=Arabic}/u, /\p{Script_Extensions=Hebrew}/u, /\p{Script_Extensions=Devanagari}/u,
  /\p{Script_Extensions=Thai}/u,
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/u,
];

export function sameScript(sheet: string, text: string): boolean {
  const letters = sheet.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return true;
  const counts = SCRIPTS.map(script => letters.filter(letter => script.test(letter)).length);
  const most = Math.max(...counts);
  if (most * 5 < letters.length * 4 || counts.filter(count => count === most).length !== 1) return true;
  const script = SCRIPTS[counts.indexOf(most)];
  const written = text.match(/\p{L}/gu) ?? [];
  if (written.length < 10) return true;
  return written.filter(letter => script.test(letter)).length * 2 >= written.length;
}

// Reject an empty rewrite so it cannot erase the whole memory.
export function readMemory(answer: string, limit: number): { text: string; cut: boolean } | null {
  let value: unknown;
  try { value = JSON.parse(answer); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  const text = value && typeof value === 'object' && 'memory' in value && typeof value.memory === 'string' ? value.memory.trim() : '';
  const end = text.indexOf('}'), kept = cut(end < 0 ? text : text.slice(0, end).trimEnd(), limit);
  if (end >= 0) kept.cut = true;
  return kept.text ? kept : null;
}
