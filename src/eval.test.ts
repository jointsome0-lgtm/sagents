// The call cap protects the owner's budget, and checked quotes are the only evidence an eval report keeps.
// The reader must neither lose the tail of a killed run nor change the journal that is its only state.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { ModelError } from './chatgpt.ts';
import { sizeOf } from './reading.ts';
import { runEval } from './eval.ts';
import type { StoredEntry } from './eval.ts';
import { StateError } from './journal.ts';
import { openState, readState } from './state.ts';

const world = { title: 'A synthetic run', characters: [{ id: 'a', name: 'Anna', memory: 'A promise.' }] };
const questions = { task: 'Find lost promises.', kinds: { lost: 'A promise that was lost.' } };
const entries: StoredEntry[] = [{ seq: 0, record: { kind: 'a-new-kind' }, event: { clock: '09:00', place: 'room', who: 'a', kind: 'a-new-kind', text: 'I will return the book.', note: 'PRIVATE-NOTE' }, by: 'PRIVATE-MODEL' }];
const answer = (more: object = {}) => JSON.stringify({ notes: '', drop: [], found: [], tool: 'log', from: null, to: null, who: null, summary: null, ...more });

test('eval stops at the call cap whatever the judge answers, and returns the report', async () => {
  const check = (messages: { role: string; content: string }[]) => {
    assert.deepEqual(messages.map(message => message.role), messages.map((_, i) => i % 2 ? 'assistant' : 'user'));
    assert.equal(messages.at(-1)!.role, 'user');
  };
  for (const most of [2, 7]) for (const replies of ['log', 'invalid', 'output_limit', 'declined', 'mixed']) {
    let calls = 0;
    const result = await runEval({ world, questions, entries, model: 'stand-in', calls: most, window: replies === 'mixed' ? 1 : 6000, respond: async request => {
      check(request.messages);
      calls += 1;
      if (replies === 'output_limit' || replies === 'declined') throw new ModelError(replies);
      if (replies === 'mixed' && calls % 3 === 0) throw new ModelError('output_limit');
      return { text: replies === 'invalid' ? ['not JSON', '{}', ''][calls - 1] : replies === 'mixed' && calls % 3 === 1 ? 'not JSON '.repeat(90) : answer(), usage: null };
    } });
    const unusable = ['invalid', 'output_limit', 'declined'].includes(replies);
    assert.equal(calls, unusable ? Math.min(most, 3) : most);
    assert.equal(result.calls, calls);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, unusable && most >= 3 ? replies : 'calls');
  }
  for (const failures of [['invalid', 'output_limit', 'declined']]) {
    let calls = 0;
    const result = await runEval({ world, questions, entries, model: 'stand-in', calls: 7, respond: async request => {
      check(request.messages);
      const failure = failures[calls++];
      if (failure !== 'invalid') throw new ModelError(failure);
      return { text: '{}', usage: null };
    } });
    assert.equal(calls, 3);
    assert.equal(result.calls, 3);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, failures[2]);
  }
  for (const most of [1, 3]) {
    let calls = 0;
    const result = await runEval({ world, questions, entries, model: 'stand-in', calls: most, respond: async request => {
      check(request.messages);
      if (++calls === 1) assert.ok(request.messages[0].content.endsWith(`You have ${most} answers.\nNo record is in this message: ask for them with show.`
        + (most === 1 ? '\nThis is the last request. Use report; the schema allows only report.' : '')));
      else assert.equal(request.messages.at(-1)!.content, 'Finding 1 kept as #1.\n1 of 1 records have not been shown; the first of them is #0. Read them with show, or answer report again to end with them unread.\n2 answers left.');
      return { text: answer({ tool: 'report', ...(calls === 1 ? { notes: 'Still unread.', summary: 'An early report.',
        found: [{ kind: 'lost', at: [0], quote: 'I will return the book.', says: 'The promise was lost.' }] } : {}) }), usage: null };
    } });
    assert.equal(calls, most === 1 ? 1 : 2);
    assert.equal(result.calls, calls);
    assert.equal(result.status, 'done');
    assert.equal(result.shown, 0);
    assert.equal(result.findings.length, 1);
    assert.equal(result.notes, 'Still unread.');
    assert.equal(result.summary, 'An early report.');
  }
  const long = { ...entries[0], event: { ...entries[0].event as object, text: 'word '.repeat(1400).trim() } };
  let calls = 0;
  const result = await runEval({ world, questions, entries: [long], model: 'stand-in', calls: 4, window: 1000, respond: async request => {
    check(request.messages);
    calls += 1;
    if (calls === 3) {
      assert.ok(request.messages.at(-1)!.content.includes((long.event as { text: string }).text));
    }
    return { text: answer(calls === 2 ? { tool: 'show', from: 0, to: 0 } : calls === 4 ? { tool: 'report' } : {}), usage: null };
  } });
  assert.equal(calls, 4);
  assert.equal(result.calls, 4);
  assert.equal(result.status, 'done');
  let parts = 0, joined = '';
  const split = await runEval({ world, questions, entries: [{ ...long, seq: 5, event: { text: 'word '.repeat(1600) + 'TAIL' } }, { ...entries[0], seq: 6 }],
    model: 'stand-in', calls: 5, window: 1, respond: async request => {
      check(request.messages);
      if (++parts === 3) { joined += request.messages.at(-1)!.content.split('\n\n')[0]; throw new ModelError('output_limit'); }
      if (parts === 4) assert.ok(request.messages.some(message => message.content.includes('Continue within #5')));
      if (parts === 5) {
        const part = request.messages.at(-1)!.content;
        assert.ok(part.startsWith('#5 goes on:\n'));
        joined += part.slice('#5 goes on:\n'.length).split('\n\n')[0];
      }
      return { text: answer(parts === 1 ? { tool: 'show', from: 6, to: 6 } : parts === 2 ? { tool: 'show', from: 5, to: 5 }
        : parts === 4 ? { tool: 'show' } : { tool: 'report' }), usage: null };
    } });
  assert.equal(split.shown, 2);
  assert.equal(joined, '#5 + s []  a-new-kind\n' + 'word '.repeat(1600) + 'TAIL');
  let failedCalls = 0;
  const failed = await runEval({ world, questions, entries, model: 'stand-in', calls: 7, respond: async request => {
    check(request.messages);
    if (++failedCalls === 2) throw new ModelError('budget_exceeded');
    return { text: answer({ tool: 'show' }), usage: null };
  } });
  assert.equal(failedCalls, 2);
  assert.equal(failed.calls, 2);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reason, 'budget_exceeded');
  assert.equal(failed.shown, 0);
});

