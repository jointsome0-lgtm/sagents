import { createHash } from 'node:crypto';
import { ModelError } from './chatgpt.ts';
import type { Message } from './chatgpt.ts';
import type { Respond } from './model.ts';
import { isObject } from './reading.ts';

// An evolutionary search over one text file, after the loop of Gu, Kemeny, Yelin and Lukin (arXiv 2610.22367,
// Methods, "Evolutionary search"): fresh requests, families from ideation, and a MAP-Elites archive over the
// evaluator's features. This file holds no disk access and starts no process: the caller gives the store and the
// evaluator.

export class EvolveError extends Error {}
export type Task = { spec: string; file: string | null; evaluate: string[]; timeout: number; cells: { [feature: string]: number[] }; rules: string; size: number; stale: number };
export type Evaluation = { valid: boolean; score: number | null; features: { [feature: string]: number } | null; feedback: string };
export type Kind = 'seed' | 'idea' | 'try' | 'submit';
export type Candidate = Evaluation & { id: number; at: string; kind: Kind; family: string; parent: number | null; sha: string; chars: number; cell: string | null;
  same: number | null; discoveries: string[]; call: number | null };
export type UsageRow = { n: number; at: string; kind: 'ideate' | 'iterate'; family: string | null; ms: number; input: number | null; cached: number | null; written: number | null;
  output: number | null; reasoning: number | null; error?: string };
// What a run keeps: `put` must leave the text where `evaluate` finds it by its sha.
export type Store = { candidates: Candidate[]; calls: number; put: (sha: string, text: string) => void; text: (sha: string) => string;
  add: (candidate: Candidate) => void; usage: (row: UsageRow) => void };
export type Evolve = { task: Task; store: Store; respond: Respond; model: string; evaluate: (sha: string, signal: AbortSignal) => Promise<Evaluation>;
  calls: number; parallel?: number; tries?: number; cache: string; seed?: string; signal?: AbortSignal; onCandidate?: (candidate: Candidate) => void };
export type EvolveReport = { status: 'done' | 'stopped' | 'failed'; reason: string; httpStatus?: number; providerCode?: string; param?: string; calls: number; invalid: number;
  candidates: number; added: number; valid: number; cells: number; families: number; best: { id: number; family: string; score: number } | null };

const FEEDBACK = 4000, DISCOVERY = 300, DISCOVERIES = 20, FAMILIES = 5, NAME = 40, EXPLORE = 4, UNUSABLE = 5, IDEAS = 3;
export const clip = (text: string, chars: number) => text.length <= chars ? text : `${text.slice(0, chars).replace(/[\uD800-\uDBFF]$/, '')}…`;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const whole = (value: unknown, least: number) => Number.isSafeInteger(value) && (value as number) >= least;

const TASK = 'The task file cannot be used: it needs `spec`, a text; `evaluate`, a list of strings that begins with a program and holds the element "{file}" once; '
  + 'and `cells`, an object of 1 to 4 features, each a list of 1 to 20 ascending finite numbers. `file` and `rules` are texts, `timeout` (seconds, up to 3600), `size` (characters, up to 90,000) and `stale` are whole numbers above zero.';
export function readTask(value: unknown): Task {
  if (!isObject(value) || typeof value.spec !== 'string' || !value.spec.trim() || !Array.isArray(value.evaluate) || !value.evaluate.length
    || !value.evaluate.every(part => typeof part === 'string') || !value.evaluate[0] || value.evaluate[0] === '{file}' || value.evaluate.filter(part => part === '{file}').length !== 1
    || !isObject(value.cells)) throw new EvolveError(TASK);
  const cells = Object.entries(value.cells);
  if (cells.length < 1 || cells.length > 4 || cells.some(([name, edges]) => !/^[A-Za-z][\w-]{0,39}$/.test(name) || !Array.isArray(edges) || edges.length < 1 || edges.length > 20
    || !edges.every((edge, i) => finite(edge) && (i === 0 || edge > edges[i - 1])))) throw new EvolveError(TASK);
  const { file = null, rules = '', timeout = 60, size = 40_000, stale = 10 } = value;
  if (!(file === null || (typeof file === 'string' && file)) || typeof rules !== 'string' || !whole(timeout, 1) || (timeout as number) > 3600
    || !whole(size, 1) || (size as number) > 90_000 || !whole(stale, 1)) throw new EvolveError(TASK);
  return { spec: value.spec, file: file as string | null, evaluate: value.evaluate as string[], timeout: timeout as number, cells: value.cells as Task['cells'], rules, size: size as number, stale: stale as number };
}

