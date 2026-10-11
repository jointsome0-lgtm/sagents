// The lab against small synthetic folders. No browser and no model.
// These are here because the lab serves the text of private stories on a local port: a mistake in the key, the host or
// the paths shows it to another local user or reads a file outside the roots, a mistake in what is taken of a world
// file or a chapter sends a sheet or a narrator's own thread to the page, and a key in the arguments of a process
// can be read by anyone on the computer. The world file here holds `NOT-FOR-THE-PAGE` in every field that the lab
// does not give out, and where a field that it does give out is of another shape than the engine writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openLab } from './data.ts';
import { openInBrowser } from './open.ts';
import { startLab } from './server.ts';

const NO = 'NOT-FOR-THE-PAGE';
const SECRETS = [NO, 'SHEET-NINA', 'FACT-OF-THE-WORLD', 'CARRY-OF-THE-NARRATOR', 'WORDS-OF-THE-SERVICE', 'OUTSIDE-THE-ROOT', 'STATE-FILE'];
const line = (value: object) => `${JSON.stringify(value)}\n`;
const event = (at: number, who: string, text: string, more: object = {}) => line({ at, clock: `13:00:${String(at).padStart(2, '0')}`, kind: 'say', who, place: 'cafe', to: null, text, seconds: 2, cut: false, heard: [], note: null, ...more });
const row = (n: number, more: object = {}) => line({ n, at: '13:00:00', kind: 'turn', who: 'nina', model: 'stand-in', ms: 10, input: 100, cached: 40, output: 10, reasoning: 0, ...more });
const WORLD = JSON.stringify({ title: 'The café', about: 'A café.', facts: 'FACT-OF-THE-WORLD', clock: '13:00', travelMinutes: 7, walkMetresPerMinute: 70, crowd: NO, looks: NO, things: [{ id: 'cup', name: NO, about: NO, place: 'cafe' }],
  characters: [{ id: 'nina', name: 'Nina', place: 'cafe', sheet: 'SHEET-NINA', memory: NO, looks: NO, facts: [NO], things: [{ id: 'key', name: NO }], at: NO }, { id: 'oleg', name: 'Oleg', place: NO, sheet: 'A sheet.' }],
  places: [{ id: 'cafe', name: 'Café', about: 'Tables.', at: [0, 0], open: false, minutesTo: { beach: 3, [NO]: 4, cafe: NO }, nextDoor: ['beach', NO], figures: [{ id: 'raya', name: 'Raya', looks: NO, sheet: NO, facts: [NO] }],
    looks: NO, facts: [NO], things: [{ id: 'jar', name: NO }], crowd: NO, sounds: NO },
  { id: 'beach', name: 'Beach', about: 'Sand.', at: [NO, 0], open: true, minutesTo: NO, nextDoor: NO, figures: NO }] });
// What the lab gives of that file for the map, whole.
const MAP = { travelMinutes: 7, walkMetresPerMinute: 70,
  places: [{ id: 'cafe', name: 'Café', about: 'Tables.', at: [0, 0], minutesTo: { beach: 3 }, nextDoor: ['beach'], open: false, figures: [{ id: 'raya', name: 'Raya' }] },
    { id: 'beach', name: 'Beach', about: 'Sand.', at: null, minutesTo: {}, nextDoor: [], open: true, figures: [] }],
  characters: [{ id: 'nina', name: 'Nina', place: 'cafe' }, { id: 'oleg', name: 'Oleg', place: null }] };

