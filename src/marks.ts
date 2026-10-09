// The lasting feelings of a part of a body, with no model in it: an itch, a burn, an ache that stays after the deed
// that gave it. A mark is a record of its own, one for its owner, a part of the body and a kind. The world's answer to
// a deed says which mark the deed began, changed or ended, for good or for some minutes, and the rules keep it and
// bring back by the clock what was changed only for a while. Only a world file with `marks` has any.
import { boundedOf, cut, isObject, refuse, wordsOf } from './reading.ts';

// The parts of a body, coarse: the text of a mark says where exactly. `body` is the whole of it.
export const ZONES = ['head', 'face', 'neck', 'shoulders', 'chest', 'back', 'belly', 'hips', 'arms', 'hands', 'legs', 'feet', 'body'] as const;
export const KINDS = ['itch', 'burn', 'ache', 'pain', 'numb'] as const;
export const LEVELS = ['faint', 'clear', 'strong'] as const;
// The level an entry has when the feeling is gone, for good or for a while.
export const NONE = 'none';
// The most words the text of a mark may hold, in the world file and in the world's answer alike.
export const MARK_WORDS = 15;
// How many marks one person has at once, and how many layers one mark, so that a request and a state have a largest
// size; and the most minutes an entry may change a mark for.
export const MAX_MARKS = 6;
export const MAX_LAYERS = 3;
export const MAX_MINUTES = 1440;

type Level = typeof LEVELS[number] | typeof NONE;
// How a mark is for a time: its level, where exactly and what it is like, since when it is so, or null when it was
// so before the story began, and until when, or null when it is so for good. `none` is a layer only above another
// one: the feeling is gone for a while.
export type Layer = { level: Level; text: string; since: number | null; until: number | null };
// One feeling of one person. `layers[0]` is how it is now; each one after it is how it is again when the one before
// has run out, so their ends rise, and only the last may have none. When the last runs out the mark is gone.
export type Mark = { of: string; zone: typeof ZONES[number]; kind: typeof KINDS[number]; layers: Layer[] };
// One entry of an answer as it was read: how the mark is from this deed on, for `minutes` after the deed or for good.
export type Change = Omit<Mark, 'layers'> & { level: Level; minutes: number | null; text: string };
// A mark a character of a world file begins with, for good.
export type Given = Omit<Change, 'of' | 'minutes'>;

const one = <Name extends string>(names: readonly Name[], value: unknown) => names.find(name => name === value);
const keyOf = ({ of, zone, kind }: Omit<Mark, 'layers'>) => `${of} ${zone} ${kind}`;

// The marks as they are at `now`: what the clock alone has done to them. A layer that has run out is gone, the one
// under it is so since that moment, and a mark with no layer left is gone. No record is behind this.
export const marksAt = (marks: Mark[], now: number): Mark[] => marks.flatMap(mark => {
  const gone = mark.layers.findLastIndex(layer => layer.until !== null && layer.until <= now);
  if (gone === -1) return [mark];
  const [next, ...under] = mark.layers.slice(gone + 1);
  return next ? [{ ...mark, layers: [{ ...next, since: mark.layers[gone].until! }, ...under] }] : [];
});

// A mark after one entry of an answer to a deed that began at `at` and ends at `end`: the mark, null when the entry
// ends it, or undefined when the rules cannot take the entry. For good, the entry is all there is of the mark from
// now on. For some minutes, counted from the end of the deed, it lies over what the mark would be when they are over,
// and what would have run out by then is dropped. An entry of the level the mark has keeps the moment it began.
function changed(old: Mark | undefined, { of, zone, kind, level, minutes, text }: Change, at: number, end: number): Mark | null | undefined {
  if (!old && level === NONE) return undefined;
  const since = old && old.layers[0].level === level ? old.layers[0].since : at;
  if (minutes === null) return level === NONE ? null : { of, zone, kind, layers: [{ level, text, since, until: null }] };
  const until = end + minutes * 60, under = (old?.layers ?? []).filter(layer => layer.until === null || layer.until > until);
  if (under.length >= MAX_LAYERS) return undefined;
  return under.length || level !== NONE ? { of, zone, kind, layers: [{ level, text, since, until }, ...under] } : null;
}

