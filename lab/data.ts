// The lab's reading of the files: which experiments lie under its roots, their counts, the names of a world, its
// stretches in the order they were played, one stretch followed from its start as it grows or read in pieces, the
// whole world joined, the chapters of its story and a transcript as text. Nothing here knows of HTTP or of a page,
// and nothing is written.
// A root is any directory; experiments lie under it at any depth up to `DEPTH`, among scripts, logs and folders
// with no run in them, in three shapes:
// - a world: a directory with `world.json`. Every `<name>.events.jsonl` in it is a stretch of that one world (one
//   event of the engine's type `Event` a line, appended while the run goes), with `usage-<name>.jsonl` or
//   `<name>.usage.jsonl` (one row a request); it may have `about.txt` and `story/chapter-NN.json`. `live --run`
//   keeps a run in this shape. Such a directory is one experiment and is not looked into any deeper.
// - a run: in a directory without `world.json` every `<name>.events.jsonl` is an experiment of its own, with the
//   usage file of its name. Its names come from a `*.json` of the same directory that reads as a world file and
//   whose characters cover those of the run's events, `<name>.json` first; when none does, the ids are shown.
// - a text: a transcript `<name>.txt` with no events file. A `.txt` is a transcript when a state file or a usage
//   file of its name lies beside it; `<name>-1.txt` and `<name>-2.txt` beside `<name>.sqlite` are one experiment.
//   Only its text can be shown, and it is not opened before it is asked for.
// A `*.sqlite` is never opened: only its name is looked at. Of a world file only the ids and names of characters and
// places are given out, and for the map what `mapOf` names and nothing else; of a chapter everything but its `carry`.
import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { moveOf, natural, played, secondsOf, timeOf } from './core.js';

const CHUNK = 1 << 18, EVENTS = '.events.jsonl', CHAPTER = /^chapter-(\d+)\.json$/, JSON_MOST = 1 << 22, TEXT_PIECE = 1 << 18;
// How deep under a root a directory is still looked into, and how many directories one walk looks into at most.
const DEPTH = 6, DIRECTORIES = 4000;
const REHEARSAL = /^dry-/;

export class LabError extends Error {}
type Fields = { readonly [field: string]: unknown };
type Named = { id: string; name: string };
export type Names = { characters: Named[]; places: Named[] };
// What the map is drawn from. `at` is metres east and north, `minutesTo` the minutes to other places of the list,
// `nextDoor` those that share a door or a wall with the place, `open` whether it lies under the open sky, `figures`
// its people whom nobody plays; a character's `place` is where it starts. null stands for what the file does not say.
export type MapPlace = Named & { about: string; at: [number, number] | null; minutesTo: { [place: string]: number }; nextDoor: string[]; open: boolean; figures: Named[] };
export type MapVehicle = Named & { at: string; faster: number; route?: string[]; leaves?: string[]; stands?: number };
export type WorldMap = { travelMinutes: number | null; walkMetresPerMinute: number | null; places: MapPlace[]; vehicles?: MapVehicle[]; characters: (Named & { place: string | null })[] };
// Where a character is from the story second `T` on, as `moveOf` of the core module reads it from an event.
export type Move = { T: number; who: string; kind: 'at' | 'go' | 'sleep'; place: string; to?: string; seconds?: number };
export type Chapter = { n: number | null; stretches: string[]; title: string; span: string; text: string; model: string | null };
export type UsageRow = { n: number; at: string | null; kind: string; who: string | null; model: string | null; ms: number | null;
  input: number; cached: number; output: number; reasoning: number; failed: boolean; code: string | null };
type Mark = { at: number; clock: string | null };
type Sums = { requests: number; failed: number; input: number; cached: number; output: number };
type Stretch = { name: string; path: string; usage: string[]; own: boolean; text: string | null };
type Found = { id: string; group: string; name: string; shape: 'world' | 'run' | 'text'; dir: string; stretches: Stretch[];
  texts: { name: string; path: string }[]; usage: string[]; worlds: string[]; covered: boolean; about: string | null; story: string | null };
export type Message = { type: 'gone' } | { type: 'caught' } | { type: 'world'; names: Names } | { type: 'stretch'; name: string; resumed: boolean }
  | { type: 'events'; lines: string[]; at: number } | { type: 'usage'; reset: boolean; rows: UsageRow[]; own: boolean };

