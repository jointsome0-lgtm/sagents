// A wrong count here states the money spent by a kept run wrongly.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { numbersJSON, numbersOf, numbersTable, readPrices } from './numbers.ts';

test('dollars count reported tokens at each model price, exclude uncounted requests and refuse wrong prices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sagents-numbers-')), file = join(dir, 'prices.json');
  const prices = { alpha: { input: 2, cached: 1, written: 4, output: 8 }, beta: { input: 4, cached: 2, written: 8, output: 16 } };
  const rows = [
    { kind: 'turn', model: 'alpha', input: 1000, cached: 200, written: 100, output: 100 },
    { kind: 'world', model: 'beta', input: 2000, cached: 500, written: 300, output: 200 },
    { kind: 'turn', model: 'absent', input: 1000, output: 100, error: 'provider_failed' },
    { kind: 'turn', model: 'absent', input: null, output: null }
  ];
  const save = (usage: object[]) => writeFileSync(join(dir, 'usage-part1.jsonl'), usage.map(row => JSON.stringify(row)).join('\n') + '\n');
  const command = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, 'cli.ts'), 'numbers', dir, ...args], { encoding: 'utf8' });
  try {
    writeFileSync(join(dir, 'world.json'), JSON.stringify({ places: [], characters: [] }));
    writeFileSync(join(dir, 'part1.events.jsonl'), '');
    writeFileSync(file, JSON.stringify(prices));
    save(rows);
    const run = numbersOf(dir, readPrices(file));
    // Alpha: 700*2 + 200*1 + 100*4 + 100*8 = 2800; beta: 1200*4 + 500*2 + 300*8 + 200*16 = 11400.
    assert.equal(run.rows.get('dollars'), 0.0142);
    assert.equal(run.rows.get('requests outside the dollars'), 2);
    assert.match(numbersTable([run]), /dollars\s+0\.0142\n/);
    const result = command('--prices', file, '--json');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify(numbersJSON([run])) + '\n');
    const plain = numbersOf(dir);
    assert.equal(plain.rows.has('dollars'), false);
    assert.equal(plain.rows.has('requests outside the dollars'), false);
    assert.deepEqual([...plain.rows], [...run.rows].filter(([name]) => !['dollars', 'requests outside the dollars'].includes(name)));

    save(rows.slice(0, 2));
    assert.equal(numbersOf(dir).rows.get('input tokens written to a cache'), 400);
    const old = rows.slice(0, 2).map(({ written, ...row }) => row);
    save(old);
    const before = numbersOf(dir);
    assert.equal(before.rows.get('input tokens written to a cache'), null);
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), 0.0128);
    save([{ kind: 'turn', model: 'alpha', input: 1000, output: 100, cached: null, written: null }]);
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), 0.0028);
    save(rows.slice(0, 2));
    assert.deepEqual([...before.rows].filter(([name]) => name !== 'input tokens written to a cache'),
      [...numbersOf(dir).rows].filter(([name]) => name !== 'input tokens written to a cache'));

    writeFileSync(file, JSON.stringify({ alpha: prices.alpha }));
    const absent = numbersOf(dir, readPrices(file));
    assert.equal(absent.rows.get('dollars'), null);
    assert.equal(absent.rows.get('requests outside the dollars'), 0);
    assert.match(numbersTable([absent]), /dollars\s+-\n/);
    assert.equal(command('--prices', file).status, 0);
    writeFileSync(file, JSON.stringify(prices));
    save([{ ...rows[0], written: 900 }]);
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), null);
    save([rows[0], { ...rows[0], input: -1 }]);
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), null);
    // The same tokens in one row and in three give the same dollars.
    writeFileSync(file, JSON.stringify({ alpha: { input: 1, cached: 0, written: 0, output: 0 } }));
    save([{ kind: 'turn', model: 'alpha', input: 150, output: 0 }]);
    const whole = numbersOf(dir, readPrices(file)).rows.get('dollars');
    save([50, 50, 50].map(input => ({ kind: 'turn', model: 'alpha', input, output: 0 })));
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), whole);
    writeFileSync(file, JSON.stringify(prices));
    writeFileSync(join(dir, 'usage-part1.jsonl'), '{damaged}\n');
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), null);
    save(rows);
    writeFileSync(join(dir, 'usage-part3.jsonl'), '');
    assert.equal(numbersOf(dir, readPrices(file)).rows.get('dollars'), null);

    for (const wrong of ['[]', 'null', '{', '{"alpha":1}', JSON.stringify({ alpha: { ...prices.alpha, extra: 0 } }),
      '{"alpha":{"input":1,"cached":1,"output":1}}', '{"alpha":{"input":-1,"cached":1,"written":1,"output":1}}',
      '{"alpha":{"input":1e999,"cached":1,"written":1,"output":1}}', '{"alpha":{"input":1000001,"cached":1,"written":1,"output":1}}',
      '{"alpha":{"input":"PRIVATE-TEXT","cached":1,"written":1,"output":1}}']) {
      writeFileSync(file, wrong);
      const result = command('--prices', file);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.split('\n').length, 2);
      assert.ok(result.stderr.includes(JSON.stringify(file)));
      assert.match(result.stderr, /A price file must be a JSON object keyed by model name/);
      assert.ok(!result.stderr.includes('PRIVATE-TEXT'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