// The `lingers` of an answer as the rules can take them, or null when it is no list of objects. `held` are the marks
// of everyone in the place as they are when the deed begins and `present` everyone in it, awake or asleep. An entry
// is dropped when `of` is nobody of the place, when its zone, its kind or its level is none of the list, when
// `minutes` is neither null nor a whole number from 1 to `MAX_MINUTES`, when its text has no word and its level is
// not `none`, when it ends a mark that is not there, when it would put one layer more on a mark than a mark has, and
// when it would begin one more mark than a person has. The text of an entry with `none` is dropped. Of two entries
// for one person, zone and kind the later is kept, and the entries are taken in their order, so an ending makes room
// for what follows.
export function readLingers(value: unknown, present: string[], held: Mark[], at: number, end: number): Change[] | null {
  if (!Array.isArray(value)) return null;
  const read = new Map<string, Change>();
  for (const item of value as unknown[]) {
    if (!isObject(item)) return null;
    const of = present.find(id => id === item.of), zone = one(ZONES, item.zone), kind = one(KINDS, item.kind), level = one([...LEVELS, NONE], item.level);
    const minutes = item.minutes === null ? null : Number.isInteger(item.minutes) && (item.minutes as number) >= 1 && (item.minutes as number) <= MAX_MINUTES ? item.minutes as number : undefined;
    const text = level === NONE ? '' : cut(wordsOf(typeof item.text === 'string' ? item.text : '').join(' '), MARK_WORDS).text;
    if (!of || !zone || !kind || !level || minutes === undefined || (level !== NONE && !text)) continue;
    const change = { of, zone, kind, level, minutes, text };
    read.delete(keyOf(change));
    read.set(keyOf(change), change);
  }
  const marks = new Map(held.map(mark => [keyOf(mark), mark]));
  return [...read].filter(([key, change]) => {
    const old = marks.get(key), now = changed(old, change, at, end);
    if (now === undefined || (!old && [...marks.values()].filter(mark => mark.of === change.of).length >= MAX_MARKS)) return false;
    if (now) marks.set(key, now); else marks.delete(key);
    return true;
  }).map(([, change]) => change);
}

// The marks after the entries of an answer to a deed that began at `at` and ends at `end`, from the marks as they
// are at `at`. A mark stays where it stands in the list, which is the order in which the marks began.
export const marked = (marks: Mark[], changes: Change[], at: number, end: number): Mark[] => changes.reduce((list, change) => {
  const old = list.find(mark => keyOf(mark) === keyOf(change)), now = changed(old, change, at, end);
  if (now === undefined) return list;
  return old ? list.flatMap(mark => mark === old ? now ? [now] : [] : [mark]) : now ? [...list, now] : list;
}, marksAt(marks, at));

// The marks a character of a world file begins with, checked: the first thing wrong is one sentence that names the field.
export function readGiven(value: unknown, field: string): Given[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MARKS) return refuse(field, `must be a list of ${MAX_MARKS} marks at most`);
  return value.map((item: unknown, index): Given => {
    const name = `${field}[${index}]`;
    if (!isObject(item)) return refuse(name, 'must be an object');
    const zone = one(ZONES, item.zone) ?? refuse(`${name}.zone`, `must be one of ${ZONES.join(', ')}`), kind = one(KINDS, item.kind) ?? refuse(`${name}.kind`, `must be one of ${KINDS.join(', ')}`);
    if (value.slice(0, index).some(other => isObject(other) && other.zone === zone && other.kind === kind)) return refuse(name, 'repeats a zone and a kind');
    return { zone, kind, level: one(LEVELS, item.level) ?? refuse(`${name}.level`, `must be one of ${LEVELS.join(', ')}`), text: boundedOf(item.text, `${name}.text`, MARK_WORDS) ?? refuse(`${name}.text`, 'must be a text that is not empty') };
  });
}