// The evaluator's last line of output; anything else it says is its own business.
export function readEvaluation(line: string, task: Task): Evaluation {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return { valid: false, score: null, features: null, feedback: 'The evaluator\'s last line of output is not JSON.' }; }
  if (!isObject(value) || typeof value.valid !== 'boolean') return { valid: false, score: null, features: null, feedback: 'The evaluator\'s last line has no `valid`, true or false.' };
  const feedback = clip(typeof value.feedback === 'string' ? value.feedback : '', FEEDBACK);
  if (!value.valid) return { valid: false, score: null, features: null, feedback };
  const features = isObject(value.features) ? value.features : {}, missing = Object.keys(task.cells).filter(name => !finite(features[name]));
  if (!finite(value.score) || missing.length) return { valid: false, score: null, features: null,
    feedback: clip(`${finite(value.score) ? '' : 'The evaluator gave no finite score. '}${missing.length ? `The evaluator gave no number for ${missing.join(', ')}. ` : ''}${feedback}`, FEEDBACK) };
  return { valid: true, score: value.score, features: Object.fromEntries(Object.keys(task.cells).map(name => [name, features[name] as number])), feedback };
}

// A value below the first edge is in bin 0 and one at or past the last in the last bin, so no value falls outside.
export const cellOf = (features: { [feature: string]: number }, task: Task) =>
  Object.entries(task.cells).map(([name, edges]) => edges.filter(edge => features[name] >= edge).length).join(',');

function instructionsOf(task: Task): string {
  return [`You improve one text file, a program or another document, against an evaluator. The evaluator runs the file and says whether it is valid, its score, where lower is better, the numbers that place it in an archive, and feedback, such as errors, counterexamples and what the score is made of. The archive keeps the best valid file in every cell of those numbers, so different good files are kept side by side. A family is a line of files that descend from one first idea.

Every request is fresh: you see only what its messages hold, and nothing of earlier requests but the discoveries. Answer with one object of the schema. \`file\` is always the whole file, never a change to it, and has at most ${task.size} characters. \`notes\` is a short note of your own on what you did and why; it is not shown again. \`discoveries\` holds at most three short lines that later requests will see: what worked, what failed and why, a fact about the evaluator. Write only what would help a later attempt, and nothing that the task already says.`,
  `The task:\n${task.spec}`, ...(task.rules.trim() ? [`Rules:\n${task.rules}`] : [])].join('\n\n');
}

const ITERATE_FIELDS = ['notes', 'discoveries', 'tool', 'file'], IDEATE_FIELDS = ['notes', 'discoveries', 'families'];
const iterateSchema = (last: boolean) => ({ type: 'object', additionalProperties: false, required: ITERATE_FIELDS, properties: {
  notes: { type: 'string' }, discoveries: { type: 'array', items: { type: 'string' } }, tool: { type: 'string', enum: last ? ['submit'] : ['try', 'submit'] }, file: { type: 'string' } } });
const IDEATE_SCHEMA = { type: 'object', additionalProperties: false, required: IDEATE_FIELDS, properties: {
  notes: { type: 'string' }, discoveries: { type: 'array', items: { type: 'string' } }, families: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['name', 'idea', 'file'], properties: { name: { type: 'string' }, idea: { type: 'string' }, file: { type: 'string' } } } } } };