const isObject = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);
const parsed = (line: string): Fields | null => { try { const value: unknown = JSON.parse(line); return isObject(value) ? value : null; } catch (error) { if (!(error instanceof SyntaxError)) throw error; return null; } };
const text = (value: unknown) => typeof value === 'string' ? value : null;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const NO_NAMES: Names = { characters: [], places: [] };
// What reading a file may fail with: it went away, or it may not be read. Anything else is passed on.
const missing = (error: unknown) => error instanceof Error && 'code' in error && typeof error.code === 'string';
// A chapter of the story as a view gets it: `n`, the names of the `stretches` it retells, `title`, `span` (what part
// of the story's time it covers, in the narrator's words), `text` (paragraphs separated by blank lines) and `model`.
// `carry`, the narrator's own thread for its next chapter, is not given. `n` is the file's when it has one, and else
// the number in the file's name.
export const chapterOf = (value: unknown, numbered: number | null = null): Chapter | null => !isObject(value) ? null : ({ n: Number.isInteger(value.n) && (value.n as number) > 0 ? value.n as number : numbered,
  stretches: (Array.isArray(value.stretches) ? value.stretches : []).filter((name): name is string => typeof name === 'string' && name !== ''), title: text(value.title) ?? '', span: text(value.span) ?? '', text: text(value.text) ?? '', model: text(value.model) });
// Of a world file: the ids and names of its characters and places, and nothing else of it. null for a value that
// does not read as a world file, which has a list of both.
export const namesOf = (value: unknown): Names | null => {
  if (!isObject(value) || !Array.isArray(value.characters) || !Array.isArray(value.places)) return null;
  const named = (list: unknown[]) => list.filter(isObject).filter(item => typeof item.id === 'string').map(item => ({ id: item.id as string, name: text(item.name) ?? item.id as string }));
  return { characters: named(value.characters), places: named([...value.places, ...(Array.isArray(value.vehicles) ? value.vehicles : [])]) };
};
// Of a world file, what the map is drawn from: of the world `travelMinutes` and `walkMetresPerMinute`; of every place
// its id and name, `about`, `at`, `minutesTo`, `nextDoor`, `open` and the ids and names of its `figures`; of every
// character its id, its name and the `place` it starts in. Nothing else of the file, and of those nothing that is
// of another shape than the engine writes: such a field is passed over, and a place named that is not of the list
// is dropped. null for a value that does not read as a world file.
export const mapOf = (value: unknown): WorldMap | null => {
  const names = namesOf(value);
  if (names === null || !isObject(value)) return null;
  const ids = new Set(names.places.map(place => place.id)), amount = (given: unknown) => typeof given === 'number' && Number.isFinite(given) && given >= 0 ? given : null;
  const named = (list: unknown) => (Array.isArray(list) ? list : []).filter(isObject).filter(item => typeof item.id === 'string').map(item => ({ id: item.id as string, name: text(item.name) ?? item.id as string }));
  const places = (value.places as unknown[]).filter(isObject).filter(place => typeof place.id === 'string').map((place): MapPlace => {
    const id = place.id as string, other = (to: unknown): to is string => typeof to === 'string' && to !== id && ids.has(to), at = place.at;
    return { id, name: text(place.name) ?? id, about: text(place.about) ?? '',
      at: Array.isArray(at) && at.length === 2 && at.every(part => typeof part === 'number' && Number.isFinite(part)) ? [at[0], at[1]] : null,
      minutesTo: Object.fromEntries(Object.entries(isObject(place.minutesTo) ? place.minutesTo : {}).filter(([to, minutes]) => other(to) && amount(minutes) !== null)) as { [place: string]: number },
      nextDoor: [...new Set((Array.isArray(place.nextDoor) ? place.nextDoor : []).filter(other))], open: place.open === true, figures: named(place.figures) };
  });
  const characters = (value.characters as unknown[]).filter(isObject).filter(character => typeof character.id === 'string')
    .map(character => ({ id: character.id as string, name: text(character.name) ?? character.id as string, place: typeof character.place === 'string' && ids.has(character.place) ? character.place : null }));
  const stops = new Set(places.map(place => place.id));
  const vehicles = (Array.isArray(value.vehicles) ? value.vehicles : []).filter(isObject).filter(vehicle => typeof vehicle.id === 'string' && typeof vehicle.at === 'string' && stops.has(vehicle.at))
    .map((vehicle): MapVehicle => ({ id: vehicle.id as string, name: text(vehicle.name) ?? vehicle.id as string, at: vehicle.at as string, faster: amount(vehicle.faster) || 2,
      ...(Array.isArray(vehicle.route) && Array.isArray(vehicle.leaves) ? { route: vehicle.route.filter((id): id is string => typeof id === 'string' && stops.has(id)),
        leaves: vehicle.leaves.filter((time): time is string => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)), stands: amount(vehicle.stands) ?? 60 } : {}) }));
  return { travelMinutes: amount(value.travelMinutes), walkMetresPerMinute: amount(value.walkMetresPerMinute), places, characters, ...(vehicles.length ? { vehicles } : {}) };
};

// Read through the opened file, not through a pathname checked by an earlier walk. With /proc the descriptor's
// own path is checked; without it the path is resolved again and its device and inode must still match.
const openInside = (path: string, roots: string[]) => {
  const within = (real: string) => roots.some(root => real.startsWith(root + sep));
  const real = realpathSync(path);
  if (!within(real)) return null;
  const file = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(file), current = realpathSync(statSync('/proc/self/fd', { throwIfNoEntry: false }) ? `/proc/self/fd/${file}` : real);
    const now = statSync(current);
    if (opened.isFile() && within(current) && opened.dev === now.dev && opened.ino === now.ino) return file;
  } catch (error) {
    closeSync(file);
    throw error;
  }
  closeSync(file);
  return null;
};

