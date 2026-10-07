// The lab against small synthetic folders. No browser and no model.
// These are here because the lab serves the text of private stories on a local port: a mistake in the token or in
// the paths shows it to another local user or reads a file outside the roots, a mistake in what is taken of a world
// file or a chapter sends a sheet or a narrator's own thread to the page, and a token in the arguments of a process
// can be read by anyone on the computer.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { openLab } from './data.ts';
import { openInBrowser } from './open.ts';
import { startLab } from './server.ts';

const SECRETS = ['SHEET-NINA', 'FACT-OF-THE-WORLD', 'CARRY-OF-THE-NARRATOR', 'WORDS-OF-THE-SERVICE', 'OUTSIDE-THE-ROOT', 'STATE-FILE'];
const line = (value: object) => `${JSON.stringify(value)}\n`;
const event = (at: number, who: string, text: string, more: object = {}) => line({ at, clock: `13:00:${String(at).padStart(2, '0')}`, kind: 'say', who, place: 'cafe', to: null, text, seconds: 2, cut: false, heard: [], note: null, ...more });
const row = (n: number, more: object = {}) => line({ n, at: '13:00:00', kind: 'turn', who: 'nina', model: 'stand-in', ms: 10, input: 100, cached: 40, output: 10, reasoning: 0, ...more });
const WORLD = JSON.stringify({ title: 'The café', about: 'A café.', facts: 'FACT-OF-THE-WORLD', characters: [{ id: 'nina', name: 'Nina', sheet: 'SHEET-NINA' }, { id: 'oleg', name: 'Oleg', sheet: 'A sheet.' }], places: [{ id: 'cafe', name: 'Café' }] });

