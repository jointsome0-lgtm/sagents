// `evolve` with stand-ins for the model and, in the second test, for the server behind the command: no network and no sign-in.
// This is here because a search spends calls in a loop: a limit that let one more request through, failures that
// did not stop it, or a start that wrote over what an earlier one kept would cost money or lose the archive unnoticed.
// The tests check what a run spends and keeps, not how it chooses its steps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ModelError } from './chatgpt.ts';
import type { Controls, Request } from './chatgpt.ts';
import { readTask, runEvolve } from './evolve.ts';
import type { Store } from './evolve.ts';
import { keepEvolve } from './evolve-kept.ts';

const SPEC = 'Write a file that begins with ok, as short as can be.';

test('evolve sends no request past --calls, none after budget_exceeded or a stop, and stops on answers it cannot use and on failures in a row', async () => {
  const task = readTask({ spec: SPEC, evaluate: ['check', '{file}'], cells: { len: [4, 8] } });
  let sent = 0;
  const run = (respond: (request: Request, controls?: Controls) => Promise<{ text: string; usage: null }>, more: { calls?: number; parallel?: number; signal?: AbortSignal; seed?: string } = {}) => {
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

  // budget_exceeded cuts the requests under way rather than leaving them to be sent again, and is in the summary,
  // even when answers that could not be used have ended the run before it.
  let cut = 0;
  const spent = await run(async (_request, controls) => {
    sent += 1;
    if (sent === 2) { await new Promise(resolve => setTimeout(resolve, 50)); throw new ModelError('budget_exceeded', 429); }
    if (sent !== 3) return { text: 'not json', usage: null };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);
      controls?.signal?.addEventListener('abort', () => { clearTimeout(timer); cut += 1; reject(new ModelError('cancelled')); }, { once: true });
    });
    return file();
  }, { parallel: 3 });
  assert.deepEqual([sent, cut, spent.status, spent.reason, spent.httpStatus], [7, 1, 'failed', 'budget_exceeded', 429]);

  // A stop sends nothing more.
  const stop = new AbortController();
  const stopped = await run(async () => { sent += 1; if (sent === 2) stop.abort(); return file(); }, { signal: stop.signal });
  assert.deepEqual([sent, stopped.status], [2, 'stopped']);

  // Answers that cannot be used end the run long before its calls are spent.
  const wasted = await run(async () => { sent += 1; throw new ModelError('output_limit'); });
  assert.ok(sent <= 5, `${sent} requests`);
  assert.equal(wasted.status, 'failed');

  // A failed request ends only its step, and failures in a row end the run long before its calls are spent.
  const flaky = await run(async () => { sent += 1; if (sent % 3 === 0) throw new ModelError('provider_failed', 500); return file(); }, { calls: 9 });
  assert.deepEqual([sent, flaky.status, flaky.failures], [9, 'done', 3]);
  const down = await run(async () => { sent += 1; throw new ModelError('timeout'); });
  assert.ok(sent <= 3, `${sent} requests`);
  assert.deepEqual([down.status, down.reason], ['failed', 'timeout']);

  // A run with no valid file ends after three ideations that begin none, failed and declined ones among them.
  const barren = await run(async () => { sent += 1; throw new ModelError(sent % 3 ? 'timeout' : 'declined'); }, { seed: undefined });
  assert.deepEqual([sent, barren.reason], [3, 'no_valid_start']);
});

test('evolve keeps a run that only grows and goes on from it, refuses a second writer, keeps no answer text in its usage rows, and maps it without writing to it or loading anything', () => {
  const root = mkdtempSync(join(tmpdir(), 'sagents-evolve-')), dir = join(root, 'run'), home = mkdtempSync(join(tmpdir(), 'sagents-evolve-home-'));
  writeFileSync(join(root, 'check.js'), `const text = require('fs').readFileSync(process.argv[2], 'utf8');
console.log('evaluating');
console.log(JSON.stringify(text.startsWith('ok') ? { valid: true, score: text.length, features: { len: text.length } } : { valid: false }));`);
  const seed = 'okxxxxxxxxxxxxxxxx';
  writeFileSync(join(root, 'seed.txt'), seed);
  const taskText = JSON.stringify({ spec: SPEC, file: 'seed.txt', evaluate: ['node', 'check.js', '{file}'], cells: { len: [4, 8] } });
  writeFileSync(join(root, 'task.json'), taskText);
  // The stand-in server answers every request with a new file, with words that must stay out of the usage rows and the
  // output, and with markup that the map must show as text.
  const preload = `data:text/javascript,${encodeURIComponent(`let n = 0; globalThis.fetch = async () => {
    n += 1;
    const content = JSON.stringify({ notes: 'NOTE-OF-THE-STAND-IN', discoveries: ['FOUND-BY-THE-STAND-IN'], tool: 'submit', file: 'ok' + 'x'.repeat(n % 7) + 'ANSWER-TEXT<img src="https://leak.invalid/">' + process.pid });
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

  // Another task in the same directory, or a directory that another run holds, starts nothing. The map reads a held
  // directory all the same, and its page loads nothing and runs nothing, whatever the model wrote.
  writeFileSync(join(root, 'other.json'), taskText.replace('short', 'brief'));
  assert.match(start(1, join(root, 'other.json')).stderr, /another task file/);
  // Rows edited by hand, with markup where a number belongs, are left out of the map rather than drawn.
  const link = '</title><a href="https://leak.invalid/">x</a><title>';
  appendFileSync(join(dir, 'candidates.jsonl'), `${JSON.stringify({ ...rows(two['candidates.jsonl'])[0], id: 999, call: link })}\n`);
  appendFileSync(join(dir, 'usage.jsonl'), `${JSON.stringify({ n: 999, at: '', kind: 'iterate', family: null, ms: 1, input: link, cached: null, written: null, output: null, reasoning: null })}\n`);
  const three = kept();
  const held = keepEvolve(dir, taskText, root);
  try {
    assert.match(start(1).stderr, /Another run holds this directory/);
    const map = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'evolve-map', dir], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: home } });
    assert.equal(map.status, 0, map.stderr);
    assert.match(map.stdout, /ANSWER-TEXT&#60;img src=&#34;https:/);
    assert.doesNotMatch(map.stdout, /<(?:script|img|iframe|object|embed|link)\b|\b(?:src|href)\s*=\s*["'](?!#)|url\(|@import/i);
  } finally { held.close(); }
  assert.deepEqual(kept(), three);
});
