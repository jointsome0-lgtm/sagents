// `evolve` with stand-ins for the model and, in the second test, for the server behind the command: no network and no sign-in.
// This is here because a search spends calls in a loop: a limit that let one more request through, a failure that
// did not stop it, or a start that wrote over what an earlier one kept would cost money or lose the archive unnoticed.
// The tests check what a run spends and keeps, not how it chooses its steps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ModelError } from './chatgpt.ts';
import type { Controls, Request } from './chatgpt.ts';
import { readTask, runEvolve } from './evolve.ts';
import type { Store } from './evolve.ts';
import { keepEvolve } from './evolve-kept.ts';

const SPEC = 'Write a file that begins with ok, as short as can be.';

test('evolve sends no request past --calls, none after budget_exceeded or a stop, and stops on answers it cannot use', async () => {
  const task = readTask({ spec: SPEC, evaluate: ['check', '{file}'], cells: { len: [4, 8] } });
  let sent = 0;
  const run = (respond: (request: Request, controls?: Controls) => Promise<{ text: string; usage: null }>, more: { calls?: number; parallel?: number; signal?: AbortSignal } = {}) => {
    const texts = new Map<string, string>();
    const store: Store = { candidates: [], calls: 0, put: (sha, text) => { texts.set(sha, text); }, text: sha => texts.get(sha)!, add: () => {}, usage: () => {} };
    sent = 0;
    return runEvolve({ task, store, model: 'stand-in', cache: 'c', seed: 'okxxxxxx', calls: 50, respond, ...more,
      evaluate: async sha => ({ valid: true, score: texts.get(sha)!.length, features: { len: texts.get(sha)!.length }, feedback: '' }) });
  };
  const file = () => ({ text: JSON.stringify({ notes: '', discoveries: [], tool: 'try', file: `ok${sent}` }), usage: null });

  // Several steps at once, each with tries, stay within the limit.
  const capped = await run(async () => { sent += 1; await new Promise(resolve => setTimeout(resolve, 5)); return file(); }, { calls: 7, parallel: 3 });
  assert.deepEqual([sent, capped.calls, capped.status], [7, 7, 'done']);

  // budget_exceeded ends the run, and the requests under way are cut rather than left to be sent again.
  let cut = 0;
  const spent = await run(async (_request, controls) => {
    sent += 1;
    if (sent === 3) throw new ModelError('budget_exceeded', 429);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);
      controls?.signal?.addEventListener('abort', () => { clearTimeout(timer); cut += 1; reject(new ModelError('cancelled')); }, { once: true });
    });
    return file();
  }, { parallel: 3 });
  assert.deepEqual([sent, cut, spent.status, spent.reason, spent.httpStatus], [3, 2, 'failed', 'budget_exceeded', 429]);

  // A stop sends nothing more.
  const stop = new AbortController();
  const stopped = await run(async () => { sent += 1; if (sent === 2) stop.abort(); return file(); }, { signal: stop.signal });
  assert.deepEqual([sent, stopped.status], [2, 'stopped']);

  // Answers that cannot be used end the run long before its calls are spent.
  const wasted = await run(async () => { sent += 1; throw new ModelError('output_limit'); });
  assert.ok(sent <= 5, `${sent} requests`);
  assert.equal(wasted.status, 'failed');
});

test('evolve keeps a run that only grows and goes on from it, refuses a second writer, and keeps no answer text in its usage rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'sagents-evolve-')), dir = join(root, 'run'), home = mkdtempSync(join(tmpdir(), 'sagents-evolve-home-'));
  writeFileSync(join(root, 'check.js'), `const text = require('fs').readFileSync(process.argv[2], 'utf8');
console.log('evaluating');
console.log(JSON.stringify(text.startsWith('ok') ? { valid: true, score: text.length, features: { len: text.length } } : { valid: false }));`);
  const seed = 'okxxxxxxxxxxxxxxxx';
  writeFileSync(join(root, 'seed.txt'), seed);
  const taskText = JSON.stringify({ spec: SPEC, file: 'seed.txt', evaluate: ['node', 'check.js', '{file}'], cells: { len: [4, 8] } });
  writeFileSync(join(root, 'task.json'), taskText);
  // The stand-in server answers every request with a new file, and with words that must stay out of the usage rows and the output.
  const preload = `data:text/javascript,${encodeURIComponent(`let n = 0; globalThis.fetch = async () => {
    n += 1;
    const content = JSON.stringify({ notes: 'NOTE-OF-THE-STAND-IN', discoveries: ['FOUND-BY-THE-STAND-IN'], tool: 'submit', file: 'ok' + 'x'.repeat(n % 7) + 'ANSWER-TEXT' + process.pid });
    return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { status: 200 });
  };`)}`;
  const start = (calls: number, file = join(root, 'task.json')) => spawnSync(process.execPath, ['--import', preload, join(import.meta.dirname, 'cli.ts'), 'evolve', dir, '--task', file, '--model', 'api:stand-in', '--calls', String(calls)],
    { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: home, SAGENTS_API_URL: 'https://server.invalid/v1' } });
  const kept = () => Object.fromEntries(readdirSync(dir).filter(name => /\.jsonl?$/.test(name)).sort().map(name => [name, readFileSync(join(dir, name), 'utf8')]));
  const rows = (text: string) => text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const shaOf = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

  // A file that a kill cut short is not judged as the whole one.
  mkdirSync(join(dir, 'files'), { recursive: true });
  writeFileSync(join(dir, 'files', `${shaOf(seed)}.txt`), seed.slice(0, 5));
  const first = start(3);
  assert.equal(first.status, 0, first.stderr);
  const one = kept(), archived = rows(one['candidates.jsonl']);
  assert.equal(archived[0].score, seed.length);
  for (const row of archived) assert.equal(shaOf(readFileSync(join(dir, 'files', `${row.sha}.txt`))), row.sha);
  // Every request is counted with its tokens, and no words of an answer are in the usage rows or in what the command printed.
  const used = rows(one['usage.jsonl']);
  assert.deepEqual([new Set(used.map(row => row.n)).size, used.reduce((sum, row) => sum + (row.input ?? 0), 0)], [3, 300]);
  for (const text of [one['usage.jsonl'], first.stdout, first.stderr]) assert.doesNotMatch(text, /NOTE-OF|FOUND-BY|ANSWER-TEXT/);

  // A second start goes on: what was kept stays to the byte, and no request number or id is given twice.
  const second = start(2);
  assert.equal(second.status, 0, second.stderr);
  const two = kept(), ids = rows(two['candidates.jsonl']).map(row => row.id);
  for (const name of Object.keys(one)) assert.ok(two[name].startsWith(one[name]), name);
  assert.equal(new Set(rows(two['usage.jsonl']).map(row => row.n)).size, 5);
  assert.equal(new Set(ids).size, ids.length);

  // Another task in the same directory, or a directory that another run holds, starts nothing.
  writeFileSync(join(root, 'other.json'), taskText.replace('short', 'brief'));
  assert.match(start(1, join(root, 'other.json')).stderr, /another task file/);
  const held = keepEvolve(dir, taskText, root);
  try { assert.match(start(1).stderr, /Another run holds this directory/); } finally { held.close(); }
  assert.deepEqual(kept(), two);
});
