import { boundedOf, cut, isObject, refuse, wordsOf } from './reading.ts';

export const ZONES = ['head', 'face', 'neck', 'shoulders', 'chest', 'back', 'belly', 'hips', 'arms', 'hands', 'legs', 'feet', 'body'] as const;
export const KINDS = ['itch', 'burn', 'ache', 'pain', 'numb'] as const;
export const LEVELS = ['faint', 'clear', 'strong'] as const;
export const NONE = 'none';
export const MARK_WORDS = 15;
// Bound both requests and state, including layers beneath the current feeling.
export const MAX_MARKS = 6;
export const MAX_LAYERS = 3;
export const MAX_MINUTES = 1440;

type Level = typeof LEVELS[number] | typeof NONE;
// A null since means before the story; a null until means permanent.
// A none layer needs a layer beneath it to restore after temporary relief.
export type Layer = { level: Level; text: string; since: number | null; until: number | null };
// marksAt() relies on layer ends rising; only the last may be permanent.
export type Mark = { of: string; zone: typeof ZONES[number]; kind: typeof KINDS[number]; layers: Layer[] };
export type Change = Omit<Mark, 'layers'> & { level: Level; minutes: number | null; text: string };
export type Given = Omit<Change, 'of' | 'minutes'>;

const one = <Name extends string>(names: readonly Name[], value: unknown) => names.find(name => name === value);
const keyOf = ({ of, zone, kind }: Omit<Mark, 'layers'>) => `${of} ${zone} ${kind}`;

// marksAt() derives expiry during replay, so expiry needs no journal record.
export const marksAt = (marks: Mark[], now: number): Mark[] => marks.flatMap(mark => {
  const gone = mark.layers.findLastIndex(layer => layer.until !== null && layer.until <= now);
  if (gone === -1) return [mark];
  const [next, ...under] = mark.layers.slice(gone + 1);
  return next ? [{ ...mark, layers: [{ ...next, since: mark.layers[gone].until! }, ...under] }] : [];
});

// null ends a mark; undefined refuses the entry.
function changed(old: Mark | undefined, { of, zone, kind, level, minutes, text }: Change, at: number, end: number): Mark | null | undefined {
  if (!old && level === NONE) return undefined;
  const since = old && old.layers[0].level === level ? old.layers[0].since : at;
  if (minutes === null) return level === NONE ? null : { of, zone, kind, layers: [{ level, text, since, until: null }] };
  const until = end + minutes * 60, under = (old?.layers ?? []).filter(layer => layer.until === null || layer.until > until);
  if (under.length >= MAX_LAYERS) return undefined;
  return under.length || level !== NONE ? { of, zone, kind, layers: [{ level, text, since, until }, ...under] } : null;
}

// Process entries in order so an ending makes room for a later beginning.
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

export const marked = (marks: Mark[], changes: Change[], at: number, end: number): Mark[] => changes.reduce((list, change) => {
  const old = list.find(mark => keyOf(mark) === keyOf(change)), now = changed(old, change, at, end);
  if (now === undefined) return list;
  return old ? list.flatMap(mark => mark === old ? now ? [now] : [] : [mark]) : now ? [...list, now] : list;
}, marksAt(marks, at));

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
