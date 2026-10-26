// `evolve` with stand-ins for the model and, in the second test, for the server behind the command: no network and no sign-in.
// This is here because a search spends calls in a loop: a limit that let one more request through, a failure that
// did not stop it, or a start that wrote over what an earlier one kept would cost money or lose the archive unnoticed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ModelError } from './chatgpt.ts';
import type { Request } from './chatgpt.ts';
import { cellOf, readTask, runEvolve } from './evolve.ts';
import type { Candidate, Evaluation, Store, UsageRow } from './evolve.ts';

const task = readTask({ spec: 'Write a file that begins with ok, as short as can be.', evaluate: ['node', 'check.js', '{file}'], cells: { len: [4, 8] } });
const judge = (text: string): Evaluation => text.startsWith('ok')
  ? { valid: true, score: text.length, features: { len: text.length }, feedback: `length ${text.length}` } : { valid: false, score: null, features: null, feedback: 'must begin with ok' };
const memory = () => {
  const texts = new Map<string, string>(), rows: UsageRow[] = [];
  const store: Store = { candidates: [], calls: 0, put: (sha, text) => { texts.set(sha, text); }, text: sha => texts.get(sha)!, add: () => {}, usage: row => { rows.push(row); } };
  return { store, rows, evaluate: async (sha: string) => judge(texts.get(sha)!) };
};
const ideas = JSON.stringify({ notes: '', discoveries: ['short wins'], families: [{ name: 'plain', idea: 'ok and padding', file: 'okxxxxxxxxxx' }, { name: 'bad', idea: 'no prefix', file: 'nope' }] });

test('evolve spends no call past its limit, tries before it submits, archives by cell and stops at a spent budget', async () => {
  assert.deepEqual([cellOf({ len: 2 }, task), cellOf({ len: 4 }, task), cellOf({ len: 99 }, task)], ['0', '1', '2']);
  const { store, rows, evaluate } = memory(), asked: Request[] = [];
  let k = 12;
  const respond = async (request: Request) => {
    asked.push(request);
    if (asked.length === 1) return { text: ideas, usage: null };
    k -= 1;
    return { text: JSON.stringify({ notes: '', discoveries: [], tool: request.messages.length === 1 ? 'try' : 'submit', file: `ok${'x'.repeat(k)}` }), usage: null };
  };
  const report = await runEvolve({ task, store, respond, model: 'stand-in', evaluate, calls: 6, cache: 'c' });
  assert.equal(asked.length, 6);
  assert.deepEqual(rows.map(row => [row.n, row.kind]), [[1, 'ideate'], [2, 'iterate'], [3, 'iterate'], [4, 'iterate'], [5, 'iterate'], [6, 'iterate']]);
  assert.deepEqual([report.status, report.reason, report.calls], ['done', 'calls', 6]);
  const kinds = store.candidates.map((candidate: Candidate) => candidate.kind);
  assert.deepEqual(kinds, ['idea', 'idea', 'try', 'submit', 'try', 'submit', 'try']);
  // A try comes back with the evaluator's verdict and only submit is left after the last try.
  assert.match(asked[2].messages.at(-1)!.content, /^The evaluator on your file: valid, score 13/);
  assert.equal(asked[0].cache, asked[5].cache);
  assert.ok(store.candidates.filter(candidate => candidate.family === 'plain').every(candidate => candidate.valid));
  assert.equal(report.best?.score, 9);
  // The same file twice is evaluated once.
  assert.equal(store.candidates[3].same, store.candidates[0].id);

  // budget_exceeded ends the run at once, with the call that met it counted and no other sent.
  const second = memory();
  let sent = 0;
  const spent = await runEvolve({ task, store: second.store, model: 'stand-in', evaluate: second.evaluate, calls: 50, parallel: 3, cache: 'c', seed: 'okxxxx',
    respond: async () => { sent += 1; if (sent === 3) throw new ModelError('budget_exceeded', 429); return { text: JSON.stringify({ notes: '', discoveries: [], tool: 'submit', file: `ok${sent}` }), usage: null }; } });
  assert.deepEqual([spent.status, spent.reason, spent.httpStatus], ['failed', 'budget_exceeded', 429]);
  assert.equal(sent, 3);
  assert.equal(second.rows.length, 3);
  assert.equal(second.rows.find(row => row.error)?.error, 'budget_exceeded');
});