// The whole lines a file has grown by since the last look. A last line without its end waits for it: the bytes are
// kept, and a line is cut at the byte of a newline, which is never a part of a character. `at` is the byte after the
// last whole line given. A file that became shorter is another file: it is read from its start, and `anew` says so.
export const tail = (path: string, from = 0, roots = [realpathSync(resolve(path, '..'))]) => {
  let at = from, kept: Buffer = Buffer.alloc(0);
  return { get at() { return at; }, read(most = Infinity) {
    let file: number | null;
    try { file = openInside(path, roots); } catch (error) { if (!missing(error)) throw error; return { lines: [] as string[], anew: false, more: false }; }
    if (file === null) return { lines: [] as string[], anew: false, more: false };
    try {
      const size = fstatSync(file).size, lines: string[] = [];
      let anew = false, seen = at + kept.length;
      if (size < seen) { at = seen = 0; kept = Buffer.alloc(0); anew = true; }
      const cut = () => {
        let start = 0;
        for (let end; lines.length < most && (end = kept.indexOf(10, start)) !== -1; start = end + 1) lines.push(kept.toString('utf8', start, end));
        at += start;
        kept = kept.subarray(start);
      };
      cut();
      while (seen < size && lines.length < most) {
        const chunk = Buffer.alloc(Math.min(CHUNK, size - seen)), got = readSync(file, chunk, 0, chunk.length, seen);
        if (got <= 0) break;
        seen += got;
        kept = Buffer.concat([kept, chunk.subarray(0, got)]);
        cut();
      }
      return { lines, anew, more: seen < size || kept.includes(10) };
    } finally { closeSync(file); }
  } };
};
// A piece of a text file from the byte `from`, `most` bytes at most: it ends after a newline, or at the file's end,
// and never inside a character. `at` is the byte after it.
const piece = (path: string, from: number, most: number, roots: string[]) => {
  let file: number | null;
  try { file = openInside(path, roots); } catch (error) { if (!missing(error)) throw error; return { from: 0, at: 0, size: 0, more: false, text: '' }; }
  if (file === null) return { from: 0, at: 0, size: 0, more: false, text: '' };
  try {
    const size = fstatSync(file).size, start = Number.isInteger(from) && from > 0 && from <= size ? from : 0, chunk = Buffer.alloc(Math.min(most, size - start));
    let got = Math.max(0, readSync(file, chunk, 0, chunk.length, start));
    if (start + got < size) {
      const line = chunk.lastIndexOf(10, got - 1);
      if (line !== -1) got = line + 1;
      // No newline in the piece: it ends before the last character begun, which the next piece then gives whole.
      else { let end = got; while (end > 1 && (chunk[end - 1] & 0xc0) === 0x80) end -= 1; if (end > 1 && chunk[end - 1] >= 0xc0) got = end - 1; }
    }
    return { from: start, at: start + got, size, more: start + got < size, text: chunk.toString('utf8', 0, got) };
  } finally { closeSync(file); }
};

// What a usage row gives a view: the counts, and no text of any kind but the names of the kind, the resident and
// the model. `failed` says that the row has an error, and `code` is the error when it is a plain identifier, as a
// code of this project's `ModelError` is. A row without `kind` (a part's outcome) gives null.
export const usageRow = (row: Fields | null): UsageRow | null => typeof row?.kind !== 'string' ? null : ({ n: count(row.n), at: text(row.at), kind: row.kind, who: text(row.who), model: text(row.model),
  ms: typeof row.ms === 'number' && Number.isFinite(row.ms) ? row.ms : null, input: count(row.input), cached: count(row.cached), output: count(row.output), reasoning: count(row.reasoning),
  failed: row.error != null, code: typeof row.error === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(row.error) ? row.error : null });

