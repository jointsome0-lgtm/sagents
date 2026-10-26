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
// `step` is shared by the files of one step and by the first files of one ideation; rows kept before steps were
// numbered have none. `others` are the files a step showed beside its parent, and `turn` whether that parent was its
// family's best or a cell's elite, on its tries and submits. `name` and `idea` are the model's words for a family, on
// the row of its first file only.
export type Candidate = Evaluation & { id: number; at: string; kind: Kind; family: string; parent: number | null; sha: string; chars: number; cell: string | null;
  same: number | null; discoveries: string[]; call: number | null; step?: number | null; others?: number[]; turn?: 'family' | 'cell'; name?: string; idea?: string };
// A request has a row when it is sent and another when it ends; one that a kill cut short has only the first.
export type Sent = { n: number; at: string; kind: 'ideate' | 'iterate'; family: string | null; sent: true };
export type UsageRow = { n: number; at: string; kind: 'ideate' | 'iterate'; family: string | null; ms: number; input: number | null; cached: number | null; written: number | null;
  output: number | null; reasoning: number | null; error?: string; tries?: 2 };
// What a run keeps: `put` must leave the text where `evaluate` finds it by its sha.
export type Store = { candidates: Candidate[]; calls: number; put: (sha: string, text: string) => void; text: (sha: string) => string;
  add: (candidate: Candidate) => void; usage: (row: Sent | UsageRow) => void };
export type Evolve = { task: Task; store: Store; respond: Respond; model: string; evaluate: (sha: string, signal: AbortSignal) => Promise<Evaluation>;
  calls: number; parallel?: number; tries?: number; timeoutMs?: number; cache: string; seed?: string; signal?: AbortSignal; onCandidate?: (candidate: Candidate) => void };
export type EvolveReport = { status: 'done' | 'stopped' | 'failed'; reason: string; httpStatus?: number; providerCode?: string; param?: string; calls: number; invalid: number; failures: number;
  candidates: number; added: number; valid: number; cells: number; families: number; best: { id: number; family: string; score: number } | null };

// The plan connection ends an answer past 100,000 characters, and a file comes inside JSON: what one answer may
// carry is kept well under that.
const ANSWER = 80_000;
const FEEDBACK = 4000, DISCOVERY = 300, DISCOVERIES = 20, FAMILIES = 5, NAME = 40, IDEA = 300, EXPLORE = 4, UNUSABLE = 5, FAILURES = 3, IDEAS = 3;
export const clip = (text: string, chars: number) => text.length <= chars ? text : `${text.slice(0, chars).replace(/[\uD800-\uDBFF]$/, '')}…`;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const whole = (value: unknown, least: number) => Number.isSafeInteger(value) && (value as number) >= least;

const TASK = 'The task file cannot be used: it needs `spec`, a text; `evaluate`, a list of strings that begins with a program and holds the element "{file}" once; '
  + `and \`cells\`, an object of 1 to 4 features, each a list of 1 to 20 ascending finite numbers. \`file\` and \`rules\` are texts, \`timeout\` (seconds, up to 3600), \`size\` (characters, up to ${ANSWER}) and \`stale\` are whole numbers above zero.`;