test('evolve keeps a run that only grows and goes on from it, with no request or answer text in its usage rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'sagents-evolve-')), dir = join(root, 'run'), home = mkdtempSync(join(tmpdir(), 'sagents-evolve-home-'));
  writeFileSync(join(root, 'check.js'), `const text = require('fs').readFileSync(process.argv[2], 'utf8');
console.log('evaluating');
console.log(JSON.stringify(text.startsWith('ok') ? { valid: true, score: text.length, features: { len: text.length }, feedback: 'length ' + text.length } : { valid: false, feedback: 'must begin with ok' }));`);
  writeFileSync(join(root, 'seed.txt'), 'okxxxxxxxxxxxxxxxx');
  const taskText = JSON.stringify({ spec: 'Write a file that begins with ok, as short as can be.', file: 'seed.txt', evaluate: ['node', 'check.js', '{file}'], cells: { len: [4, 8] } });
  writeFileSync(join(root, 'task.json'), taskText);
  // The stand-in server answers ideation with a family and every other request with a file one character shorter.
  const preload = `data:text/javascript,${encodeURIComponent(`let n = 30; globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body), ideate = JSON.stringify(body.response_format).includes('families'); n -= 1;
    const content = ideate ? ${JSON.stringify(ideas)} : JSON.stringify({ notes: 'NOTE-OF-THE-STAND-IN', discoveries: ['d' + n], tool: 'submit', file: 'ok' + 'x'.repeat(n % 9) + 'ANSWER-TEXT' });
    return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { status: 200 });
  };`)}`;
  const start = (calls: number, file = join(root, 'task.json')) => spawnSync(process.execPath, ['--import', preload, join(import.meta.dirname, 'cli.ts'), 'evolve', dir, '--task', file, '--model', 'api:stand-in', '--calls', String(calls)],
    { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: home, SAGENTS_API_URL: 'https://server.invalid/v1' } });
  const kept = () => Object.fromEntries(readdirSync(dir).filter(name => name !== 'files').sort().map(name => [name, readFileSync(join(dir, name), 'utf8')]));

  const first = start(3);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).calls, 3);
  const one = kept();
  assert.deepEqual(Object.keys(one), ['candidates.jsonl', 'run.json', 'task.json', 'usage.jsonl']);
  assert.equal(one['task.json'], taskText);
  const usage = one['usage.jsonl'].trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(usage.map(row => [row.n, row.kind, row.input, row.output]), [[1, 'iterate', 100, 10], [2, 'iterate', 100, 10], [3, 'iterate', 100, 10]]);
  assert.ok(!one['usage.jsonl'].includes('NOTE-OF-THE-STAND-IN') && !one['usage.jsonl'].includes('ANSWER-TEXT'));
  const rows = one['candidates.jsonl'].trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].kind, 'seed');
  assert.ok(rows.every(row => readFileSync(join(dir, 'files', `${row.sha}.txt`), 'utf8').length === row.chars));

  // A second start goes on: what was kept stays to the byte, numbers continue, and the lock is gone after each start.
  const second = start(2);
  assert.equal(second.status, 0, second.stderr);
  const two = kept();
  for (const name of Object.keys(one)) assert.ok(two[name].startsWith(one[name]), name);
  assert.deepEqual(two['usage.jsonl'].trim().split('\n').map(line => JSON.parse(line).n), [1, 2, 3, 4, 5]);
  assert.ok(!Object.hasOwn(two, 'lock'));

  // Another task in the same directory, or a directory that a living process holds, starts nothing.
  writeFileSync(join(root, 'other.json'), taskText.replace('short', 'brief'));
  const other = start(1, join(root, 'other.json'));
  assert.equal(other.status, 1);
  assert.match(other.stderr, /another task file/);
  writeFileSync(join(dir, 'lock'), `${process.pid}\n`);
  const held = start(1);
  assert.match(held.stderr, /Another run holds this directory/);
  assert.deepEqual(kept()['usage.jsonl'], two['usage.jsonl']);
});
