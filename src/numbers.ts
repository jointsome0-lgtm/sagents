// Numbers of a kept run, from its world, events and usage rows. The lab's reader opens only regular files for
// reading; the state file is never opened. null means that the files do not give the number, not zero.
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { tail } from '../lab/data.ts';
import type { Kind } from './world.ts';

export class NumbersError extends Error {}
type Fields = { readonly [field: string]: unknown };
type Value = number | null;
export type Numbers = { name: string; rows: Map<string, Value> };
const KINDS: Kind[] = ['say', 'call', 'go', 'do', 'wait', 'sleep'];
const object = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unreadable = (error: unknown) => error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code as string);
const share = (part: Value, whole: Value) => part === null || whole === null || whole === 0 ? null : Math.round(100 * part / whole);

// A broken or unfinished line leaves the counts unknown. The reader's byte position also tells a missing or
// unreadable file from an empty one, and a last line still being written from a whole line.
function rowsOf(path: string): Fields[] | null {
  try {
    const file = statSync(path);
    if (!file.isFile()) return null;
    accessSync(path, constants.R_OK);
    const size = file.size, reader = tail(path), got = reader.read();
    if (reader.at !== size || got.more) return null;
    const rows: unknown[] = got.lines.map(line => JSON.parse(line));
    return rows.every(object) ? rows : null;
  } catch (error) {
    if (!(error instanceof SyntaxError) && !unreadable(error)) throw error;
    return null;
  }
}

export function numbersOf(dir: string): Numbers {
  let world: unknown, files: string[];
  try { files = readdirSync(dir); world = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')); } catch (error) {
    if (!(error instanceof SyntaxError) && !unreadable(error)) throw error;
    throw new NumbersError('not a kept run');
  }
  if (!object(world) || !Array.isArray(world.places) || !Array.isArray(world.characters)) throw new NumbersError('not a kept run');
  const parts = [...new Set(files.flatMap(file => { const found = /^(?:part(\d+)\.events|usage-part(\d+))\.jsonl$/.exec(file); return found ? [Number(found[1] ?? found[2])] : []; }))].sort((a, b) => a - b);
  if (!parts.length && !files.includes('state.sqlite')) throw new NumbersError('not a kept run');
  const events: Fields[] = [], usage: Fields[] = [], summaries: Fields[] = [];
  let eventsKnown = parts.length > 0 && parts.every((n, at) => n === at + 1), usageKnown = eventsKnown, summariesKnown = eventsKnown;
  for (const n of parts) {
    const deeds = rowsOf(join(dir, `part${n}.events.jsonl`)), requests = rowsOf(join(dir, `usage-part${n}.jsonl`));
    eventsKnown &&= deeds !== null; usageKnown &&= requests !== null && requests.every(row => row.kind === undefined || typeof row.kind === 'string');
    events.push(...deeds ?? []);
    usage.push(...requests?.filter(row => typeof row.kind === 'string') ?? []);
    const totals = requests?.filter(row => row.kind === undefined) ?? [];
    summariesKnown &&= totals.length === 1;
    summaries.push(...totals);
  }
  eventsKnown &&= events.every(event => amount(event.at) && amount(event.seconds) && typeof event.kind === 'string' && typeof event.who === 'string');
  const rows = new Map<string, Value>(), put = (name: string, value: Value) => { rows.set(name, value); };
  const requests = usageKnown ? usage.length : null, kinds = [...new Set(usage.map(row => row.kind as string))];
  put('requests', requests);
  for (const kind of kinds) put(`requests: ${kind}`, usageKnown ? usage.filter(row => row.kind === kind).length : null);
  const first = events[0], last = events.at(-1), minutes = eventsKnown && first && last ? ((last.at as number) + (last.seconds as number) - (first.at as number)) / 60 : null;
  put('story minutes', minutes === null ? null : Math.round(minutes * 10) / 10);
  put('story minutes for 100 requests', minutes === null || requests === null || requests === 0 ? null : Math.round(minutes * 1000 / requests) / 10);

  const actions = events.filter(event => KINDS.includes(event.kind as Kind) || event.kind === 'drive');
  const count = (kind: Kind) => actions.filter(event => event.kind === kind || (kind === 'go' && event.kind === 'drive')).length;
  put('actions of residents', eventsKnown ? actions.length : null);
  for (const kind of KINDS) put(`actions: ${kind}`, eventsKnown ? count(kind) : null);
  let led = 0, empty = 0, longest = 0, runs = 0, cut = 0, resultsKnown = eventsKnown, hearingKnown = eventsKnown;
  const streaks = new Map<string, number>();
  const end = (who: string) => { if ((streaks.get(who) ?? 0) >= 2) runs += 1; streaks.delete(who); };
  for (let n = 0; n < events.length; n += 1) {
    const event = events[n], kind = event.kind, who = event.who as string;
    if (!KINDS.includes(kind as Kind) && kind !== 'drive') continue;
    if (kind !== 'do') {
      end(who);
      if (kind === 'go' || kind === 'drive') led += 1;
      else if (kind === 'say' || kind === 'call') {
        if (!Array.isArray(event.heard)) hearingKnown = false;
        else if (event.heard.length) led += 1;
      }
      continue;
    }
    const result = events[n + 1];
    // A run cut between a deed and its result: that deed is left out of the counts and of the shares.
    if (!result) { cut += 1; end(who); continue; }
    if (result.kind !== 'result' || result.who !== who || result.at !== event.at
      || !(result.text === null || typeof result.text === 'string') || typeof result.search !== 'boolean'
      || ![result.moved, result.set, result.found].every(Array.isArray)) { resultsKnown = false; end(who); continue; }
    if (result.text === null && !(result.moved as unknown[]).length && !(result.set as unknown[]).length && !(result.found as unknown[]).length && !result.search) {
      empty += 1;
      const length = (streaks.get(who) ?? 0) + 1;
      streaks.set(who, length); longest = Math.max(longest, length);
    } else { led += 1; end(who); }
  }
  for (const who of streaks.keys()) end(who);
  put('actions that led somewhere', resultsKnown && hearingKnown ? led : null);
  put('actions that led somewhere (%)', share(resultsKnown && hearingKnown ? led : null, eventsKnown ? actions.length - cut : null));
  put('deeds without a result', resultsKnown ? empty : null);
  put('deeds without a result (%)', share(resultsKnown ? empty : null, eventsKnown ? count('do') - cut : null));
  put('longest row without a result', resultsKnown ? longest : null);
  put('rows of two or more without a result', resultsKnown ? runs : null);

  const places = world.places.filter(object), vehicles = (Array.isArray(world.vehicles) ? world.vehicles : []).filter(object), ids = new Set([...places, ...vehicles].map(place => place.id));
  const visited = new Set(world.characters.filter(object).map(person => person.place).filter(place => ids.has(place)));
  for (const event of events) {
    if (ids.has(event.place) && event.kind !== 'park') visited.add(event.place);
    if (event.transfer === true && ids.has(event.to)) visited.add(event.to);
  }
  put('places visited', eventsKnown ? visited.size : null);
  put('places in the world', ids.size);
  const sum = (list: Fields[], field: string): Value => usageKnown && list.every(row => amount(row[field])) ? list.reduce((total, row) => total + (row[field] as number), 0) : null;
  const input = sum(usage, 'input'), cached = sum(usage, 'cached');
  put('input tokens', input);
  put('cached input tokens', cached);
  put('cached input tokens (%)', share(cached, input));
  put('output tokens', sum(usage, 'output'));
  put('mean input tokens', input === null || requests === null || requests === 0 ? null : Math.round(input / requests));
  const commonest = kinds.map(kind => ({ kind, count: usage.filter(row => row.kind === kind).length })).sort((a, b) => b.count - a.count).slice(0, 2);
  for (const { kind, count } of commonest) {
    const total = sum(usage.filter(row => row.kind === kind), 'input');
    put(`mean input tokens: ${kind}`, total === null ? null : Math.round(total / count));
  }
  for (const [label, field] of [['answers that could not be used', 'invalid'], ['answers of the world refused by the rules', 'refused']]) {
    if (summaries.some(row => amount(row[field]))) put(label, summariesKnown && summaries.every(row => amount(row[field])) ? summaries.reduce((total, row) => total + (row[field] as number), 0) : null);
  }
  if (eventsKnown) put('memory rewrites lost', events.filter(event => event.kind === 'memory' && event.text === null).length);
  return { name: basename(resolve(dir)), rows };
}