// A root with the three shapes among files that are no run, and beside it a directory that no path may reach.
function folders() {
  const top = mkdtempSync(join(tmpdir(), 'sagents-lab-test-')), root = join(top, 'root'), outside = join(top, 'outside');
  for (const dir of [join(root, 'day/kept/story'), join(root, 'day/scenes'), join(root, 'day/old'), join(root, 'node_modules/pack'), join(root, '.hidden'), outside]) mkdirSync(dir, { recursive: true });
  // One world in two stretches, with a chapter.
  writeFileSync(join(root, 'day/kept/world.json'), WORLD);
  writeFileSync(join(root, 'day/kept/part1.events.jsonl'), event(1, 'nina', 'One.') + event(2, 'oleg', 'Two.'));
  writeFileSync(join(root, 'day/kept/part2.events.jsonl'), event(3, 'nina', 'Three.', { touches: [{ of: 'oleg', text: 'a hand' }] }));
  writeFileSync(join(root, 'day/kept/usage-part1.jsonl'), row(1) + row(2, { error: 'WORDS-OF-THE-SERVICE said this', text: 'WORDS-OF-THE-SERVICE' }));
  writeFileSync(join(root, 'day/kept/usage-part2.jsonl'), row(1, { error: 'timeout' }));
  writeFileSync(join(root, 'day/kept/state.sqlite'), 'STATE-FILE');
  writeFileSync(join(root, 'day/kept/story/chapter-01.json'), JSON.stringify({ n: 1, stretches: ['part1'], title: 'Noon', span: 'one o’clock', text: 'They met.', carry: 'CARRY-OF-THE-NARRATOR', model: 'stand-in' }));
  // Two runs and a rehearsal in one directory, with the world file under another name, and scripts beside them.
  writeFileSync(join(root, 'day/scenes/cafe.json'), WORLD);
  writeFileSync(join(root, 'day/scenes/notes.json'), '{"characters": "none"}');
  for (const name of ['a', 'b', 'dry-a']) {
    writeFileSync(join(root, `day/scenes/${name}.events.jsonl`), event(1, 'nina', `Run ${name}.`));
    writeFileSync(join(root, `day/scenes/${name}.usage.jsonl`), row(1, name === 'dry-a' ? { input: 0, cached: 0, output: 0 } : {}));
    writeFileSync(join(root, `day/scenes/${name}.txt`), `13:00:01 [Café] Nina: "Run ${name}."\n`);
    writeFileSync(join(root, `day/scenes/${name}.sqlite`), 'STATE-FILE');
  }
  writeFileSync(join(root, 'day/scenes/run.sh'), 'echo\n');
  // Old runs of which only the transcript is left, and a text that is none.
  writeFileSync(join(root, 'day/old/first-1.txt'), '13:00:01 [Café] Nina: "Old one."\n');
  writeFileSync(join(root, 'day/old/first-2.txt'), '13:10:01 [Café] Nina: "Old two."\n');
  writeFileSync(join(root, 'day/old/first.sqlite'), 'STATE-FILE');
  writeFileSync(join(root, 'day/old/readme.txt'), 'Notes of no run.\n');
  // What the walk passes over, and what no link may lead to.
  for (const dir of ['node_modules/pack', '.hidden']) writeFileSync(join(root, dir, 'x.events.jsonl'), event(1, 'nina', 'Not a run.'));
  writeFileSync(join(outside, 'secret.events.jsonl'), event(1, 'nina', 'OUTSIDE-THE-ROOT'));
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE-THE-ROOT\n');
  writeFileSync(join(outside, 'secret.sqlite'), 'STATE-FILE');
  symlinkSync(outside, join(root, 'day/linked'));
  symlinkSync(join(outside, 'secret.events.jsonl'), join(root, 'day/scenes/c.events.jsonl'));
  symlinkSync(join(outside, 'secret.txt'), join(root, 'day/old/second.txt'));
  writeFileSync(join(root, 'day/old/second.sqlite'), 'STATE-FILE');
  // A world of the root whose `about.txt` and `story` are links to what lies outside it.
  mkdirSync(join(root, 'day/links'));
  mkdirSync(join(outside, 'story'));
  writeFileSync(join(root, 'day/links/world.json'), WORLD);
  writeFileSync(join(root, 'day/links/part1.events.jsonl'), event(1, 'nina', 'Linked.'));
  writeFileSync(join(outside, 'about.txt'), 'OUTSIDE-THE-ROOT\n');
  writeFileSync(join(outside, 'story/chapter-01.json'), JSON.stringify({ n: 1, stretches: ['part1'], title: 'OUTSIDE-THE-ROOT', span: 'noon', text: 'OUTSIDE-THE-ROOT', model: 'stand-in' }));
  symlinkSync(join(outside, 'about.txt'), join(root, 'day/links/about.txt'));
  symlinkSync(join(outside, 'story'), join(root, 'day/links/story'));
  writeFileSync(join(root, 'day/kept/about.txt'), 'A noon at the café.\n');
  return { root, outside };
}
// The first messages of a stream, as text, until its `caught`.
async function streamed(url: string) {
  const response = await fetch(url), reader = response.body!.getReader(), decoder = new TextDecoder();
  let text = '';
  while (!text.includes('event: caught')) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
  await reader.cancel();
  return text;
}

