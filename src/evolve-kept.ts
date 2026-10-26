import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EvolveError, clip, readEvaluation } from './evolve.ts';
import type { Candidate, Evaluation, Store, Task, UsageRow } from './evolve.ts';

const OUT = 65_536, ERR = 2000;
const failed = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
const cannot = (error: unknown) => {
  if (error instanceof EvolveError || !(error instanceof Error && 'code' in error && typeof error.code === 'string')) return error;
  return new EvolveError('The run directory cannot be made, read or written.');
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return failed(error, 'EPERM'); } };

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
// exception is `lock`, which names the process that holds the directory and goes when it ends.
export function keepEvolve(dir: string, taskText: string) {
  const lock = join(dir, 'lock'), files = join(dir, 'files'), candidates = join(dir, 'candidates.jsonl'), usage = join(dir, 'usage.jsonl');
  let cache: string, found: { rows: unknown[]; unreadable: number }, calls: number, unreadable: number;
  try {
    mkdirSync(files, { recursive: true });
    try { writeFileSync(join(dir, 'task.json'), taskText, { flag: 'wx' }); } catch (error) {
      if (!failed(error, 'EEXIST')) throw error;
      if (readFileSync(join(dir, 'task.json'), 'utf8') !== taskText) throw new EvolveError('The run directory keeps another task file than this one: a kept run goes on only with its own task.');
    }
    for (let tries = 0; ; tries += 1) {
      try { writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' }); break; } catch (error) {
        if (!failed(error, 'EEXIST') || tries) throw error;
        const pid = Number(readFileSync(lock, 'utf8').trim());
        if (Number.isSafeInteger(pid) && pid > 0 && alive(pid)) throw new EvolveError('Another run holds this directory.');
        unlinkSync(lock);
      }
    }
  } catch (error) { throw cannot(error); }
  try {
    try { cache = (JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { cache: string }).cache; } catch (error) {
      if (!failed(error, 'ENOENT')) throw error;
      cache = randomUUID();
      writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ cache })}\n`, { flag: 'wx' });
    }
    if (typeof cache !== 'string' || !cache) throw new EvolveError('The run directory\'s run.json cannot be read.');
    found = rowsOf(candidates);
    const rows = rowsOf(usage);
    calls = rows.rows.length + rows.unreadable;
    unreadable = found.unreadable + rows.unreadable;
  } catch (error) {
    unlinkSync(lock);
    throw error instanceof SyntaxError ? new EvolveError('The run directory\'s run.json cannot be read.') : cannot(error);
  }
  const path = (sha: string) => join(files, `${sha}.txt`);
  const store: Store = {
    candidates: found.rows as Candidate[], calls,
    put: (sha, text) => { try { writeFileSync(path(sha), text, { flag: 'wx' }); } catch (error) { if (!failed(error, 'EEXIST')) throw error; } },
    text: sha => readFileSync(path(sha), 'utf8'),
    add: (candidate: Candidate) => appendFileSync(candidates, `${JSON.stringify(candidate)}\n`),
    usage: (row: UsageRow) => appendFileSync(usage, `${JSON.stringify(row)}\n`),
  };
  return { store, cache, unreadable, path, close: () => { try { unlinkSync(lock); } catch { /* a lock that is gone already holds nothing */ } } };
}

// The evaluator runs with no shell, in a process group of its own so that a timeout or a stop ends whatever it started.
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
    child.on('close', (code, by) => {
      if (timedOut) return finish(invalid(`The evaluator ran past ${task.timeout} s and was stopped.`));
      if (signal?.aborted) return finish(invalid('The evaluator was stopped with the run.'));
      if (code !== 0) return finish(invalid(`The evaluator ended with ${code === null ? `signal ${by}` : `exit code ${code}`}.${err.trim() ? ` The end of its errors:\n${err.trim()}` : ''}`));
      finish(readEvaluation(out.trim().split('\n').at(-1) ?? '', task));
    });
  });
}