const exact = (value: { readonly [field: string]: unknown }, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const lines = (value: unknown) => Array.isArray(value) && value.every(line => typeof line === 'string');
type Iterated = { discoveries: string[]; tool: 'try' | 'submit'; file: string };
type Ideated = { discoveries: string[]; families: { name: string; idea: string; file: string }[] };
function parsed(text: string): { readonly [field: string]: unknown } | null {
  try { const value: unknown = JSON.parse(text); return isObject(value) ? value : null; } catch { return null; }
}
function readIterated(text: string, last: boolean): Iterated | null {
  const value = parsed(text);
  if (!value || !exact(value, ITERATE_FIELDS) || typeof value.notes !== 'string' || !lines(value.discoveries) || typeof value.file !== 'string'
    || !(last ? ['submit'] : ['try', 'submit']).includes(value.tool as string)) return null;
  return value as Iterated;
}
function readIdeated(text: string): Ideated | null {
  const value = parsed(text);
  if (!value || !exact(value, IDEATE_FIELDS) || typeof value.notes !== 'string' || !lines(value.discoveries) || !Array.isArray(value.families)
    || !value.families.every(item => isObject(item) && exact(item, ['name', 'idea', 'file']) && typeof item.name === 'string' && typeof item.idea === 'string' && typeof item.file === 'string')) return null;
  return value as Ideated;
}

const placed = (candidate: Candidate) => `score ${candidate.score}, ${Object.entries(candidate.features ?? {}).map(([name, value]) => `${name} ${value}`).join(', ')}`;
const verdict = (candidate: Candidate) => `${candidate.valid ? `valid, ${placed(candidate)}` : 'not valid'}${candidate.same === null ? '' : `; the same file as #${candidate.same}`}${candidate.feedback ? `\nFeedback:\n${candidate.feedback}` : ''}`;

export async function runEvolve({ task, store, respond, model, evaluate, calls: most, parallel = 1, tries = 2, cache, seed, signal: outer, onCandidate }: Evolve): Promise<EvolveReport> {
  if (!whole(most, 1) || !whole(parallel, 1) || parallel > 16 || !whole(tries, 0) || tries > 10) throw new EvolveError('The calls and parallel limits must be whole numbers above zero, parallel at most 16, and tries a whole number from 0 to 10.');
  const all = store.candidates, system = instructionsOf(task), signal = outer ?? new AbortController().signal;
  const owned = createHash('sha256').update(JSON.stringify([cache, 'evolve'])).digest('hex').slice(0, 32);
  const report: EvolveReport = { status: 'done', reason: 'calls', calls: 0, invalid: 0, candidates: 0, added: 0, valid: 0, cells: 0, families: 0, best: null };
  let ended: string | null = null, nextId = all.reduce((most, candidate) => Math.max(most, candidate.id), 0) + 1, turns = 0, explored = 0, sinceGain = 0, unusable = 0, emptyIdeas = 0;
  let ideating: Promise<void> | null = null;
  const end = (reason: string, error?: ModelError) => {
    if (ended !== null) return;
    ended = reason;
    if (error) Object.assign(report, { ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error.providerCode ? { providerCode: error.providerCode } : {}), ...(error.param ? { param: error.param } : {}) });
  };
  // An end lets requests and evaluations under way finish: they are paid for already.
  // A call is counted before its request is sent, so neither a crash nor a parallel worker can spend past the limit.
  const take = () => {
    if (ended !== null || signal.aborted) return null;
    if (report.calls >= most) { end('calls'); return null; }
    report.calls += 1;
    return store.calls + report.calls;
  };
  let free = parallel;
  const waiting: (() => void)[] = [];
  const slot = async () => { if (free > 0) free -= 1; else await new Promise<void>(resolve => waiting.push(resolve)); };
  const release = () => { const next = waiting.shift(); if (next) next(); else free += 1; };

  const best = (family: string) => all.reduce<Candidate | null>((found, candidate) => candidate.family === family && candidate.valid && (!found || candidate.score! < found.score!) ? candidate : found, null);
  const families = () => [...new Set(all.map(candidate => candidate.family))];
  const active = () => families().map(best).filter(candidate => candidate !== null);
  const elites = () => {
    const cells = new Map<string, Candidate>();
    for (const candidate of all) if (candidate.valid && candidate.cell !== null && (!cells.has(candidate.cell) || candidate.score! < cells.get(candidate.cell)!.score!)) cells.set(candidate.cell, candidate);
    return [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, candidate]) => candidate);
  };
  const discoveries = () => all.flatMap(candidate => candidate.discoveries).slice(-DISCOVERIES);
  const told = () => { const found = discoveries(); return found.length ? `Discoveries so far, the latest last:\n${found.map(line => `- ${line}`).join('\n')}` : 'No discoveries yet.'; };

  const record = async (kind: Kind, family: string, parent: number | null, text: string, call: number | null, found: string[]): Promise<Candidate | null> => {
    const sha = createHash('sha256').update(text).digest('hex'), earlier = all.find(candidate => candidate.sha === sha);
    let evaluation: Evaluation;
    if (earlier) evaluation = { valid: earlier.valid, score: earlier.score, features: earlier.features, feedback: earlier.feedback };
    else {
      store.put(sha, text);
      if (text.length > task.size) evaluation = { valid: false, score: null, features: null, feedback: `The file has ${text.length} characters, over the limit of ${task.size}.` };
      else {
        await slot();
        // A file whose evaluation a stop cut short is kept, but has no verdict to archive.
        try { if (signal.aborted) return null; evaluation = await evaluate(sha, signal); } finally { release(); }
        if (signal.aborted) return null;
      }
    }
    const gain = evaluation.valid && (() => { const top = best(family); return !top || evaluation.score! < top.score!; })();
    const candidate: Candidate = { id: nextId++, at: new Date().toISOString(), kind, family, parent, sha, chars: text.length, ...evaluation,
      cell: evaluation.valid ? cellOf(evaluation.features!, task) : null, same: earlier?.id ?? null, discoveries: found.slice(0, 3).map(line => clip(line.trim(), DISCOVERY)).filter(Boolean), call };
    all.push(candidate);
    store.add(candidate);
    report.added += 1;
    if (gain) sinceGain = 0;
    onCandidate?.(candidate);
    return candidate;
  };

  // The answer's text, or null when this request gave nothing to use; a failure that ends the run ends it here.
  const ask = async (kind: UsageRow['kind'], family: string | null, n: number, messages: Message[], schema: object): Promise<string | null> => {
    const row: UsageRow = { n, at: new Date().toISOString(), kind, family, ms: 0, input: null, cached: null, written: null, output: null, reasoning: null };
    const began = performance.now();
    try {
      const answer = await respond({ model, system, messages, schema, cache: owned }, { signal });
      Object.assign(row, { input: answer.usage?.inputTokens ?? null, cached: answer.usage?.cachedInputTokens ?? null, written: answer.usage?.writtenInputTokens ?? null,
        output: answer.usage?.outputTokens ?? null, reasoning: answer.usage?.reasoningTokens ?? null });
      return answer.text;
    } catch (error) {
      if (signal.aborted && !(error instanceof ModelError)) { row.error = 'stopped'; return null; }
      if (!(error instanceof ModelError)) throw error;
      row.error = error.code;
      if (!['output_limit', 'declined'].includes(error.code)) end(error.code, error);
      return null;
    } finally {
      row.ms = Math.round(performance.now() - began);
      store.usage(row);
    }
  };
  const unused = () => { report.invalid += 1; if (++unusable >= UNUSABLE) end('invalid'); };

  const ideate = async () => {
    const n = take();
    if (n === null) return;
    sinceGain = 0;
    const named = families();
    const content = [`Begin up to ${FAMILIES} families of solutions. Each is a different approach, not a variant of another: give it a short \`name\`, its \`idea\` in one line, and its first \`file\`, which should be valid even if its score is poor.`,
      named.length ? `Families that exist already, which the new ones should differ from: ${named.join(', ')}.` : 'No family exists yet.', told()].join('\n\n');
    const text = await ask('ideate', null, n, [{ role: 'user', content }], IDEATE_SCHEMA);
    const answer = text === null ? null : readIdeated(text);
    if (text !== null && !answer) unused();
    if (!answer) return;
    unusable = 0;
    const found = await Promise.all(answer.families.slice(0, FAMILIES).map((family, index) => {
      const base = family.name.trim().replace(/\s+/g, ' ').slice(0, NAME) || 'family';
      let name = base;
      for (let k = 2; named.includes(name); k += 1) name = `${base} ${k}`;
      named.push(name);
      return record('idea', name, null, family.file, n, index ? [] : answer.discoveries);
    }));
    if (found.some(candidate => candidate?.valid)) emptyIdeas = 0;
    else if (++emptyIdeas >= IDEAS && !active().length) end('no_valid_start');
  };

  const iterate = async (turn: number) => {
    const tops = active(), cells = elites();
    let parent = tops[turn % tops.length];
    // Now and then the parent is an elite of the archive, so that a cell no family leads still gets worked on.
    if (turn % EXPLORE === EXPLORE - 1 && cells.length > 1) parent = cells[explored++ % cells.length];
    const others = [...tops.filter(candidate => candidate.family !== parent.family), ...cells.filter(candidate => candidate.cell !== parent.cell)]
      .sort((a, b) => a.score! - b.score!).filter((candidate, i, list) => candidate.id !== parent.id && list.findIndex(other => other.id === candidate.id) === i).slice(0, 2);
    const shown = (candidate: Candidate) => `#${candidate.id}, family ${candidate.family}, ${placed(candidate)}:\n${store.text(candidate.sha)}`;
    const messages: Message[] = [{ role: 'user', content: [`The parent, to improve: ${shown(parent)}`, parent.feedback ? `Its feedback:\n${parent.feedback}` : 'The evaluator gave no feedback on it.',
      others.length ? `Other files of the archive, to borrow from:\n\n${others.map(shown).join('\n\n')}` : 'There are no other files in the archive yet.', told(),
      tries ? `You have ${tries} ${tries === 1 ? 'try' : 'tries'}: with \`try\` the evaluator runs your file and you see what it says; with \`submit\` your file is evaluated and kept, and this work ends.` : 'Use `submit`: your file is evaluated and kept, and this work ends.'].join('\n\n') }];
    for (let t = 0; ; t += 1) {
      const n = take();
      if (n === null) return;
      const last = t >= tries, text = await ask('iterate', parent.family, n, messages, iterateSchema(last));
      const answer = text === null ? null : readIterated(text, last);
      if (text !== null && !answer) unused();
      if (!answer || text === null) return;
      unusable = 0;
      const candidate = await record(answer.tool, parent.family, parent.id, answer.file, n, answer.discoveries);
      if (!candidate || answer.tool === 'submit') return;
      const left = tries - t - 1;
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `The evaluator on your file: ${verdict(candidate)}\n\n${left ? `${left} ${left === 1 ? 'try' : 'tries'} left.` : 'No tries are left: your next answer must use `submit`, and the schema allows only that.'}` });
    }
  };

  const stop = () => end('stopped');
  outer?.addEventListener('abort', stop, { once: true });
  // A worker that fails ends the others before the failure is passed on, so that nothing writes after the caller closes the store.
  let crash: { error: unknown } | null = null;
  try {
    if (seed !== undefined && !all.length) await record('seed', 'seed', null, seed, null, []);
    const worker = async () => {
      try {
        while (ended === null && !signal.aborted) {
          if (ideating) { await ideating; continue; }
          if (!active().length || sinceGain >= task.stale) { ideating = ideate().finally(() => { ideating = null; }); await ideating; continue; }
          await iterate(turns++);
          sinceGain += 1;
        }
      } catch (error) { crash ??= { error }; end('unexpected'); }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally { outer?.removeEventListener('abort', stop); }
  if (crash) throw (crash as { error: unknown }).error;

  report.reason = ended ?? 'calls';
  report.status = report.reason === 'calls' ? 'done' : report.reason === 'stopped' ? 'stopped' : 'failed';
  const valid = all.filter(candidate => candidate.valid), top = active().sort((a, b) => a.score! - b.score!)[0];
  Object.assign(report, { candidates: all.length, valid: valid.length, cells: elites().length, families: families().length,
    best: top ? { id: top.id, family: top.family, score: top.score! } : null });
  return report;
}
