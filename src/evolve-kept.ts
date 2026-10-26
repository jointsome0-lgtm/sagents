import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { EvolveError, clip, readEvaluation } from './evolve.ts';
import type { Candidate, Evaluation, Store, Task } from './evolve.ts';
import { isObject } from './reading.ts';

const OUT = 65_536, ERR = 2000, BUSY = 5;
const failed = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
const sqliteCode = (error: unknown) => error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : null;
const cannot = (error: unknown) => {
  if (error instanceof EvolveError || !(error instanceof Error && 'code' in error && typeof error.code === 'string')) return error;
  return new EvolveError('The run directory cannot be made, read or written.');
};

// A file appears whole or not at all: it is written beside its name, then linked to the name, which refuses a name
// that is taken, or renamed onto it, which replaces what is there.
function publish(path: string, text: string, replace = false) {
  const draft = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(draft, text, { flag: 'wx' });
    if (replace) renameSync(draft, path); else linkSync(draft, path);
  } finally { rmSync(draft, { force: true }); }
}

// The rows of a kept file; a line cut by a crash is left where it is and skipped, and the next row starts on a line of its own.
function rowsOf(path: string): { rows: unknown[]; unreadable: number } {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (error) { if (failed(error, 'ENOENT')) return { rows: [], unreadable: 0 }; throw error; }
  if (text && !text.endsWith('\n')) appendFileSync(path, '\n');
  const rows: unknown[] = [];
  let unreadable = 0;
  for (const line of text.split('\n').filter(Boolean)) try { rows.push(JSON.parse(line)); } catch { unreadable += 1; }
  return { rows, unreadable };
}

// Like `live --run`, the directory only grows: files are made where there are none and lines are added. The one
// exception is a file of `files/` that a kill cut short, whose name its contents no longer match.
// `base` is the task file's directory, from which the evaluator runs.
export function keepEvolve(dir: string, taskText: string, base: string) {
  const files = join(dir, 'files'), candidates = join(dir, 'candidates.jsonl'), usage = join(dir, 'usage.jsonl');
  let lock: DatabaseSync;
  try {
    mkdirSync(files, { recursive: true });
    // SQLite's lock, as for the state file of `live`: the system lets it go when the process ends, however it ends.
    lock = new DatabaseSync(join(dir, 'lock.sqlite'), { timeout: 0 });
  } catch (error) { throw cannot(error); }
  try { lock.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE'); } catch (error) {
    lock.close();
    throw sqliteCode(error) === BUSY ? new EvolveError('Another run holds this directory.') : cannot(error);
  }
  try {
    try { publish(join(dir, 'task.json'), taskText); } catch (error) {
      if (!failed(error, 'EEXIST')) throw error;
      if (readFileSync(join(dir, 'task.json'), 'utf8') !== taskText) throw new EvolveError('The run directory keeps another task file than this one: a kept run goes on only with its own task.');
    }
    let run: { readonly [field: string]: unknown };
    try { run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); } catch (error) {
      if (error instanceof SyntaxError) throw new EvolveError('The run directory\'s run.json cannot be read.');
      if (!failed(error, 'ENOENT')) throw error;
      run = { cache: randomUUID(), base };
      publish(join(dir, 'run.json'), `${JSON.stringify(run)}\n`);
    }
    if (!isObject(run) || typeof run.cache !== 'string' || !run.cache || typeof run.base !== 'string') throw new EvolveError('The run directory\'s run.json cannot be read.');
    if (run.base !== base) throw new EvolveError('The run directory was begun with a task file in another directory, from which its evaluator runs: a kept run goes on only from there.');
    const found = rowsOf(candidates), used = rowsOf(usage);
    // A request is numbered when it is sent, so the numbers go on after the highest kept, whether or not its end was kept.
    const calls = used.rows.reduce<number>((most, row) => isObject(row) && Number.isSafeInteger(row.n) ? Math.max(most, row.n as number) : most, 0);
    const path = (sha: string) => join(files, `${sha}.txt`);
    const store: Store = {
      candidates: found.rows.filter(row => isObject(row) && Number.isSafeInteger(row.id)) as Candidate[], calls,
      put: (sha, text) => {
        let held: Buffer | null = null;
        try { held = readFileSync(path(sha)); } catch (error) { if (!failed(error, 'ENOENT')) throw error; }
        if (held && createHash('sha256').update(held).digest('hex') === sha) return;
        publish(path(sha), text, held !== null);
      },
      text: sha => readFileSync(path(sha), 'utf8'),
      add: candidate => appendFileSync(candidates, `${JSON.stringify(candidate)}\n`),
      usage: row => appendFileSync(usage, `${JSON.stringify(row)}\n`),
    };
    return { store, cache: run.cache, unreadable: found.unreadable + used.unreadable, path, close: () => lock.close() };
  } catch (error) {
    lock.close();
    throw cannot(error);
  }
}

// The evaluator runs with no shell, in a process group of its own, which is killed when the evaluator's own process
// ends, at its timeout and at a stop, so that nothing it started outlives it or holds its output open until the
// timeout. A process that leaves the group escapes that, and so does the group when sagents itself is killed with
// SIGKILL.
// It gets the environment without the key of a chat completions server, which it has no use for.
export function runEvaluator(task: Task, file: string, cwd: string, signal?: AbortSignal): Promise<Evaluation> {
  const argv = task.evaluate.map(part => part === '{file}' ? resolve(file) : part), env = { ...process.env };
  delete env.SAGENTS_API_KEY;
  const invalid = (feedback: string): Evaluation => ({ valid: false, score: null, features: null, feedback: clip(feedback, 4000) });
  return new Promise(done => {
    let out = '', err = '', timedOut = false, settled = false;
    const finish = (evaluation: Evaluation) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', kill); done(evaluation); };
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    function kill() { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* the group has ended */ } }
    const timer = setTimeout(() => { timedOut = true; kill(); }, task.timeout * 1000);
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.setEncoding('utf8').on('data', (part: string) => { out = (out + part).slice(-OUT); });
    child.stderr.setEncoding('utf8').on('data', (part: string) => { err = (err + part).slice(-ERR); });
    child.on('error', () => finish(invalid('The evaluator could not be started.')));
    child.on('exit', kill);
    child.on('close', (code, by) => {
      if (timedOut) return finish(invalid(`The evaluator ran past ${task.timeout} s and was stopped.`));
      if (signal?.aborted) return finish(invalid('The evaluator was stopped with the run.'));
      if (code !== 0) return finish(invalid(`The evaluator ended with ${code === null ? `signal ${by}` : `exit code ${code}`}.${err.trim() ? ` The end of its errors:\n${err.trim()}` : ''}`));
      finish(readEvaluation(out.trim().split('\n').at(-1) ?? '', task));
    });
  });
}