// A root with the three shapes among files that are no run, and beside it a directory that no path may reach.
function folders() {
  const top = mkdtempSync(join(tmpdir(), 'sagents-lab-test-')), root = join(top, 'root'), outside = join(top, 'outside');
  for (const dir of [join(root, 'day/kept/story'), join(root, 'day/scenes'), join(root, 'day/old'), join(root, 'node_modules/pack'), join(root, '.hidden'), outside]) mkdirSync(dir, { recursive: true });
  // One world in two stretches, with a chapter.
  writeFileSync(join(root, 'day/kept/world.json'), WORLD);
  writeFileSync(join(root, 'day/kept/part1.events.jsonl'), event(1, 'nina', 'One.') + event(2, 'oleg', 'Two.'));
  writeFileSync(join(root, 'day/kept/part2.events.jsonl'), event(3, 'nina', 'Three.', { touches: [{ of: 'oleg', text: 'a hand' }] })
    + event(4, 'nina', 'Going.', { kind: 'go', to: 'beach', seconds: 1, note: 'Private move note.', extra: 'Private move field.' })
    + event(5, 'nina', 'Sleeping.', { kind: 'sleep', place: 'beach', seconds: 60, note: 'Private sleep note.', extra: 'Private sleep field.' }));
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
  assert.deepEqual(lab.names('day/scenes/b'), { characters: [{ id: 'nina', name: 'Nina' }, { id: 'oleg', name: 'Oleg' }], places: [{ id: 'cafe', name: 'Café' }, { id: 'beach', name: 'Beach' }] });
  // For the map there leave of a world file the fields that README lists and no other, and with them where the
  // events put everyone; an experiment without a world file has no map.
  assert.deepEqual(lab.map('day/kept')!.world, MAP);
  assert.deepEqual(lab.map('day/kept')!.stretches.map(stretch => [stretch.name, stretch.moves.map(move => Object.entries(move).join(' '))]),
    [['part1', ['T,46801 who,nina kind,at place,cafe', 'T,46802 who,oleg kind,at place,cafe']],
      ['part2', ['T,46803 who,nina kind,at place,cafe', 'T,46804 who,nina kind,go place,cafe to,beach seconds,1', 'T,46805 who,nina kind,sleep place,beach seconds,60']]]);
  assert.deepEqual([listed.find(one => one.id === 'day/kept')!.map, listed.find(one => one.id === 'day/old/first')!.map, lab.map('day/old/first'), lab.map('day/kept/world.json'), lab.map('../outside')], [true, false, null, null, null]);
  assert.deepEqual(lab.world('day/scenes/b').events.map(one => one.text), ['Run b.']);
  assert.deepEqual(lab.world('day/kept').events.map(one => one.text), ['One.', 'Two.', 'Three.', 'Going.', 'Sleeping.']);
  // A field of another version of the engine stays in the line as it was written.
  assert.match(lab.part('day/kept', 'part2')!.lines[0], /"touches":\[\{"of":"oleg","text":"a hand"\}\]/);
  assert.equal(lab.text('day/old/first', 'first-2')!.text, '13:10:01 [Café] Nina: "Old two."\n');
  assert.equal(lab.text('day/old/first', 'readme'), null);
});