test('eval keeps only a finding whose quote is in a record it names', async () => {
  const long = 'word '.repeat(39) + 'promise'.repeat(40) + ' tail';
  const found = [
    { kind: 'lost', at: [0], quote: 'I will return the book.', says: 'The promise was lost.' },
    { kind: 'lost', at: [0], quote: 'An invented promise.', says: 'Not evidence.' },
    { kind: 'lost', at: [99], quote: 'I will return the book.', says: 'No record.' },
    { kind: 'lost', at: [0], quote: 'I  will\nreturn the book.', says: 'The same promise.' },
    { kind: 'lost', at: [0], quote: 'PRIVATE-MODEL', says: 'The model name is not evidence.' },
    { kind: 'lost', at: [0], quote: 'I\u2019LL RETURN\u2014THE BOOK.', says: 'The same words with other punctuation.' },
    { kind: 'lost', at: [1], quote: 'A promise.', says: 'The rewrite dropped the promise.' },
    { kind: 'lost', at: [0], quote: 'A promise.', says: 'The wrong record.' },
    { kind: 'lost', at: [0], quote: 'can', says: 'Part of a word.' },
    { kind: 'lost', at: [0], quote: '1', says: 'Part of a number.' },
    { kind: 'lost', at: [2], quote: long, says: 'A long promise.' }
  ];
  const journal = [{ ...entries[0], event: { ...entries[0].event as object, text: "I will return the book. I'll return-the book. I cannot pay 1,000." } },
    { seq: 1, record: { kind: 'memory', who: 'a', text: 'A meeting.', upTo: 0 }, event: { clock: '09:01', who: 'a', kind: 'memory', text: 'A meeting.' }, by: null },
    { ...entries[0], seq: 2, event: { ...entries[0].event as object, text: long } }];
  let calls = 0;
  const result = await runEval({ world, questions, entries: journal, model: 'stand-in', respond: async () => ({ text: answer({ tool: 'report',
    ...(++calls === 1 ? { summary: 'One lost promise.', found } : {}) }), usage: null }) });
  assert.equal(result.status, 'done');
  assert.deepEqual(result.findings, [{ n: 1, ...found[0], clocks: ['09:00'] }, { n: 2, ...found[5], clocks: ['09:00'] }, { n: 3, ...found[6], clocks: ['09:01'] },
    { n: 4, ...found[10], quote: long.slice(0, 400), clocks: ['09:00'] }]);
  assert.equal(sizeOf(result.findings[3].quote), 40);
  assert.deepEqual(result.refused, { quote: 5, record: 1, duplicate: 1, full: 0 });
  assert.deepEqual(result.unkept, [1, 2, 3, 4, 7, 8, 9].map((i, n) => ({ call: 1, ...found[i], why: ['quote', 'record', 'duplicate', 'quote', 'quote', 'quote', 'quote'][n] })));
  const quotes = ['1,000', '1.25', "I'll pay", 'I\u2019ll pay', '1', '000', '1000', '12', '125', 'll', 'ill'];
  calls = 0;
  const numbers = await runEval({ world, questions, entries: [{ ...entries[0], event: { text: "1,000 1,2 1.25 I'll pay" } }], model: 'stand-in',
    respond: async () => ({ text: answer({ tool: 'report', found: ++calls === 1 ? quotes.map(quote => ({ kind: 'lost', at: [0], quote, says: 'Checked words.' })) : [] }), usage: null }) });
  assert.deepEqual(numbers.findings.map(item => item.quote), ['1,000', '1.25', "I'll pay"]);
  assert.deepEqual(numbers.refused, { quote: 7, record: 0, duplicate: 1, full: 0 });
  calls = 0;
  const taken = await runEval({ world, questions, entries, model: 'stand-in', calls: 4, window: 1, respond: async request => {
    if (++calls === 3) assert.ok(request.messages[0].content.includes('#1 lost [0]: The promise was lost.'));
    if (calls === 4) {
      assert.ok(!request.messages[0].content.includes('#1 lost'));
      assert.ok(request.messages[0].content.includes('#2 lost [0]: The promise was lost.'));
      assert.ok(request.messages.at(-1)!.content.startsWith('Finding #1 taken back.\nThere is no kept finding #99.\nThere is no kept finding #1.\nFinding 1 kept as #2.'));
    }
    return { text: answer(calls === 1 ? { tool: 'show', found: [found[0]] } : calls === 3 ? { drop: [1, 99, 1], found: [found[0]] }
      : calls === 4 ? { tool: 'report' } : {}), usage: null };
  } });
  assert.deepEqual(taken.findings, [{ n: 2, ...found[0], clocks: ['09:00'] }]);
  assert.deepEqual(taken.dropped, [{ n: 1, ...found[0], clocks: ['09:00'], call: 3 }]);
  assert.equal(taken.usage[2].kept, 1);
  const rewritten = [0, 0.5, 0, 1, 0].map((upTo, i) => ({ seq: i + 1, record: { kind: 'memory', who: 'a', upTo, text: i === 4 ? null : `Memory ${i}.` },
    event: { kind: 'memory', who: 'a', text: i === 4 ? null : `Memory ${i}.` }, by: null }));
  calls = 0;
  await runEval({ world, questions, entries: [...entries, ...rewritten], model: 'stand-in', calls: 3, respond: async request => {
    const text = request.messages.at(-1)!.content;
    if (++calls === 2) {
      assert.match(text, /#1 [^\n]*\n[^\n]*#0 to #0[^\n]*\nMemory before[^\n]*\nA promise\.\nMemory after[^\n]*\nMemory 0\./);
      assert.equal(text.match(/#(?:2|5) [^\n]*\n[^\n]*unknown range/g)?.length, 2);
      assert.match(text, /#5 [^\n]*\n[^\n]*unknown range[^\n]*\n[^\n]*\nMemory[^\n]*\nMemory 3\./);
    }
    if (calls === 3) {
      assert.ok(text.includes('#2 folds an unknown range'));
      assert.ok(text.includes('#3 folds up to #0'));
      assert.ok(text.includes('#5 folds an unknown range'));
    }
    return { text: answer(calls === 1 ? { tool: 'show' } : calls === 2 ? { tool: 'diff', who: 'Anna' } : { tool: 'report' }), usage: null };
  } });
});

test('eval reads all the rows of an unclosed state without changing them, and refuses a held state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sagents-eval-')), path = join(dir, 'state.sqlite');
  try {
    assert.throws(() => readState(join(dir, 'missing.sqlite')), error => error instanceof StateError && error.message ===
      'The state file cannot be opened: it is missing, or its run was not closed and its directory cannot be written for SQLite side files.');
    const state = openState(path, 'world', 'environment');
    try { assert.throws(() => readState(path), { name: 'Error', message: 'The state file is in use by another run. Wait until that run ends.' }); }
    finally { state.close(); }
    const script = `import { openState } from ${JSON.stringify(new URL('./state.ts', import.meta.url).href)};
      const state = openState(${JSON.stringify(path)}, 'world', 'environment');
      state.append(${JSON.stringify(entries)});
      process.kill(process.pid, 'SIGKILL');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert.ok(readFileSync(`${path}-wal`).length > 0);
    const rows = () => {
      const database = new DatabaseSync(path, { readOnly: true });
      try { return { meta: database.prepare('SELECT * FROM meta ORDER BY key').all(), journal: database.prepare('SELECT * FROM journal ORDER BY seq').all() }; }
      finally { database.close(); }
    };
    const before = rows();
    assert.deepEqual(readState(path, 'world', 'environment'), { entries, world: 'matches' });
    assert.equal(readState(path, 'changed', 'environment').world, 'unverified');
    assert.deepEqual(rows(), before);
    const database = new DatabaseSync(path);
    database.prepare('UPDATE meta SET value = ? WHERE key = ?').run('a-future-format', 'format');
    database.close();
    const future = rows();
    assert.deepEqual(readState(path).entries, entries);
    assert.deepEqual(rows(), future);
    const foreign = join(dir, 'foreign.sqlite'), other = new DatabaseSync(foreign);
    other.exec('CREATE TABLE notes (body TEXT)');
    other.close();
    const bytes = readFileSync(foreign);
    assert.throws(() => readState(foreign), error => error instanceof StateError && error.message === 'The state file cannot be used: it is not a state file of `live`.');
    assert.deepEqual(readFileSync(foreign), bytes);
  } finally { rmSync(dir, { recursive: true }); }
});