// `dirs` are the roots: one directory or several. `growing` is for how many milliseconds after its last change a
// file counts as being written, and `fresh` for how many a walk over the roots is not made again.
export function openLab(dirs: string | string[], { growing = 15000, fresh = 1000 } = {}) {
  const given = (Array.isArray(dirs) ? dirs : [dirs]).map(dir => resolve(dir));
  for (const dir of given) if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new LabError(`not a directory: ${dir}`);
  // Each root once, by its real path, under the last part of its path as its name.
  const roots = [...new Set(given.map(dir => realpathSync(dir)))].map(path => ({ path, label: basename(path) || path }));
  roots.forEach((root, at) => { const same = roots.slice(0, at).filter(other => other.label.replace(/ \(\d+\)$/, '') === root.label).length; if (same) root.label = `${root.label} (${same + 1})`; });
  const paths = roots.map(root => root.path);
  const readTail = (path: string, from = 0) => tail(path, from, paths);
  const readPiece = (path: string, from: number, most: number) => piece(path, from, most, paths);
  const readFile = (path: string) => {
    const file = openInside(path, paths);
    if (file === null) return '';
    try { return readFileSync(file, 'utf8'); } finally { closeSync(file); }
  };
  const modified = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;

  // ---- The walk. A path is used only when, with every link in it followed, it is still under its root. A name is
  // never taken from outside to build one: an experiment, a stretch and a transcript are looked up among what the
  // walk found. Directories whose names begin with a dot and `node_modules` are passed over.
  const walkRoot = (root: string, prefix: string, single: { world: boolean }) => {
    const found: Found[] = [], seen = new Set<string>();
    const within = (path: string) => { try { const real = realpathSync(path); return real === root || real.startsWith(root + sep) ? real : null; } catch (error) { if (!missing(error)) throw error; return null; } };
    const look = (where: string, under: string, depth: number) => {
      if (seen.has(where) || seen.size >= DIRECTORIES) return;
      seen.add(where);
      const files = new Map<string, string>(), inner: [string, string][] = [];
      let entries;
      try { entries = readdirSync(where, { withFileTypes: true }); } catch (error) { if (!missing(error)) throw error; return; }
      for (const entry of entries.sort((one, other) => one.name < other.name ? -1 : 1)) {
        if (entry.name.startsWith('.')) continue;
        // A link is followed only to what lies under the root; what an entry is, is asked of where the link leads.
        const path = entry.isSymbolicLink() ? within(join(where, entry.name)) : join(where, entry.name);
        if (path === null) continue;
        const stat = entry.isSymbolicLink() ? statSync(path, { throwIfNoEntry: false }) : entry;
        if (stat?.isFile()) files.set(entry.name, path);
        else if (stat?.isDirectory() && entry.name !== 'node_modules') inner.push([entry.name, path]);
      }
      const names = [...files.keys()], rel = (name: string) => [prefix, under, name].filter(part => part !== '').join('/');
      const stretches = names.filter(name => name.endsWith(EVENTS) && name.length > EVENTS.length).map(name => name.slice(0, -EVENTS.length));
      const usageFiles = names.filter(name => /^usage-.+\.jsonl$/.test(name) || /.\.usage\.jsonl$/.test(name)).map(name => files.get(name)!);
      const usageOf = (name: string) => [`usage-${name}.jsonl`, `${name}.usage.jsonl`].filter(file => files.has(file)).map(file => files.get(file)!);
      const kept = (name: string) => files.has(`${name}.sqlite`) || usageOf(name).length > 0;
      const world = files.has('world.json');
      // The transcripts that have no events file, each under the experiment it belongs to: a numbered part of a
      // kept world under the world's name, and any other under its own.
      const texts = new Map<string, { name: string; path: string }[]>();
      for (const file of names.filter(name => name.endsWith('.txt') && name.length > 4 && !(world && name === 'about.txt')).sort(natural)) {
        const name = file.slice(0, -4), base = /^(.+)-\d+$/.exec(name)?.[1] ?? null;
        if (stretches.includes(name)) continue;
        const key = kept(name) ? name : base !== null && kept(base) && !stretches.includes(base) ? base : null;
        if (key !== null) texts.set(key, [...texts.get(key) ?? [], { name, path: files.get(file)! }]);
      }
      const stretchOf = (name: string, shared: string[]): Stretch => { const own = usageOf(name); return { name, path: files.get(name + EVENTS)!, usage: own.length ? own : shared, own: own.length > 0 || !shared.length, text: files.get(`${name}.txt`) ?? null }; };
      if (world) {
        // One world. A stretch without a usage file of its name is counted by every usage file of the directory.
        const all = [...texts.values()].flat(), id = rel('') || basename(root);
        if (where === root) single.world = true;
        found.push({ id, group: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', name: basename(where), shape: stretches.length || !all.length ? 'world' : 'text', dir: where,
          stretches: stretches.map(name => stretchOf(name, usageFiles)), texts: stretches.length ? stretches.filter(name => files.has(`${name}.txt`)).map(name => ({ name, path: files.get(`${name}.txt`)! })) : all,
          usage: stretches.length ? [] : usageFiles, worlds: [files.get('world.json')!], covered: false, about: files.get('about.txt') ?? null, story: inner.find(([name]) => name === 'story')?.[1] ?? null });
        return;
      }
      const group = rel('');
      // A world file for a run is looked for among the `*.json` of its directory, the one of its own name first.
      const candidates = names.filter(name => name.endsWith('.json')).sort(natural);
      for (const name of stretches) found.push({ id: rel(name), group, name, shape: 'run', dir: where, stretches: [stretchOf(name, [])], texts: files.has(`${name}.txt`) ? [{ name, path: files.get(`${name}.txt`)! }] : [], usage: [],
        worlds: [...candidates.filter(file => file === `${name}.json`), ...candidates.filter(file => file !== `${name}.json`)].map(file => files.get(file)!), covered: true, about: null, story: null });
      for (const [name, parts] of texts) found.push({ id: rel(name), group, name, shape: 'text', dir: where, stretches: [], texts: parts,
        usage: [...new Set([...usageOf(name), ...parts.flatMap(part => usageOf(part.name))])], worlds: [], covered: false, about: null, story: null });
      if (depth < DEPTH) for (const [name, path] of inner) look(path, under === '' ? name : `${under}/${name}`, depth + 1);
    };
    look(root, '', 0);
    return found;
  };
  let walked: { at: number; single: boolean; found: Map<string, Found> } | null = null;
  const walk = () => {
    if (walked && Date.now() - walked.at < fresh) return walked;
    const single = { world: false }, found = new Map<string, Found>();
    for (const root of roots) for (const one of walkRoot(root.path, roots.length > 1 ? root.label : '', single)) if (!found.has(one.id)) found.set(one.id, one);
    return walked = { at: Date.now(), single: roots.length === 1 && single.world, found };
  };
  const get = (id: string) => walk().found.get(id) ?? null;

  // ---- The counts of the list, kept for each file and brought up to date by what the file grew by.
  const counted = new Map<string, { reader: ReturnType<typeof tail>; events: number; first: Mark | null; last: Mark | null; who: Set<string> }>();
  const eventsCount = (path: string) => {
    let known = counted.get(path);
    if (!known) counted.set(path, known = { reader: readTail(path), events: 0, first: null, last: null, who: new Set() });
    for (let more = true; more;) {
      const got = known.reader.read(5000);
      if (got.anew) Object.assign(known, { events: 0, first: null, last: null, who: new Set() });
      more = got.more && got.lines.length > 0;
      if (!got.lines.length) break;
      known.events += got.lines.length;
      const marks = got.lines.map(line => { const event = parsed(line);
        // Whose events these are, for the choice of a world file: a figure's answer and a vehicle's arrival are no character's.
        if (event && typeof event.who === 'string' && event.who !== '' && event.kind !== 'reply' && event.kind !== 'park') known!.who.add(event.who);
        return event && typeof event.at === 'number' && Number.isFinite(event.at) ? { at: event.at, clock: text(event.clock) } : null; });
      known.first ??= marks[0];
      known.last = marks.at(-1) ?? known.last;
    }
    // `from` and `to`: the first and the last moment as story seconds, by the clock and by `at` when it cannot be read.
    const second = (mark: Mark | null): number | null => mark === null ? null : secondsOf(mark.clock) ?? mark.at;
    return { events: known.events, first: known.first, last: known.last, from: second(known.first), to: second(known.last), who: known.who };
  };
  type Tally = Sums & { residents: Map<string, number>; world: Map<string, number> };
  const usages = new Map<string, { reader: ReturnType<typeof tail>; sums: Tally }>();
  const usageCount = (path: string) => {
    const none = (): Tally => ({ requests: 0, failed: 0, input: 0, cached: 0, output: 0, residents: new Map(), world: new Map() });
    let known = usages.get(path);
    if (!known) usages.set(path, known = { reader: readTail(path), sums: none() });
    for (let more = true; more;) {
      const got = known.reader.read(5000);
      if (got.anew) known.sums = none();
      more = got.more && got.lines.length > 0;
      for (const line of got.lines) {
        const row = usageRow(parsed(line)), sums = known.sums;
        if (!row) continue;
        sums.requests += 1;
        if (row.failed) sums.failed += 1;
        sums.input += row.input; sums.cached += row.cached; sums.output += row.output;
        if (row.model) { const side = row.kind === 'world' || row.kind === 'reply' ? sums.world : sums.residents; side.set(row.model, (side.get(row.model) ?? 0) + 1); }
      }
    }
    return known.sums;
  };
  const SUMS = ['requests', 'failed', 'input', 'cached', 'output'] as const;

  // ---- The names of an experiment. A world's are those of its `world.json`. A run's are those of the first world
  // file of its directory whose characters cover everyone its events name: one that names nobody is covered only by
  // the file of its own name.
  type Read = { names: Names; map: WorldMap; key: string };
  const worlds = new Map<string, { key: string; read: Read | null }>();
  const worldIn = (path: string) => {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat || stat.size > JSON_MOST) return null;
    const key = `${stat.mtimeMs}:${stat.size}`, known = worlds.get(path);
    if (known?.key === key) return known.read;
    let read: Read | null = null;
    try { const value: unknown = JSON.parse(readFile(path)), names = namesOf(value), map = mapOf(value); if (names && map) read = { names, map, key }; }
    catch (error) { if (!(error instanceof SyntaxError) && !missing(error)) throw error; /* a file that cannot be read gives no names: the ids are shown */ }
    worlds.set(path, { key, read });
    return read;
  };
  // What was read of the world file of an experiment, or null when it has none.
  const worldFor = (found: Found): Read | null => {
    if (!found.covered) return found.worlds.length ? worldIn(found.worlds[0]) : null;
    const who = found.stretches.flatMap(stretch => [...eventsCount(stretch.path).who]);
    for (const path of found.worlds) {
      const read = worldIn(path);
      if (!read?.names.characters.length) continue;
      if (who.length ? who.every(id => read.names.characters.some(character => character.id === id)) : basename(path) === `${found.name}.json`) return read;
    }
    return null;
  };
  const namesFor = (found: Found): Names => worldFor(found)?.names ?? NO_NAMES;
  // ---- The moves of a stretch: where its events say everyone is, kept for each file whose map was asked for and
  // brought up to date by what the file grew by, as the counts are.
  const moved = new Map<string, { reader: ReturnType<typeof tail>; moves: Move[]; known: Map<string, string>; last: number }>();
  const movesIn = (path: string) => {
    let kept = moved.get(path);
    if (!kept) moved.set(path, kept = { reader: tail(path), moves: [], known: new Map(), last: 0 });
    for (let more = true; more;) {
      const got = kept.reader.read(5000);
      if (got.anew) Object.assign(kept, { moves: [], known: new Map(), last: 0 });
      more = got.more && got.lines.length > 0;
      for (const line of got.lines) {
        const event = parsed(line);
        if (!event) continue;
        kept.last = timeOf(event, kept.last);
        const move = moveOf(event, kept.last, kept.known);
        if (move) kept.moves.push(move as Move);
      }
    }
    return kept.moves;
  };
  // The first line of a world's `about.txt`, 300 signs of it at most. The path is the walk's: a link that leads out
  // of the root gave none.
  const aboutIn = (found: Found) => found.about === null ? null
    : [...readPiece(found.about, 0, 2048).text.split(/\r?\n/)[0].replace(/\ufffd+$/, '').trim()].slice(0, 300).join('') || null;
  // The stretches of an experiment in the order they were played (`played` of the core module): by the story second
  // of their first event, then by the natural order of their names; one without events stands last. This is the one
  // place that says what a world is made of.
  const stretchesOf = (found: Found) => played(found.stretches.map(stretch => ({ ...stretch, ...eventsCount(stretch.path) }))) as (Stretch & ReturnType<typeof eventsCount>)[];
  // The chapters of a world, `story/chapter-NN.json`, in the order of `n` and then of the files' names. A file that
  // is no JSON object, or is larger than four megabytes, is passed over. `modified` is the latest change.
  const chapters = new Map<string, { key: string; chapter: Chapter | null }>();
  const storyOf = (found: Found) => {
    const got: Chapter[] = [];
    let latest = 0, files: string[] = [];
    // The directory is the one the walk found for a world, so a `story` that is a link out of the root is none; and
    // in it only a file that is itself no link is a chapter.
    const dir = found.story ?? '';
    if (found.story !== null) try { files = readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && CHAPTER.test(entry.name)).map(entry => entry.name).sort(natural); } catch (error) { if (!missing(error)) throw error; }
    for (const file of files) {
      const path = join(dir, file), stat = statSync(path, { throwIfNoEntry: false });
      if (!stat || stat.size > JSON_MOST) continue;
      const key = `${stat.mtimeMs}:${stat.size}`;
      let known = chapters.get(path);
      if (known?.key !== key) {
        let chapter = null;
        try { chapter = chapterOf(JSON.parse(readFile(path)), Number(CHAPTER.exec(file)![1])); } catch (error) { if (!(error instanceof SyntaxError) && !missing(error)) throw error; /* a chapter that cannot be read is passed over */ }
        chapters.set(path, known = { key, chapter });
      }
      if (known.chapter) { got.push(known.chapter); latest = Math.max(latest, stat.mtimeMs); }
    }
    return { chapters: got.map((chapter, at) => [chapter, at] as const).sort((one, other) => (one[0].n ?? 0) - (other[0].n ?? 0) || one[1] - other[1]).map(([chapter]) => chapter), modified: Math.round(latest) };
  };

  // Every experiment, the one written to last first: its `group` (the path of its directory under the root), its
  // `shape`, whether it is a `rehearsal` (its name begins with `dry-`, or it has requests and none of them reported a
  // token), its `about` line, the models of the residents (rows of kind `turn` and `memory`) and of the world
  // (`world`, `reply`), most used first, its `usage` counted once, its stretches in the played order with their
  // counts, the first and the last moment of the story clock (`first`, `last`; `from`, `to` as story seconds),
  // whether a file of theirs was written just now, and `chapter`: the number of the first chapter that retells the
  // stretch, or null. `texts` are its transcripts with their sizes, `story` counts the chapters, and `map` says
  // whether its world file names a place, so that a map of it can be drawn; `mapKey` is the file's modified time
  // and size, so that the page knows when to ask for it again.
  const list = () => {
    const now = Date.now(), { single, found } = walk();
    const all = [...found.values()].map(one => {
      const story = storyOf(one), retold = (name: string) => story.chapters.find(chapter => chapter.stretches.includes(name))?.n ?? null, files = new Set<string>(one.usage);
      let latest = 0;
      const stretches = stretchesOf(one).map(({ name, path, usage: paths, text: transcript, own: _own, who: _who, ...counts }) => {
        const usage: Sums = { requests: 0, failed: 0, input: 0, cached: 0, output: 0 };
        let changed = modified(path);
        for (const file of paths) { files.add(file); const sums = usageCount(file); for (const key of SUMS) usage[key] += sums[key]; changed = Math.max(changed, modified(file)); }
        latest = Math.max(latest, changed);
        return { name, ...counts, usage, modified: Math.round(changed), growing: now - changed < growing, chapter: retold(name), text: transcript !== null };
      });
      const usage: Sums = { requests: 0, failed: 0, input: 0, cached: 0, output: 0 }, models = { residents: new Map<string, number>(), world: new Map<string, number>() };
      for (const file of files) {
        const sums = usageCount(file);
        for (const key of SUMS) usage[key] += sums[key];
        for (const side of ['residents', 'world'] as const) for (const [model, n] of sums[side]) models[side].set(model, (models[side].get(model) ?? 0) + n);
        latest = Math.max(latest, modified(file));
      }
      const texts = one.texts.map(({ name, path }) => { const stat = statSync(path, { throwIfNoEntry: false }); if (!stretches.length) latest = Math.max(latest, stat?.mtimeMs ?? 0); return { name, size: stat?.size ?? 0 }; });
      if (!latest) latest = modified(one.dir);
      const most = (side: Map<string, number>) => [...side].sort((first, second) => second[1] - first[1]).map(([model]) => model), world = worldFor(one);
      return { id: one.id, group: one.group, name: one.name, shape: one.shape, rehearsal: REHEARSAL.test(one.name) || (usage.requests > 0 && usage.input + usage.output === 0), about: aboutIn(one),
        residents: most(models.residents), world: most(models.world), usage, stretches, texts, story: { chapters: story.chapters.length, modified: story.modified }, map: (world?.map.places.length ?? 0) > 0, mapKey: world?.key ?? null, modified: Math.round(latest), growing: stretches.some(stretch => stretch.growing) };
    });
    return { single, root: roots.map(root => root.label).join(', '), experiments: all.sort((one, other) => other.modified - one.modified || (one.id < other.id ? -1 : 1)) };
  };

  // One stretch of one experiment, followed: `poll` gives what is new since the last call, as messages in order:
  //   { type: 'gone' }                       the experiment is not there (now)
  //   { type: 'world', names }               the names, at first and when they changed
  //   { type: 'stretch', name, resumed }     which stretch it is; `resumed: false` says its events start from the first
  //   { type: 'events', lines, at }          whole lines, each the JSON of one event, and the byte after the last
  //   { type: 'usage', reset, rows, own }    usage rows as `usageRow` gives them; `reset` says the rows start anew;
  //                                          `own: false` says they are of every usage file, the stretch having none
  //   { type: 'caught' }                     once, when everything that was there at the start has been given
  // `more` says that events are left to give right now. `wanted` names a stretch; with none, or one that is not
  // there, it is the stretch written to last, once there is one. `from` is a byte that an earlier `at` gave.
  const follow = (id: string, wanted: string | null = null, from = 0) => {
    let stretch: Stretch | null = null, events: ReturnType<typeof tail> | null = null, usage = new Map<string, ReturnType<typeof tail>>(), names = '', caught = false;
    return { get stretch() { return stretch?.name ?? null; }, poll(most = 500): { messages: Message[]; more: boolean } {
      const messages: Message[] = [], found = get(id);
      if (found === null) return { messages: [{ type: 'gone' }], more: false };
      const world = namesFor(found), worldText = JSON.stringify(world);
      if (worldText !== names) { names = worldText; messages.push({ type: 'world', names: world }); }
      if (stretch === null && found.stretches.length) {
        stretch = found.stretches.find(known => known.name === wanted) ?? found.stretches.reduce((best, known) => modified(known.path) > modified(best.path) ? known : best);
        const size = statSync(stretch.path, { throwIfNoEntry: false })?.size ?? 0, start = Number.isInteger(from) && from > 0 && from <= size ? from : 0;
        events = readTail(stretch.path, start);
        messages.push({ type: 'stretch', name: stretch.name, resumed: start > 0 });
      }
      let more = false;
      if (stretch !== null && events !== null) {
        const got = events.read(most);
        more = got.more && got.lines.length > 0;
        if (got.anew) messages.push({ type: 'stretch', name: stretch.name, resumed: false });
        const lines = got.lines.filter(line => parsed(line) !== null);
        if (lines.length) messages.push({ type: 'events', lines, at: events.at });
        // The usage files are those the walk names for the stretch now: one of its own may have appeared.
        const now = found.stretches.find(known => known.name === stretch!.name) ?? stretch;
        let reset = false, anew = false;
        if (now.usage.join('\n') !== [...usage.keys()].join('\n')) { usage = new Map(now.usage.map(path => [path, readTail(path)])); reset = true; }
        const rows: UsageRow[] = [];
        for (const reader of usage.values()) for (let on = !anew; on;) {
          const read = reader.read(5000);
          anew = read.anew;
          for (const line of read.lines) { const row = usageRow(parsed(line)); if (row) rows.push(row); }
          on = !anew && read.more && read.lines.length > 0;
        }
        // A usage file that became shorter: all of them are read anew at the next look.
        if (anew) usage = new Map([['', readTail('')]]);
        else if (reset || rows.length) messages.push({ type: 'usage', reset, rows, own: now.own });
      }
      if (!more && !caught) { caught = true; messages.push({ type: 'caught' }); }
      return { messages, more };
    } };
  };
  // The usage rows of a stretch as they are now, and whether they are its own.
  const usageRows = (stretch: Stretch) => {
    const rows: UsageRow[] = [];
    for (const path of stretch.usage) for (let reader = readTail(path), on = true; on;) {
      const got = reader.read(5000);
      for (const line of got.lines) { const row = usageRow(parsed(line)); if (row) rows.push(row); }
      on = got.more && got.lines.length > 0;
    }
    return { own: stretch.own, rows };
  };
  // A piece of one stretch, for a view that loads a world stretch by stretch: at most `most` whole lines from the
  // byte `from` (0, or an `at` given before), as `{ name, from, at, lines, more, usage }`. `at` is the byte after the
  // last line given, `more` says that lines are left right now, `usage` is `{ own, rows }`, all the rows of the
  // stretch. `from` is the byte the lines start at: 0 when the file is shorter than the byte asked for, being
  // another file then. null when there is no such experiment or stretch.
  const part = (id: string, name: string, from = 0, most = 5000) => {
    const stretch = get(id)?.stretches.find(known => known.name === name);
    if (!stretch) return null;
    const size = statSync(stretch.path, { throwIfNoEntry: false })?.size ?? 0, start = Number.isInteger(from) && from > 0 && from <= size ? from : 0;
    const reader = readTail(stretch.path, start), got = reader.read(most);
    return { name, from: got.anew ? 0 : start, at: reader.at, lines: got.lines.filter(line => parsed(line) !== null), more: got.more && got.lines.length > 0, usage: usageRows(stretch) };
  };
  // The whole world of an experiment as it is now, joined, for a view without a browser: the events of every
  // stretch, once and in the played order, with `stretches` saying where each begins (`{ name, at, events }`, `at` an
  // index into `events`), the usage rows (those of a stretch without a usage file of its own, which are every
  // file's, counted once), the names and the chapters. `gone` when there is no such experiment.
  const world = (id: string) => {
    const found = get(id), got = { gone: found === null, names: NO_NAMES, stretches: [] as { name: string; at: number; events: number }[], events: [] as Fields[], usage: [] as UsageRow[], chapters: [] as Chapter[] };
    if (found === null) return got;
    got.names = namesFor(found);
    got.chapters = storyOf(found).chapters;
    let shared = false;
    for (const { name } of stretchesOf(found)) {
      const at = got.events.length;
      let usage: ReturnType<typeof usageRows> | null = null;
      for (let from = 0, more = true; more;) {
        const read = part(id, name, from);
        if (read === null) break;
        for (const line of read.lines) got.events.push(JSON.parse(line));
        ({ at: from, more, usage } = read);
      }
      if (usage && (usage.own || !shared)) { got.usage.push(...usage.rows); shared ||= !usage.own; }
      got.stretches.push({ name, at, events: got.events.length - at });
    }
    return got;
  };
  // The map of an experiment: `world`, what `mapOf` gives of its world file, and `stretches`, the moves of each
  // stretch in the played order. null without the experiment, and for one whose world file names no place.
  const map = (id: string) => {
    const found = get(id), world = found === null ? null : worldFor(found)?.map ?? null;
    return found === null || !world?.places.length ? null : { world, stretches: stretchesOf(found).map(({ name, path }) => ({ name, moves: movesIn(path) })) };
  };
  // The chapters of an experiment's story, in order, and when the latest was written; null without the experiment.
  const story = (id: string) => { const found = get(id); return found === null ? null : storyOf(found); };
  // A piece of one transcript of an experiment as text, from the byte `from`: `{ name, from, at, size, more, text }`.
  // null when the experiment has no transcript of that name.
  const transcriptOf = (id: string, name: string, from = 0) => {
    const known = get(id)?.texts.find(one => one.name === name);
    return known ? { name, ...readPiece(known.path, from, TEXT_PIECE) } : null;
  };
  return { list, names: (id: string) => { const found = get(id); return found === null ? null : namesFor(found); }, follow, part, world, story, map, text: transcriptOf };
}