test('the list holds the three shapes, each run of a directory by itself, and nothing from outside the root', () => {
  const { root } = folders(), lab = openLab(root, { fresh: 0 }), listed = lab.list().experiments;
  const said = (id: string) => { const one = listed.find(item => item.id === id)!; return [one.shape, one.group, one.rehearsal, one.stretches.map(stretch => stretch.name), one.texts.map(text => text.name), one.usage.requests]; };
  assert.deepEqual(listed.map(one => one.id).sort(), ['day/kept', 'day/links', 'day/old/first', 'day/scenes/a', 'day/scenes/b', 'day/scenes/dry-a']);
  // An `about.txt` and a `story` of the root are read; those that are links out of it are none.
  const world = (id: string) => { const one = listed.find(item => item.id === id)!; return [one.about, one.story.chapters, lab.story(id)!.chapters.length]; };
  assert.deepEqual([world('day/kept'), world('day/links')], [['A noon at the café.', 1, 1], [null, 0, 0]]);
  assert.deepEqual(said('day/kept'), ['world', 'day', false, ['part1', 'part2'], [], 3]);
  assert.deepEqual(said('day/scenes/a'), ['run', 'day/scenes', false, ['a'], ['a'], 1]);
  assert.deepEqual(said('day/scenes/dry-a'), ['run', 'day/scenes', true, ['dry-a'], ['dry-a'], 1]);
  assert.deepEqual(said('day/old/first'), ['text', 'day/old', false, [], ['first-1', 'first-2'], 0]);
  // A run takes its names from the world file of its directory, and its events are its own alone.
  assert.deepEqual(lab.names('day/scenes/b'), { characters: [{ id: 'nina', name: 'Nina' }, { id: 'oleg', name: 'Oleg' }], places: [{ id: 'cafe', name: 'Café' }] });
  assert.deepEqual(lab.world('day/scenes/b').events.map(one => one.text), ['Run b.']);
  assert.deepEqual(lab.world('day/kept').events.map(one => one.text), ['One.', 'Two.', 'Three.']);
  // A field of another version of the engine stays in the line as it was written.
  assert.match(lab.part('day/kept', 'part2')!.lines[0], /"touches":\[\{"of":"oleg","text":"a hand"\}\]/);
  assert.equal(lab.text('day/old/first', 'first-2')!.text, '13:10:01 [Café] Nina: "Old two."\n');
  assert.equal(lab.text('day/old/first', 'readme'), null);
});