// Row names are shared across the columns. Request kinds keep their first appearance; the two commonest kinds
// for a mean are chosen in each run, with a tie kept in that same order.
export function numberRows(runs: Numbers[]): string[] {
  const names = [...new Set(runs.flatMap(run => [...run.rows.keys()]))];
  const requestKinds = names.filter(name => name.startsWith('requests: ')), means = names.filter(name => name.startsWith('mean input tokens: '));
  const rest = names.filter(name => !requestKinds.includes(name) && !means.includes(name) && !['answers that could not be used', 'memory rewrites lost', 'answers of the world refused by the rules'].includes(name));
  rest.splice(rest.indexOf('requests') + 1, 0, ...requestKinds);
  rest.splice(rest.indexOf('mean input tokens') + 1, 0, ...means);
  return [...rest, ...['answers that could not be used', 'memory rewrites lost', 'answers of the world refused by the rules'].filter(name => names.includes(name))];
}

export function numbersTable(runs: Numbers[]): string {
  const names = numberRows(runs), labelWidth = Math.max(0, ...names.map(name => name.length));
  const value = (run: Numbers, name: string) => {
    const n = run.rows.get(name);
    return n == null ? '-' : name.startsWith('story minutes') ? n.toFixed(1) : String(n);
  };
  const widths = runs.map(run => Math.max(run.name.length, ...names.map(name => value(run, name).length)));
  return [[''.padEnd(labelWidth), ...runs.map((run, n) => run.name.padStart(widths[n]))].join('  '),
    ...names.map(name => [name.padEnd(labelWidth), ...runs.map((run, n) => value(run, name).padStart(widths[n]))].join('  '))].join('\n');
}

export function numbersJSON(runs: Numbers[]): object {
  const names = numberRows(runs);
  return Object.fromEntries(runs.map(run => [run.name, Object.fromEntries(names.map(name => [name, run.rows.get(name) ?? null]))]));
}