export function readTask(value: unknown): Task {
  if (!isObject(value) || typeof value.spec !== 'string' || !value.spec.trim() || !Array.isArray(value.evaluate) || !value.evaluate.length
    || !value.evaluate.every(part => typeof part === 'string') || !value.evaluate[0] || value.evaluate[0] === '{file}' || value.evaluate.filter(part => part === '{file}').length !== 1
    || !isObject(value.cells)) throw new EvolveError(TASK);
  const cells = Object.entries(value.cells);
  if (cells.length < 1 || cells.length > 4 || cells.some(([name, edges]) => !/^[A-Za-z][\w-]{0,39}$/.test(name) || !Array.isArray(edges) || edges.length < 1 || edges.length > 20
    || !edges.every((edge, i) => finite(edge) && (i === 0 || edge > edges[i - 1])))) throw new EvolveError(TASK);
  const { file = null, rules = '', timeout = 60, size = 40_000, stale = 10 } = value;
  if (!(file === null || (typeof file === 'string' && file)) || typeof rules !== 'string' || !whole(timeout, 1) || (timeout as number) > 3600
    || !whole(size, 1) || (size as number) > ANSWER || !whole(stale, 1)) throw new EvolveError(TASK);
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
// As many families as one answer can carry whole files for.
export const ideasOf = (task: Task) => Math.max(1, Math.min(FAMILIES, Math.floor(ANSWER / task.size)));

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
const byScore = (a: Candidate, b: Candidate) => a.score! - b.score!;
// A failure of one request, a timeout, a server's error or a broken or empty answer, ends only its step, so that it
// cuts no other request under way; FAILURES of them in a row end the run, as any other failure does at once.
const STEP_FAILURES = ['timeout', 'provider_failed', 'model_unavailable', 'incomplete_stream', 'invalid_stream', 'invalid_response', 'empty_response'];
// `budget_exceeded` outranks any other end, a failure a stop, and a stop the end of the calls, whatever came first.
const rank = (reason: string) => reason === 'calls' ? 0 : reason === 'stopped' ? 1 : reason === 'budget_exceeded' ? 3 : 2;

export async function runEvolve({ task, store, respond, model, evaluate, calls: most, parallel = 1, tries = 2, timeoutMs, cache, seed, signal: outer, onCandidate }: Evolve): Promise<EvolveReport> {
  if (!whole(most, 1) || !whole(parallel, 1) || parallel > 16 || !whole(tries, 0) || tries > 10) throw new EvolveError('The calls and parallel limits must be whole numbers above zero, parallel at most 16, and tries a whole number from 0 to 10.');
  const all = store.candidates, system = instructionsOf(task), ideas = ideasOf(task);
  const owned = createHash('sha256').update(JSON.stringify([cache, 'evolve'])).digest('hex').slice(0, 32);
  // A failure that ends the run cuts the requests under way, whatever ended the run before it, so that none of them
  // is sent again after it; evaluations end only with a stop.
  const halt = new AbortController(), stopped = outer ?? new AbortController().signal;
  const requests = outer ? AbortSignal.any([outer, halt.signal]) : halt.signal;
  const report: EvolveReport = { status: 'done', reason: 'calls', calls: 0, invalid: 0, failures: 0, candidates: 0, added: 0, valid: 0, cells: 0, families: 0, best: null };
  let ended: string | null = null, nextId = all.reduce((most, candidate) => Math.max(most, candidate.id), 0) + 1;
  // A second start goes on with the counts of the kept steps, as the loop made them, so that a run stopped and
  // started again still turns to ideation after `stale` steps with no gain, and gives the families and the cells
  // their turns in order. The files are taken in the order they were kept and counted as the loop counts them: a
  // gain at its file, a step at its last file and an ideation at its last first file.
  const lows = new Map<string, number>(), lastOf = new Map<number, number>(), gained = new Set<number>();
  all.forEach((candidate, i) => { if (whole(candidate.step, 1)) lastOf.set(candidate.step!, i); });
  let turns = 0, cursor = 0, explored = 0, sinceGain = 0;
  all.forEach((candidate, i) => {
    const low = lows.get(candidate.family), gain = candidate.valid && (low === undefined || candidate.score! < low), step = candidate.step!, last = lastOf.get(step) === i;
    if (gain) lows.set(candidate.family, candidate.score!);
    if (!lastOf.has(step)) return;
    if (candidate.kind === 'idea') { if (last) sinceGain = 0; return; }
    if (gain) { gained.add(step); sinceGain = 0; }
    if (!last) return;
    turns += 1;
    if (candidate.turn === 'cell') explored += 1; else cursor += 1;
    if (!gained.has(step)) sinceGain += 1;
  });
  let nextStep = [...lastOf.keys()].reduce((most, step) => Math.max(most, step), 0) + 1, unusable = 0, failing = 0, emptyIdeas = 0;
  // Rows edited by hand may number so high that the next numbers would not be exact; nothing is sent then.
  const room = most * FAMILIES + parallel;
  if (![store.calls, nextId, nextStep].every(next => Number.isSafeInteger(next + room))) throw new EvolveError('The kept rows number their requests, files or steps too high to go on.');
  let ideating: Promise<void> | null = null;
  const end = (reason: string, error?: ModelError) => {
    if (error) halt.abort();
    if (ended !== null && rank(reason) <= rank(ended)) return;
    ended = reason;
    if (error) {
      for (const field of ['httpStatus', 'providerCode', 'param'] as const) delete report[field];
      Object.assign(report, { ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error.providerCode ? { providerCode: error.providerCode } : {}), ...(error.param ? { param: error.param } : {}) });
    }
  };
  // The end of the calls lets requests and evaluations under way finish: they are paid for already.
  // A call is counted before its request is sent, so neither a crash nor a parallel worker can spend past the limit.
  const take = () => {
    if (ended !== null || requests.aborted) return null;
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
  const named = (family: string) => {
    const first = all.find(candidate => candidate.family === family && candidate.name !== undefined);
    return first ? `${family}, "${first.name}"` : family;
  };
  const discoveries = () => all.flatMap(candidate => candidate.discoveries).slice(-DISCOVERIES);
  const told = () => { const found = discoveries(); return found.length ? `Discoveries so far, the latest last:\n${found.map(line => `- ${line}`).join('\n')}` : 'No discoveries yet.'; };

  // One evaluation per file, even when the same file comes twice at once.
  const pending = new Map<string, Promise<Evaluation | null>>();
  const evaluationOf = (sha: string, text: string) => {
    let work = pending.get(sha);
    if (!work) {
      work = (async () => {
        store.put(sha, text);
        if (text.length > task.size) return { valid: false, score: null, features: null, feedback: `The file has ${text.length} characters, over the limit of ${task.size}.` };
        await slot();
        // A file whose evaluation a stop cut short is kept, but has no verdict to archive.
        try { return stopped.aborted ? null : await evaluate(sha, stopped); } finally { release(); }
      })();
      pending.set(sha, work);
      void work.then(() => pending.delete(sha), () => pending.delete(sha));
    }
    return work;
  };
  const record = async (text: string, row: Pick<Candidate, 'kind' | 'family' | 'parent' | 'call' | 'step'>, found: string[], more: Pick<Candidate, 'others' | 'turn' | 'name' | 'idea'> = {}) => {
    const sha = createHash('sha256').update(text).digest('hex'), earlier = all.find(candidate => candidate.sha === sha);
    const evaluation = earlier ? { valid: earlier.valid, score: earlier.score, features: earlier.features, feedback: earlier.feedback } : await evaluationOf(sha, text);
    if (!evaluation || stopped.aborted) return null;
    const top = best(row.family), gain = evaluation.valid && (!top || evaluation.score! < top.score!);
    const candidate: Candidate = { id: nextId++, at: new Date().toISOString(), kind: row.kind, family: row.family, parent: row.parent, sha, chars: text.length, ...evaluation,
      cell: evaluation.valid ? cellOf(evaluation.features!, task) : null, same: (earlier ?? all.find(other => other.sha === sha))?.id ?? null,
      discoveries: found.slice(0, 3).map(line => clip(line.trim(), DISCOVERY)).filter(Boolean), call: row.call, step: row.step, ...more };
    all.push(candidate);
    store.add(candidate);
    report.added += 1;
    onCandidate?.(candidate);
    return { candidate, gain };
  };

  // An answer that gives nothing to use, a cut one and a declined one among them, counts toward the end at UNUSABLE in a row.
  const unused = () => { report.invalid += 1; if (++unusable >= UNUSABLE) end('invalid'); };
  // The answer's text, or null when this request gave nothing to use; a failure that ends the run ends it here.
  const ask = async (kind: UsageRow['kind'], family: string | null, n: number, messages: Message[], schema: object): Promise<string | null> => {
    const at = new Date().toISOString();
    store.usage({ n, at, kind, family, sent: true });
    const row: UsageRow = { n, at, kind, family, ms: 0, input: null, cached: null, written: null, output: null, reasoning: null };
    const began = performance.now();
    try {
      const answer = await respond({ model, system, messages, schema, cache: owned }, { signal: requests, timeoutMs });
      failing = 0;
      Object.assign(row, { input: answer.usage?.inputTokens ?? null, cached: answer.usage?.cachedInputTokens ?? null, written: answer.usage?.writtenInputTokens ?? null,
        output: answer.usage?.outputTokens ?? null, reasoning: answer.usage?.reasoningTokens ?? null });
      if (answer.tries === 2) row.tries = 2;
      return answer.text;
    } catch (error) {
      if (error instanceof ModelError && error.tries === 2) row.tries = 2;
      // Cut short by the run's own end: that end is already decided. A failure that came back as the run ended still
      // counts, so that `budget_exceeded` is not lost behind another end.
      if (requests.aborted && (!(error instanceof ModelError) || error.code === 'cancelled')) { row.error = 'cancelled'; return null; }
      if (!(error instanceof ModelError)) throw error;
      row.error = error.code;
      if (['output_limit', 'declined'].includes(error.code)) { failing = 0; unused(); return null; }
      report.failures += 1;
      if (!STEP_FAILURES.includes(error.code) || ++failing >= FAILURES) end(error.code, error);
      return null;
    } finally {
      row.ms = Math.round(performance.now() - began);
      store.usage(row);
    }
  };

  const ideate = async () => {
    const n = take();
    if (n === null) return;
    const step = nextStep++, known = families(), taken = new Set(known);
    let k = 1;
    const fresh = () => { while (taken.has(`f${k}`)) k += 1; taken.add(`f${k}`); return `f${k}`; };
    const content = [`Begin up to ${ideas} ${ideas === 1 ? 'family' : 'families'} of solutions. Each is a different approach, not a variant of another: give it a short \`name\`, its \`idea\` in one line, and its first \`file\`, which should be valid even if its score is poor. Each file has at most ${task.size} characters, and all of them together at most ${ideas * task.size}.`,
      known.length ? `Families that exist already, which the new ones should differ from:\n${known.map(family => {
        const idea = all.find(candidate => candidate.family === family && candidate.idea !== undefined)?.idea;
        return `- ${named(family)}${idea ? `: ${idea}` : ''}`;
      }).join('\n')}` : 'No family exists yet.', told()].join('\n\n');
    const text = await ask('ideate', null, n, [{ role: 'user', content }], IDEATE_SCHEMA);
    const answer = text === null ? null : readIdeated(text);
    if (text !== null && !answer) unused();
    let started = false;
    if (answer) {
      unusable = 0;
      // Every first file is settled before this returns, so that none is written after a failure has ended the run.
      const settled = await Promise.allSettled(answer.families.slice(0, ideas).map((family, index) => record(family.file, { kind: 'idea', family: fresh(), parent: null, call: n, step },
        index ? [] : answer.discoveries, { name: clip(family.name.trim().replace(/\s+/g, ' '), NAME) || 'unnamed', idea: clip(family.idea.trim(), IDEA) })));
      const failure = settled.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      started = settled.some(result => result.status === 'fulfilled' && result.value?.candidate.valid);
      // The steps with no gain count from the last first file kept, as a second start counts them.
      sinceGain = 0;
    }
    // An ideation that gave nothing, by a failure or an answer that cannot be used, is asked again rather than put off
    // by `stale` more steps; every ideation that begins no valid family counts toward the end at IDEAS, so that
    // failures between answers cannot keep a run with nothing to improve asking.
    if (started) emptyIdeas = 0;
    else if (ended === null && ++emptyIdeas >= IDEAS && !active().length) end('no_valid_start');
  };

  // Whether the step improved its family's best, or null when it kept no file: only a step that kept a file and
  // improved nothing counts toward `stale`.
  const iterate = async (nth: number): Promise<boolean | null> => {
    const step = nextStep++, tops = active(), cells = elites();
    // Every EXPLORE-th step takes an elite of the archive, so that a cell no family leads still gets worked on;
    // the families take their turns among the other steps.
    const turn = nth % EXPLORE === EXPLORE - 1 && cells.length > 1 ? 'cell' : 'family';
    const parent = turn === 'cell' ? cells[explored++ % cells.length] : tops[cursor++ % tops.length];
    const others = [...tops.filter(candidate => candidate.family !== parent.family).sort(byScore), ...cells.filter(candidate => candidate.cell !== parent.cell).sort(byScore)]
      .filter((candidate, i, list) => candidate.id !== parent.id && list.findIndex(other => other.id === candidate.id) === i).slice(0, 2);
    const shown = (candidate: Candidate) => `#${candidate.id}, family ${named(candidate.family)}, ${placed(candidate)}:\n${store.text(candidate.sha)}`;
    const messages: Message[] = [{ role: 'user', content: [`The parent, to improve: ${shown(parent)}`, parent.feedback ? `Its feedback:\n${parent.feedback}` : 'The evaluator gave no feedback on it.',
      others.length ? `Other files of the archive, to borrow from:\n\n${others.map(shown).join('\n\n')}` : 'There are no other files in the archive yet.', told(),
      tries ? `You have ${tries} ${tries === 1 ? 'try' : 'tries'}: with \`try\` the evaluator runs your file and you see what it says; with \`submit\` your file is evaluated and kept, and this work ends.` : 'Use `submit`: your file is evaluated and kept, and this work ends.'].join('\n\n') }];
    let gained: boolean | null = null;
    for (let t = 0; ; t += 1) {
      const n = take();
      if (n === null) return gained;
      const last = t >= tries, text = await ask('iterate', parent.family, n, messages, iterateSchema(last));
      const answer = text === null ? null : readIterated(text, last);
      if (text !== null && !answer) unused();
      if (!answer || text === null) return gained;
      unusable = 0;
      const kept = await record(answer.file, { kind: answer.tool, family: parent.family, parent: parent.id, call: n, step }, answer.discoveries,
        { others: others.map(candidate => candidate.id), turn });
      if (!kept) return gained;
      // A gain counts at once, so that steps that end meanwhile do not bring ideation early.
      if (kept.gain) { gained = true; sinceGain = 0; } else gained ??= false;
      if (answer.tool === 'submit') return gained;
      const left = tries - t - 1;
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `The evaluator on your file: ${verdict(kept.candidate)}\n\n${left ? `${left} ${left === 1 ? 'try' : 'tries'} left.` : 'No tries are left: your next answer must use `submit`, and the schema allows only that.'}` });
    }
  };

  const stop = () => end('stopped');
  if (outer?.aborted) stop(); else outer?.addEventListener('abort', stop, { once: true });
  // A worker that fails ends the others before the failure is passed on, so that nothing writes after the caller closes the store.
  let crash: { error: unknown } | null = null;
  try {
    if (seed !== undefined && !all.length) await record(seed, { kind: 'seed', family: 'seed', parent: null, call: null, step: null }, []);
    const worker = async () => {
      try {
        while (ended === null) {
          if (ideating) { await ideating; continue; }
          if (!active().length || sinceGain >= task.stale) { ideating = ideate().finally(() => { ideating = null; }); await ideating; continue; }
          if (await iterate(turns++) === false) sinceGain += 1;
        }
      } catch (error) { crash ??= { error }; end('unexpected'); }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally { outer?.removeEventListener('abort', stop); }
  if (crash) throw (crash as { error: unknown }).error;

  report.reason = ended ?? 'calls';
  report.status = report.reason === 'calls' ? 'done' : report.reason === 'stopped' ? 'stopped' : 'failed';
  const top = active().sort(byScore)[0];
  Object.assign(report, { candidates: all.length, valid: all.filter(candidate => candidate.valid).length, cells: elites().length, families: families().length,
    best: top ? { id: top.id, family: top.family, score: top.score! } : null });
  return report;
}