test('the server answers only GET under its token, builds no path from a request and sends no sheet, carry or error text', async () => {
  const { root } = folders(), failures: string[] = [];
  const lab = await startLab({ dirs: root, log: text => failures.push(text) });
  try {
    assert.match(lab.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
    const base = new URL(lab.url), token = base.pathname.slice(1, -1), status = async (path: string, init?: RequestInit) => (await fetch(new URL(path, base.origin), init)).status;
    // Without the token, with another one, beside the known names and by any other method: 404.
    for (const path of ['/', '/list', `/${'0'.repeat(32)}/`, `/${'0'.repeat(32)}/list`, `/${token}`, `/${token}/data.ts`, `/${token}/server.ts`, `/${token}/open.ts`, `/${token}/page.html`, `/${token}/list/`, `/${token}//list`,
      `/${token}/%2e%2e/${token}/list.json`, `/${token.toUpperCase()}/list`]) assert.equal(await status(path), 404, path);
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']) assert.equal(await status(`/${token}/list`, { method }), 404, method);
    for (const path of ['', 'app.js', 'core.js', 'strings.js', 'app.css', 'list']) assert.equal(await status(`/${token}/${path}`), 200, path);
    // A request names an experiment, a stretch and a transcript, and each is looked up among what the walk found:
    // a name that is a path finds nothing, inside the root or outside it.
    const q = (name: string, values: { [key: string]: string }) => `/${token}/${name}?${new URLSearchParams(values)}`;
    for (const path of [q('stretch', { x: 'day/kept', s: '../scenes/a' }), q('stretch', { x: '../outside', s: 'secret' }), q('stretch', { x: 'day/linked/secret', s: 'secret' }), q('stretch', { x: 'day/scenes/c', s: 'c' }),
      q('stretch', { x: 'day/kept', s: 'usage-part1' }), q('text', { x: 'day/old/first', n: '../second' }), q('text', { x: 'day/old/second', n: 'second' }), q('text', { x: 'day/old/first', n: 'readme' }),
      q('text', { x: 'day/kept', n: 'world.json' }), q('text', { x: 'day/kept', n: 'state.sqlite' }), q('story', { x: 'day/kept/story' }), q('story', { x: '..' })]) assert.equal(await status(path), 404, path);
    // Everything the server gives of the root, in one text: no sheet, no fact, no carry, no words of a failure,
    // nothing of a state file and nothing from outside the root.
    const texts = [await (await fetch(new URL(q('list', {}), base.origin))).text(), await (await fetch(new URL(q('story', { x: 'day/kept' }), base.origin))).text(),
      await (await fetch(new URL(q('story', { x: 'day/links' }), base.origin))).text()];
    for (const one of JSON.parse(texts[0]).experiments) {
      texts.push(await streamed(new URL(q('stream', { x: one.id }), base.origin).href));
      for (const stretch of one.stretches) texts.push(await (await fetch(new URL(q('stretch', { x: one.id, s: stretch.name }), base.origin))).text());
      for (const text of one.texts) texts.push(await (await fetch(new URL(q('text', { x: one.id, n: text.name }), base.origin))).text());
    }
    const all = texts.join('\n');
    assert.deepEqual(SECRETS.filter(secret => all.includes(secret)), []);
    // And what should be there is: the names of the world, the chapter, the events, a failure's code that is one.
    for (const wanted of ['"name":"Nina"', '"title":"Noon"', 'They met.', '"text":"Three."', 'Old two.', '"failed":true,"code":"timeout"', '"failed":true,"code":null']) assert.ok(all.includes(wanted), wanted);
    assert.deepEqual(failures, []);
  } finally { await lab.stop(); }
});

test('the browser is handed a file that only the user can read, never the address, and the file goes when the lab stops', () => {
  // The address as the command gives it when a language was chosen: the file leads to the whole of it.
  const url = `http://127.0.0.1:1/${'ab'.repeat(16)}/?lang=ru`, started: string[][] = [];
  const opened = openInBrowser(url, (command, args) => { started.push([command, ...args]); });
  assert.equal(started.length, 1);
  assert.ok(readFileSync(opened.file, 'utf8').includes(`url=${url}"`));
  assert.ok(!started[0].join(' ').includes('ab'.repeat(16)));
  assert.ok(started[0].at(-1)!.endsWith('open.html'));
  assert.equal(statSync(opened.file).mode & 0o777, 0o600);
  assert.equal(statSync(join(opened.file, '..')).mode & 0o777, 0o700);
  opened.remove();
  assert.equal(statSync(opened.file, { throwIfNoEntry: false }), undefined);
  assert.equal(statSync(join(opened.file, '..'), { throwIfNoEntry: false }), undefined);
  // A computer with no command to open a browser is no failure.
  const none = openInBrowser(url, () => { throw Object.assign(new Error('spawn'), { code: 'ENOENT' }); });
  none.remove();
});

test('a retained follower reads no events, usage or names from a path replaced by an outside link', () => {
  const { root, outside } = folders(), lab = openLab(root, { fresh: 60_000 });
  const followed = lab.follow('day/kept', 'part1');
  followed.poll();
  for (const name of ['part1.events.jsonl', 'usage-part1.jsonl', 'world.json']) {
    const path = join(root, 'day/kept', name);
    unlinkSync(path);
    symlinkSync(join(outside, 'secret.events.jsonl'), path);
  }
  assert.ok(!JSON.stringify(followed.poll()).includes('OUTSIDE-THE-ROOT'));
  assert.ok(!JSON.stringify(lab.world('day/kept')).includes('OUTSIDE-THE-ROOT'));
  // A replaced parent directory must not turn the saved event path into an outside path either.
  renameSync(join(root, 'day/scenes'), join(root, 'day/saved'));
  symlinkSync(outside, join(root, 'day/scenes'));
  writeFileSync(join(outside, 'a.events.jsonl'), event(1, 'nina', 'OUTSIDE-THE-ROOT'));
  assert.ok(!JSON.stringify(lab.part('day/scenes/a', 'a')).includes('OUTSIDE-THE-ROOT'));
});
