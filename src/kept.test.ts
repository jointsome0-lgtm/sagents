// `live --run` through the command itself, with `fetch` replaced before it starts: no network and no sign-in.
// This is here because a kept run is the only record of what a paid run played and spent: a second start that wrote
// over the first, or a row that held a request's text, would lose the one or leak the other unnoticed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { openLab } from '../lab/data.ts';
import { keepRun } from './kept.ts';
import { runLive, WORLD_INSTRUCTIONS } from './live.ts';
import type { Request } from './chatgpt.ts';
import { readWorld } from './laws.ts';
import { JournalError, memoryStore, replay, refused, worldOf } from './journal.ts';
import { readAction, waysOf } from './action.ts';
import { openState, readState } from './state.ts';

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

// These ways must survive every pause, including one before the rules take the go. The café's byte hashes below
// were taken with the same stand-in on HEAD, before ways: a silent change would lose a kept run.
test('ways replay and continue as goes, and a world without ways keeps the requests, events and rows of HEAD', async () => {
  const act = (action: string, more: object = {}) => JSON.stringify({ note: null, action, text: null, to: null, place: null, seconds: null, until: null, ...more });
  const came = (more: object = {}) => JSON.stringify({ search: false, finds: [], moves: [], sets: [], poses: [], wakes: [], feels: [], beyond: null, result: null, ...more });
  const file = { title: 'Ways', about: 'Two places and a car.', clock: '09:00', ways: true, travelMinutes: 1,
    places: [{ id: 'hall', name: 'Hall', about: 'A hall.', clock: true }, { id: 'yard', name: 'Yard', about: 'A yard.', clock: true }],
    vehicles: [{ id: 'car', name: 'Car', about: 'A car.', at: 'hall', faster: 2, seats: 1, drivers: ['ben'] }],
    characters: [{ id: 'ada', name: 'Ada', place: 'hall', sheet: 'S' }, { id: 'ben', name: 'Ben', place: 'hall', sheet: 'S' }] };
  const world = readWorld(file), walk = act('do', { text: 'Walks through the gate', seconds: 10 });
  const schema = (request: Request) => request.schema as { required: string[]; properties: { leads: { enum: string[] } } };
  const standIn = (script: { [id: string]: string[] }) => {
    const sent: { [id: string]: Request[] } = {};
    const respond = async (request: Request) => {
      const id = /\nYou are \w+ \((\w+)\)\.\n/.exec(request.system ?? '')?.[1] ?? 'world';
      (sent[id] ??= []).push(structuredClone(request));
      return { usage: null, text: script[id]?.shift() ?? (id === 'world' ? came({ leads: schema(request).properties.leads.enum[0] }) : act('wait', { seconds: 600 })) };
    };
    return { sent, respond };
  };
  const script = () => standIn({ ada: [walk], world: [came({ leads: 'yard', poses: [{ of: 'ada', text: 'At the gate' }, { of: 'ben', text: 'By the wall' }], result: 'The gate opens.' })] });
  const dir = join(mkdtempSync(join(tmpdir(), 'sagents-ways-')), 'run'), text = JSON.stringify(file);
  const first = script(), kept = keepRun(dir, text);
  let pending;
  try {
    await runLive({ world, ...first, model: 'stand-in', minutes: 0.1, pause: true, journal: kept.state, onEvent: kept.onEvent });
    pending = replay(world, kept.state.entries());
    assert.deepEqual(pending.ways?.get('ada'), { place: 'yard', seq: 1 });
    assert.equal(pending.people[0].pose, null);
    assert.equal(pending.people[1].pose, 'By the wall');
  } finally { kept.close(); }
  const second = standIn({}), continued = keepRun(dir, text);
  let onWay;
  try {
    await runLive({ world, ...second, model: 'stand-in', minutes: 0.5, pause: true, journal: continued.state, onEvent: continued.onEvent });
    onWay = replay(world, continued.state.entries());
    assert.deepEqual([onWay.people[0].place, onWay.people[0].heading, onWay.people[0].freeAt], [null, 'yard', 70]);
    const rows = [...continued.state.entries()], go = rows.find(entry => entry.event.kind === 'go')!;
    assert.deepEqual([go.event.at, go.event.seconds, go.event.fromDeed, go.by], [10, 60, 1, null]);
    assert.equal(go.record.kind === 'act' && go.record.fromDeed, 1);
    assert.match(second.sent.ben[0].messages[0].content, /Ada leaves towards Yard\./);
    assert.equal(second.sent.ada, undefined);
    assert.throws(() => replay(world, rows.map(entry => entry === go ? { ...entry, record: { ...go.record, fromDeed: 2 } } : entry)), JournalError);
    assert.throws(() => replay(world, rows.filter(entry => entry !== go).map((entry, seq) => ({ ...entry, seq }))), JournalError);
  } finally { continued.close(); }
  const third = standIn({}), arrived = keepRun(dir, text);
  let end;
  try {
    await runLive({ world, ...third, model: 'stand-in', minutes: 1, pause: true, journal: arrived.state, onEvent: arrived.onEvent });
    end = replay(world, arrived.state.entries());
    assert.equal(end.people[0].place, 'yard');
    assert.match(third.sent.ada[0].messages[0].content, /You leave towards Yard\.[\s\S]*You arrive in Yard\./);
    assert.deepEqual(replay(world, JSON.parse(JSON.stringify([...arrived.state.entries()]))), end);
    const whole = memoryStore();
    await runLive({ world, ...script(), model: 'stand-in', minutes: 2, pause: true, journal: whole });
    assert.deepEqual(whole.all, [...arrived.state.entries()]);
    assert.deepEqual(replay(world, whole.all), end);
  } finally { arrived.close(); }
  const meta = new DatabaseSync(join(dir, 'state.sqlite'), { readOnly: true });
  try { assert.equal(meta.prepare("SELECT value FROM meta WHERE key = 'format'").get()!.value, '30'); } finally { meta.close(); }
  assert.throws(() => openState(join(dir, 'state.sqlite'), JSON.stringify({ ...file, ways: false })), /another version/);
  assert.equal(openLab(dir, { fresh: 0 }).list().experiments[0].stretches.length, 3);
  assert.ok(readFileSync(join(dir, 'part2.events.jsonl'), 'utf8').includes('"fromDeed":1'));
  assert.equal(readState(join(dir, 'state.sqlite')).entries.length, end.seq);

  const aboard = standIn({ ada: [act('do', { text: 'Gets into the car', seconds: 2 }), act('do', { text: 'Gets out', seconds: 2 })],
    world: [came({ leads: 'car' }), came({ leads: 'hall' })] }), doors = memoryStore();
  await runLive({ world, ...aboard, model: 'stand-in', minutes: 0.5, journal: doors, pause: true });
  assert.deepEqual(doors.all.filter(entry => entry.event.transfer).map(entry => [entry.event.at, entry.event.to, entry.event.seconds]), [[2, 'car', 10], [14, 'hall', 10]]);
  assert.equal(replay(world, doors.all).people[0].place, 'hall');
  assert.deepEqual(schema(first.sent.world[0]).required.slice(0, 2), ['leads', 'search']);
  assert.deepEqual(schema(first.sent.world[0]).properties.leads.enum, ['hall', 'yard', 'car']);
  assert.deepEqual(schema(aboard.sent.world[1]).properties.leads.enum, ['car', 'hall', 'yard']);
  assert.match(aboard.sent.world[1].messages[0].content, /This vehicle stands at Hall \(hall\)\./);
  const paragraph = 'You are told which place this is and which other places there are. A deed never ends in another place by itself: you say in `leads` where the deed takes the one who does it, and the rules do the rest. Mostly it takes them nowhere else, and `leads` is the id of this place. A part of this place that is not one of the other places, such as a room upstairs, a yard or the ground in front of the door, is this place still, and the pose may say where in the place they now are. When the deed is the way to one of the other places, such as setting off for it on foot, climbing the stairs that lead to it, going in or out through its door, getting into a vehicle that stands here or out of the one they are in, or driving off to it, `leads` is the id of that place, however long the way is: the rules then take the one who does the deed there, in the time the way takes, and the result says only what happens here before they leave. A pose never names another place.';
  const point = '- leads: the id of the place where this deed takes the one who does it. The id of this place when it takes them to no other place: they stay in it, in whatever part of it. The id of another place when the deed is their way there, even when the way lasts longer than the deed: name where it leads, and the rules count its time. Inside a vehicle, this place is the vehicle: its own id when they stay in it and it stays where it stands, the id of the place they drive it to, or the id of the place where it stands when they get out. It is for the one who does the deed alone. When the deed heads somewhere that has no id, it is the id of this place, and never the id of some other place. A step towards a door, a look up the stairs, a hand on the gate, a walk about the place: the id of this place.';
  const instructions = first.sent.world[0].system!.split('\n\nThe world:')[0];
  assert.equal(instructions, WORLD_INSTRUCTIONS.replace(WORLD_INSTRUCTIONS.split('\n\n')[3], paragraph).replace('\n- search:', `\n${point}\n- search:`));
  assert.match(first.sent.world[0].messages[0].content, /Other places, which a deed reaches only through `leads`: Yard \(yard\)\./);

  const full = standIn({ ada: [walk], ben: [act('go', { place: 'car' })], world: [came({ leads: 'car' })] }), refusedRun = memoryStore();
  await runLive({ world, ...full, model: 'stand-in', minutes: 1, journal: refusedRun, pause: true });
  assert.equal(replay(world, refusedRun.all).people[0].place, 'hall');
  const refusal = refusedRun.all.find(entry => entry.record.kind === 'act' && entry.record.fromDeed !== undefined)!;
  assert.equal(refusal.record.kind === 'act' && refusal.record.action, 'full');
  assert.equal(refusal.event.kind, 'wait');
  assert.ok(full.sent.ada[1].messages[0].content.includes(refused(world, 'full')));
  assert.deepEqual(schema(full.sent.world[0]).properties.leads.enum, ['hall', 'yard', 'car']);

  const riding = readWorld({ ...file, vehicles: [{ ...file.vehicles[0], seats: 2 }] }), ride = memoryStore();
  const driver = standIn({ ada: [act('do', { text: 'Gets into the car', seconds: 2 }), act('wait', { seconds: 3 }), act('do', { text: 'Looks out', seconds: 2 })],
    ben: [act('go', { place: 'car' }), act('do', { text: 'Drives to the yard', seconds: 2 })],
    world: [came({ leads: 'car' }), came({ leads: 'yard' }), came({ leads: 'car' })] });
  await runLive({ world: riding, ...driver, model: 'stand-in', minutes: 1, journal: ride, pause: true });
  const drive = ride.all.find(entry => entry.event.kind === 'drive')!;
  assert.deepEqual([drive.event.who, drive.event.at, drive.event.arrival, drive.by], ['ben', 12, 42, null]);
  assert.equal(typeof drive.event.fromDeed, 'number');
  assert.deepEqual(schema(driver.sent.world[1]).properties.leads.enum, ['car', 'hall', 'yard']);
  assert.deepEqual(schema(driver.sent.world[2]).properties.leads.enum, ['car']);
  const riders = replay(riding, ride.all);
  assert.deepEqual(riders.people.map(person => person.place), ['car', 'car']);
  assert.equal(riders.places.find(place => place.id === 'car')!.vehicle!.at, 'yard');

  const early = standIn({ ada: [walk], ben: [act('say', { text: 'Stop' })], world: [came({ leads: 'yard' })] }), interrupted = memoryStore();
  await runLive({ world, ...early, model: 'stand-in', minutes: 0.5, journal: interrupted, pause: true });
  assert.equal(interrupted.all.find(entry => entry.event.kind === 'go')!.event.at, 2);
  const touching = readWorld({ ...file, touch: true }), touched = memoryStore();
  await runLive({ world: touching, ...standIn({ ada: [walk], world: [came({ leads: 'yard', touches: [{ of: 'ada', to: 'ben', kind: 'hold', force: 'light', text: 'Hand on the wrist' }] })] }),
    model: 'stand-in', minutes: 0.5, journal: touched, pause: true });
  assert.equal(replay(touching, touched.all.slice(0, 2)).touches.length, 1);
  assert.equal(replay(touching, touched.all).touches.length, 0);

  const plain = readWorld({ ...file, ways: false }), unchanged = memoryStore(), stays = memoryStore();
  const oldRequests = standIn({ ada: [walk], world: [came({ poses: [{ of: 'ada', text: 'At the gate' }] })] });
  const nullRequests = standIn({ ada: [walk], world: [came({ leads: 'hall', poses: [{ of: 'ada', text: 'At the gate' }] })] });
  await runLive({ world: plain, ...oldRequests, model: 'stand-in', minutes: 0.5, journal: unchanged, pause: true });
  await runLive({ world, ...nullRequests, model: 'stand-in', minutes: 0.5, journal: stays, pause: true });
  const withoutGoes = (entries: typeof stays.all) => JSON.parse(JSON.stringify(entries, (key, value) => key === 'goes' ? undefined : value));
  assert.deepEqual(withoutGoes(stays.all), unchanged.all);
  assert.deepEqual(nullRequests.sent.ada, oldRequests.sent.ada);
  assert.deepEqual(nullRequests.sent.ben, oldRequests.sent.ben);
  const { ways, ...same } = replay(world, stays.all);
  assert.equal(ways!.size, 0);
  assert.deepEqual(same, replay(plain, unchanged.all));
  assert.throws(() => readWorld({ ...file, ways: 'true' }), /`ways` must be true or false/);
  const standing = replay(world, []), current = worldOf(world, standing), doer = standing.people[0];
  for (const place of current.places) assert.equal(waysOf(current, standing.people, doer, standing.things).includes(place.id),
    typeof readAction(current, doer, act('go', { place: place.id }), standing.people, standing.things) !== 'string');

  const figures = { ...file, places: [{ ...file.places[0], figures: [{ id: 'clerk', name: 'Clerk', looks: 'A clerk.' }] }, file.places[1]] };
  const figureScript = () => standIn({ ada: [act('say', { to: 'clerk', text: 'Hello' })], world: [JSON.stringify({ reply: 'Hello.', moves: [] })] });
  const wasAsked = figureScript(), isAsked = figureScript();
  await runLive({ world: readWorld({ ...figures, ways: false }), ...wasAsked, model: 'stand-in', minutes: 0.5, pause: true });
  await runLive({ world: readWorld(figures), ...isAsked, model: 'stand-in', minutes: 0.5, pause: true });
  assert.deepEqual(isAsked.sent, wasAsked.sent);
  const combined = JSON.stringify({ ...file, touch: true, marks: true, characters: file.characters.map(person => ({ ...person, traces: [] })) });
  const combinedPath = join(mkdtempSync(join(tmpdir(), 'sagents-ways-format-')), 'state.sqlite');
  openState(combinedPath, combined).close();
  const combinedMeta = new DatabaseSync(combinedPath, { readOnly: true });
  try { assert.equal(combinedMeta.prepare("SELECT value FROM meta WHERE key = 'format'").get()!.value, '30'); } finally { combinedMeta.close(); }

  const cafeText = readFileSync(example('seaside-cafe'), 'utf8'), environment = readFileSync(join(import.meta.dirname, '../environments/sea-summer.json'), 'utf8');
  const cafe = readWorld(JSON.parse(cafeText), JSON.parse(environment)), requests: Request[] = [], events: object[] = [];
  const scripts: { [id: string]: string[] } = { nina: [act('do', { text: 'Looks up the road', seconds: 10 }), act('go', { place: 'beach' }), act('say', { text: 'Here is the water' })],
    oleg: [act('wait', { seconds: 15 }), act('go', { place: 'cafe' }), act('say', { to: 'raya', text: 'Is there coffee?' }), act('do', { text: 'Looks at the counter', seconds: 10 })] };
  let kind: string, who: string | null;
  const respond = async (request: Request) => {
    requests.push(request);
    return { usage: null, text: kind === 'world' ? came({ poses: [{ of: who ?? 'nina', text: 'Stands by the door' }], result: 'The doorway is clear.' })
      : kind === 'reply' ? JSON.stringify({ reply: 'There is coffee.', moves: [] }) : scripts[who!]?.shift() ?? act('wait', { seconds: 600 }) };
  };
  const path = join(mkdtempSync(join(tmpdir(), 'sagents-ways-cafe-')), 'state.sqlite'), journal = openState(path, cafeText, environment);
  try {
    await runLive({ world: cafe, respond, model: 'stand-in', minutes: 8, calls: 24, pause: true, cache: 'stand-in', journal,
      onAsk: (asked, id) => { kind = asked; who = id; }, onEvent: event => { events.push(event); } });
  } finally { journal.close(); }
  const database = new DatabaseSync(path, { readOnly: true }), hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  try {
    const rows = database.prepare('SELECT seq, record, event, by FROM journal ORDER BY seq').all();
    assert.deepEqual([requests.length, events.length, rows.length], [12, 14, 14]);
    assert.equal(hash(requests), '4fc329b2ca7fba582ac69ba2ea12170e8c246c40d25eee2340452587274e5ff0');
    assert.equal(hash(events), '7c2f25055b0ff2406d780463a5e80cf48ec7093d506abc51ab261d44fd866481');
    assert.equal(hash(rows), 'ec80c90403356a6bc9148d02344020221b79a37ffff45eed8b62e5bac86c1057');
    assert.equal(database.prepare("SELECT value FROM meta WHERE key = 'format'").get()!.value, '18');
  } finally { database.close(); }
});