test('the server gives data only to GET with its key and its own host, builds no path from a request and sends no sheet, carry or error text', async () => {
  const { root } = folders(), failures: string[] = [];
  const lab = await startLab({ dirs: root, port: 0, log: text => failures.push(text) });
  try {
    assert.match(lab.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.match(lab.key, /^[0-9a-f]{32}$/);
    const base = new URL(lab.url), key = lab.key, keyed = { 'X-Lab-Key': key };
    // One request as a browser or another program of this computer may send it, with a `Host` of the test's choice.
    const got = (path: string, headers: { [name: string]: string } = {}, method = 'GET') => new Promise<{ status: number; location: string | undefined; text: string }>((done, failed) => {
      const sent = request({ host: '127.0.0.1', port: lab.port, path, method, headers, agent: false }, answer => {
        const chunks: Buffer[] = [];
        answer.on('data', chunk => { chunks.push(chunk); if (path.startsWith('/data/stream') && answer.statusCode === 200 && Buffer.concat(chunks).includes('event: caught')) answer.destroy(); });
        answer.on('close', () => done({ status: answer.statusCode ?? 0, location: answer.headers.location, text: Buffer.concat(chunks).toString('utf8') }));
      });
      sent.on('error', failed);
      sent.end();
    });
    const status = async (path: string, headers?: { [name: string]: string }, method?: string) => (await got(path, headers, method)).status;
    const DATA = ['list', 'stretch?x=day/kept&s=part1', 'story?x=day/kept', 'text?x=day/old/first&n=first-1', 'map?x=day/kept', 'stream?x=day/kept'];
    // Every answer that holds data, with the key: there. Without it, with another one, with the key where it is not
    // looked for, by any other method, and with the key under any host but the lab's own: 404.
    for (const name of DATA) {
      assert.equal(await status(`/data/${name}`, keyed), 200, name);
      assert.equal(await status(`/data/${name}`), 404, name);
      for (const headers of [{ 'X-Lab-Key': '0'.repeat(32) }, { 'X-Lab-Key': key.toUpperCase() }, { 'X-Lab-Key': key.slice(1) }, { 'X-Lab-Key': `${key}0` }, { Cookie: `key=${key}` }, { Authorization: `Bearer ${key}` },
        { ...keyed, Host: `localhost:${lab.port}` }, { ...keyed, Host: `example.com:${lab.port}` }, { ...keyed, Host: '127.0.0.1' }, { ...keyed, Host: `127.0.0.1:${lab.port + 1}` }, { ...keyed, Host: `127.0.0.1.example.com:${lab.port}` }] as { [name: string]: string }[])
        assert.equal(await status(`/data/${name}`, headers), 404, `${name} ${JSON.stringify(headers).replaceAll(key, 'KEY')}`);
      for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']) assert.equal(await status(`/data/${name}`, keyed, method), 404, `${method} ${name}`);
    }
    // The feed alone takes the key in its query; nothing else does.
    assert.equal(await status(`/data/stream?x=day/kept&key=${key}`), 200);
    assert.equal(await status(`/data/stream?x=day/kept&key=${'0'.repeat(32)}`), 404);
    assert.equal(await status(`/data/stream?x=day/kept&key=${key}`, { Host: `example.com:${lab.port}` }), 404);
    assert.equal(await status(`/data/list?key=${key}`), 404);
    // Beside the known names, with the key: 404.
    for (const path of ['/list', `/${key}/`, `/${key}/list`, '/data', '/data/', '/data/list/', '/data//list', '/data/data.ts', '/data.ts', '/server.ts', '/open.ts', '/page.html', '/view', '/view/', '/data/%2e%2e/list', '/lab/app.js'])
      assert.equal(await status(path, keyed), 404, path);
    // The page and its files need no key and hold nothing of the root: no name of an experiment, a stretch, a
    // character or a place, and no word of an event. Under `localhost` they are sent on to the one host, and under
    // any other host there is nothing.
    const PAGE = ['/', '/view/day/kept', '/view/day/kept?stretch=part2&moment=13:00:03', '/app.js', '/core.js', '/map.js', '/strings.js', '/app.css'];
    for (const path of PAGE) {
      const answer = await got(path);
      assert.equal(answer.status, 200, path);
      assert.deepEqual(['day/scenes', 'first-2', 'dry-a', 'Nina', 'Café', 'Three.', 'They met.', key, ...SECRETS].filter(word => answer.text.includes(word)), [], path);
      assert.deepEqual([(await got(path, { Host: `localhost:${lab.port}` })).status, (await got(path, { Host: `localhost:${lab.port}` })).location], [302, `${base.origin}${path}`], path);
      for (const host of [`example.com:${lab.port}`, 'localhost', `127.0.0.1:${lab.port + 1}`]) assert.equal(await status(path, { Host: host }), 404, `${path} ${host}`);
      assert.equal(await status(path, {}, 'POST'), 404, path);
    }
    // A request names an experiment, a stretch and a transcript, and each is looked up among what the walk found:
    // a name that is a path finds nothing, inside the root or outside it.
    const q = (name: string, values: { [key: string]: string }) => `/data/${name}?${new URLSearchParams(values)}`;
    for (const path of [q('stretch', { x: 'day/kept', s: '../scenes/a' }), q('stretch', { x: '../outside', s: 'secret' }), q('stretch', { x: 'day/linked/secret', s: 'secret' }), q('stretch', { x: 'day/scenes/c', s: 'c' }),
      q('stretch', { x: 'day/kept', s: 'usage-part1' }), q('text', { x: 'day/old/first', n: '../second' }), q('text', { x: 'day/old/second', n: 'second' }), q('text', { x: 'day/old/first', n: 'readme' }),
      q('text', { x: 'day/kept', n: 'world.json' }), q('text', { x: 'day/kept', n: 'state.sqlite' }), q('story', { x: 'day/kept/story' }), q('story', { x: '..' }),
      q('map', { x: 'day/old/first' }), q('map', { x: 'day/kept/world.json' }), q('map', { x: '../outside' }), q('map', {})]) assert.equal(await status(path, keyed), 404, path);
    // Everything the server gives of the root, in one text: no sheet, no fact, no carry, no words of a failure,
    // nothing of a state file and nothing from outside the root.
    const text = async (path: string) => (await got(path, keyed)).text;
    const texts = [await text(q('list', {})), await text(q('story', { x: 'day/kept' })), await text(q('story', { x: 'day/links' }))];
    for (const one of JSON.parse(texts[0]).experiments) {
      if (one.map) texts.push(await text(q('map', { x: one.id })));
      texts.push(await text(q('stream', { x: one.id })));
      for (const stretch of one.stretches) texts.push(await text(q('stretch', { x: one.id, s: stretch.name })));
      for (const transcript of one.texts) texts.push(await text(q('text', { x: one.id, n: transcript.name })));
    }
    const all = texts.join('\n');
    assert.deepEqual(SECRETS.filter(secret => all.includes(secret)), []);
    // And what should be there is: the names of the world, the chapter, the events, a failure's code that is one.
    for (const wanted of ['"name":"Nina"', '"about":"Tables."', '"minutesTo":{"beach":3}', '"kind":"at","place":"cafe"', '"title":"Noon"', 'They met.', '"text":"Three."', 'Old two.', '"failed":true,"code":"timeout"', '"failed":true,"code":null']) assert.ok(all.includes(wanted), wanted);
    assert.deepEqual(failures, []);
  } finally { await lab.stop(); }
});

test('the browser is handed a file that only the user can read, never the address, and the file goes when the lab stops', async () => {
  // The first address as the command gives it when a language was chosen: the file leads to the whole of it.
  const url = `http://127.0.0.1:1/?language=ru#key=${'ab'.repeat(16)}`, started: string[][] = [];
  const opened = openInBrowser(url, (command, args) => { started.push([command, ...args]); });
  assert.equal(started.length, 1);
  assert.equal(await opened.handed, true);
  assert.ok(readFileSync(opened.file, 'utf8').includes(`url=${url}"`));
  assert.ok(!started[0].join(' ').includes('ab'.repeat(16)));
  assert.ok(started[0].at(-1)!.endsWith('open.html'));
  assert.equal(statSync(opened.file).mode & 0o777, 0o600);
  assert.equal(statSync(join(opened.file, '..')).mode & 0o777, 0o700);
  opened.remove();
  assert.equal(statSync(opened.file, { throwIfNoEntry: false }), undefined);
  assert.equal(statSync(join(opened.file, '..'), { throwIfNoEntry: false }), undefined);
  // A computer with no command to open a browser is no failure, and the caller is told, to print the key.
  const none = openInBrowser(url, () => { throw Object.assign(new Error('spawn'), { code: 'ENOENT' }); });
  assert.equal(await none.handed, false);
  none.remove();
  const { root } = folders(), bin = mkdtempSync(join(tmpdir(), 'sagents-opener-')), capture = join(bin, 'args');
  try {
    for (const code of [0, 1]) {
      for (const name of ['xdg-open', 'open']) writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$@" > '${capture}'\nexit ${code}\n`, { mode: 0o700 });
      const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'lab', root, '--port', '0', '--lang', 'en'],
        { env: { ...process.env, PATH: bin }, stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = once(child, 'exit'), timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      try {
        const printed = await new Promise<string>((done, failed) => {
          child.once('error', failed);
          child.once('exit', () => failed(new Error('lab exited before printing its address')));
          child.stdout.once('data', chunk => done(String(chunk).trim()));
        });
        assert.equal(printed.includes('#key='), code !== 0);
        const file = fileURLToPath(readFileSync(capture, 'utf8').trim());
        assert.equal(statSync(file, { throwIfNoEntry: false }) !== undefined, code === 0);
        child.kill('SIGTERM');
        assert.deepEqual(await exited, [0, null]);
        assert.equal(statSync(file, { throwIfNoEntry: false }), undefined);
        assert.equal(statSync(join(file, '..'), { throwIfNoEntry: false }), undefined);
      } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } }
    }
  } finally { rmSync(bin, { recursive: true, force: true }); }
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
