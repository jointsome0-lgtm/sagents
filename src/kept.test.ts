// `live --run` through the command itself, with `fetch` replaced before it starts: no network and no sign-in.
// This is here because a kept run is the only record of what a paid run played and spent: a second start that wrote
// over the first, or a row that held a request's text, would lose the one or leak the other unnoticed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { openLab } from '../lab/data.ts';

const NOTE = 'NOTE-OF-THE-STAND-IN';
const answer = { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ note: NOTE, action: 'wait', text: null, to: null, place: null, seconds: 600, until: null }) } }],
  usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } };
const preload = `data:text/javascript,${encodeURIComponent(`globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(answer))}, { status: 200 });`)}`;
const example = (name: string) => join(import.meta.dirname, `../examples/${name}.json`);

test('live --run keeps each start as a stretch of one world that the lab reads, and writes over nothing', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'sagents-kept-')), 'run'), home = mkdtempSync(join(tmpdir(), 'sagents-kept-home-'));
  const start = (world: string, ...more: string[]) => spawnSync(process.execPath, ['--import', preload, join(import.meta.dirname, 'cli.ts'), 'live', example(world), '--model', 'api:stand-in', '--calls', '3', '--run', dir, ...more],
    { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: home, SAGENTS_API_URL: 'https://server.invalid/v1' } });
  // What is kept but the state file, which grows by the journal's own rules: every other file by its bytes.
  const kept = () => Object.fromEntries(readdirSync(dir).filter(name => !name.startsWith('state.sqlite')).sort().map(name => [name, readFileSync(join(dir, name), 'utf8')]));
  const rows = (name: string) => kept()[name].split('\n').filter(Boolean).map(text => JSON.parse(text));

  const first = start('night-station');
  assert.equal(first.status, 0, first.stderr);
  const one = kept();
  assert.deepEqual(Object.keys(one), ['part1.events.jsonl', 'usage-part1.jsonl', 'world.json']);
  assert.equal(one['world.json'], readFileSync(example('night-station'), 'utf8'));
  // A row for every request, with the counted fields and nothing else: no text of a request or of an answer.
  assert.equal(rows('usage-part1.jsonl').length, 3);
  for (const row of rows('usage-part1.jsonl')) {
    assert.deepEqual(Object.keys(row), ['n', 'at', 'kind', 'who', 'model', 'ms', 'input', 'cached', 'output', 'reasoning']);
    assert.deepEqual([row.kind, typeof row.who, row.model, row.input, row.cached, row.output], ['turn', 'string', 'api:stand-in', 100, 40, 10]);
  }
  assert.ok(!one['usage-part1.jsonl'].includes(NOTE));
  // The events are those the command printed, each a line as the engine gave it.
  assert.ok(rows('part1.events.jsonl').length >= 3);
  assert.ok(rows('part1.events.jsonl').every(event => typeof event.clock === 'string' && typeof event.kind === 'string'));

  // A second start goes on in the same world as a new stretch, and what was there is what it was, to the byte.
  const second = start('night-station');
  assert.equal(second.status, 0, second.stderr);
  const two = kept();
  assert.deepEqual(Object.keys(two), ['part1.events.jsonl', 'part2.events.jsonl', 'usage-part1.jsonl', 'usage-part2.jsonl', 'world.json']);
  for (const name of Object.keys(one)) assert.equal(two[name], one[name], name);
  assert.ok(rows('part2.events.jsonl')[0].at >= rows('part1.events.jsonl').at(-1).at);

  // Another world file is refused in a sentence, and so is a state file beside a run directory: nothing is added.
  const other = start('night-pass');
  assert.equal(other.status, 1);
  assert.match(other.stderr, /^failed: The run directory keeps another world file than this one/);
  const both = start('night-station', '--state', join(dir, 'other.sqlite'));
  assert.equal(both.status, 1);
  assert.match(both.stderr, /^failed: `--state` and `--run` cannot be given together/);
  assert.deepEqual(kept(), two);
  for (const run of [first, second, other, both]) assert.ok(!run.stderr.includes(NOTE));

  // The lab reads the directory as one world of two stretches, with every request counted once.
  const listed = openLab(dir, { fresh: 0 }).list();
  assert.deepEqual([listed.single, listed.experiments.length, listed.experiments[0].shape, listed.experiments[0].rehearsal, listed.experiments[0].stretches.map(stretch => stretch.name), listed.experiments[0].usage],
    [true, 1, 'world', false, ['part1', 'part2'], { requests: 6, failed: 0, input: 600, cached: 240, output: 60 }]);
  assert.equal(listed.experiments[0].stretches.reduce((sum, stretch) => sum + stretch.events, 0), rows('part1.events.jsonl').length + rows('part2.events.jsonl').length);
});
