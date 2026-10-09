// A touch kept as state, against a scripted stand-in for the model. No network and no sign-in.
// These are here because a touch that the rules lose or keep wrongly is told to a model on every turn after, a touch
// told to someone elsewhere shows them what they could not perceive, a request past its bound costs money, and a
// world without the switch must stay the measured one, to the letter. The same holds for a lasting feeling of a body
// kept as state (`marks.ts`), which besides must come back by the clock when it was only eased for a while.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Request } from './chatgpt.ts';
import { JournalError, memoryStore, replay } from './journal.ts';
import { INSTRUCTIONS, requestLimit, runLive, WORLD_INSTRUCTIONS } from './live.ts';
import { readWorld } from './laws.ts';
import { marked, marksAt, MAX_MARKS, readLingers } from './marks.ts';
import { WorldError } from './reading.ts';
import { MAX_TOUCHES } from './touch.ts';

// Sixty words a minute; both rooms have a clock. Four invented adults, three of them in one room.
const file = { title: 'Two rooms', about: 'A house with two rooms.', clock: '09:00', wordsPerMinute: 60, travelMinutes: 1,
  places: [{ id: 'red', name: 'Red room', about: 'Red walls.', clock: true }, { id: 'blue', name: 'Blue room', about: 'Blue walls.', clock: true }],
  characters: [{ id: 'anna', name: 'Anna', place: 'red', sheet: 'SHEET-ANNA' }, { id: 'boris', name: 'Boris', place: 'red', sheet: 'SHEET-BORIS' },
    { id: 'clara', name: 'Clara', place: 'red', sheet: 'SHEET-CLARA' }, { id: 'dan', name: 'Dan', place: 'blue', sheet: 'SHEET-DAN' }] };
const world = readWorld({ ...file, touch: true }), plain = readWorld(file);
const act = (action: string, more: object = {}) => JSON.stringify({ action, text: null, to: null, place: null, seconds: null, until: null, note: null, ...more });
const came = (more: object = {}) => JSON.stringify({ search: false, finds: [], moves: [], sets: [], poses: [], touches: [], wakes: [], feels: [], lingers: [], beyond: null, result: null, ...more });
const wait = act('wait', { seconds: 3600 });
// Each character answers from its own list, then waits; the world answers from the list `world`, then with no touch.
function standIn(script: { [id: string]: string[] }) {
  const sent: { [id: string]: Request[] } = {};
  const respond = async (request: Request) => {
    const id = /\nYou are \w+ \((\w+)\)\.\n/.exec(request.system ?? '')?.[1] ?? 'world';
    (sent[id] ??= []).push(structuredClone(request));
    return { text: script[id]?.shift() ?? (id === 'world' ? came() : wait), usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 0 } };
  };
  return { sent, respond };
}
const told = (request: Request) => request.messages[0].content as string;
const hold = (more: object) => ({ of: 'anna', to: 'boris', kind: 'hold', force: 'firm', text: 'HAND-ON-WRIST', ...more });
// The same house where a lasting feeling of a body is kept and a touch is not: Anna begins with a sunburn.
const sore = { ...file, marks: true, characters: file.characters.map(character => character.id === 'anna'
  ? { ...character, marks: [{ zone: 'shoulders', kind: 'burn', level: 'strong', text: 'SUNBURN-TEXT' }] } : character) };
const burn = (more: object) => ({ of: 'anna', zone: 'shoulders', kind: 'burn', level: 'faint', minutes: 5, text: 'COOL-TEXT', ...more });

test('a touch that an answer began is told to both of the two and to the world, with its time, until an entry changes or ends it; anyone else there sees it without its force', async () => {
  const { sent, respond } = standIn({
    anna: [act('do', { text: 'takes his wrist', seconds: 30 }), act('do', { text: 'grips harder', seconds: 100 }), act('do', { text: 'shifts her hand', seconds: 60 }), act('do', { text: 'lets go', seconds: 5 })],
    clara: [act('do', { text: 'looks on', seconds: 20 })],
    // The first answer also names someone elsewhere, one person twice and a touch that is not there to end: all dropped.
    world: [came({ touches: [hold({}), hold({ of: 'dan' }), hold({ to: 'anna' }), hold({ of: 'boris', to: 'anna', kind: 'none' }), hold({ kind: 'grab' }), hold({ of: 'clara', text: ' ' })] }),
      came(), came({ touches: [hold({ force: 'hard', text: 'FINGERS-ROUND-WRIST' })] }), came({ touches: [hold({ force: 'hard', text: 'PALM-ON-FOREARM' })] }),
      came({ touches: [hold({ kind: 'none' })] })],
  });
  const journal = memoryStore();
  await runLive({ world, respond, model: 'stand-in', minutes: 4, journal, pause: true });
  assert.deepEqual(journal.all.filter(entry => entry.record.kind === 'result').map(entry => entry.event.touches), [
    [{ of: 'anna', to: 'boris', kind: 'hold', force: 'firm', text: 'HAND-ON-WRIST' }], [], [{ of: 'anna', to: 'boris', kind: 'hold', force: 'hard', text: 'FINGERS-ROUND-WRIST' }],
    [{ of: 'anna', to: 'boris', kind: 'hold', force: 'hard', text: 'PALM-ON-FOREARM' }], [{ of: 'anna', to: 'boris', kind: 'none' }]]);
  const lines = (requests: Request[]) => requests.map(request => told(request).split('\n').filter(line => /touch|^- of /i.test(line)));
  // The world: nothing holds at the first deed; the touch lasts through a deed whose answer lists none; a change of
  // force begins its time anew, at the deed that changed it, and a change of the text alone does not.
  assert.deepEqual(lines(sent.world), [['Touches that hold now: none.'], ['Touches that hold now:', '- of anna to boris: hold, firm, for 0 s: HAND-ON-WRIST.'],
    ['Touches that hold now:', '- of anna to boris: hold, firm, for 30 s: HAND-ON-WRIST.'], ['Touches that hold now:', '- of anna to boris: hold, hard, for 100 s: FINGERS-ROUND-WRIST.'],
    ['Touches that hold now:', '- of anna to boris: hold, hard, for 2 min: PALM-ON-FOREARM.']]);
  assert.match(told(sent.world[2]), /\n- Clara \(clara\), awake\.[^\n]*\nTouches that hold now:\n/);
  // The one who touches, turn after turn, and after the end nothing.
  assert.deepEqual(lines(sent.anna), [[], ['You touch Boris (hold, firm, for 30 s): HAND-ON-WRIST.'], ['You touch Boris (hold, hard, for 100 s): FINGERS-ROUND-WRIST.'],
    ['You touch Boris (hold, hard, for 2 min): PALM-ON-FOREARM.'], []]);
  // The one touched and the one who looks on, each at the first turn after the touch began.
  assert.deepEqual(lines(sent.boris), [['Anna touches you (hold, firm, for 0 s): HAND-ON-WRIST.']]);
  assert.deepEqual(lines(sent.clara)[0], ['Anna touches Boris (hold): HAND-ON-WRIST.']);
  assert.ok(!sent.dan.some(request => /WRIST|touches/.test(told(request))));
  // Both texts that a model reads say what the lines are, the world's between the points on `poses` and on `wakes`.
  assert.match(sent.anna[0].system!, /nobody else is told it\. A line `You touch …` or `… touches you` is a touch that holds now/);
  assert.match(sent.world[0].system!, /\n- poses: [^\n]+\n- touches: [^\n]+\n- wakes: /);
  const schema = sent.world[0].schema as { required: string[] };
  assert.deepEqual(schema.required, ['search', 'finds', 'moves', 'sets', 'poses', 'touches', 'wakes', 'feels', 'beyond', 'result']);
});

test('a touch ends for both when either of the two leaves the place', async () => {
  const { sent, respond } = standIn({
    anna: [act('do', { text: 'takes his wrist', seconds: 10 })], boris: [act('wait', { seconds: 5 }), act('go', { place: 'blue' })], clara: [act('go', { place: 'blue' })],
    world: [came({ touches: [hold({}), hold({ of: 'boris', to: 'anna', kind: 'lean', force: 'light', text: 'SHOULDER-ON-SHOULDER' }), hold({ of: 'clara', kind: 'touch', force: 'light', text: 'PALM-ON-BACK' })] })],
  });
  const journal = memoryStore();
  await runLive({ world, respond, model: 'stand-in', minutes: 3, journal, pause: true });
  const touching = (request: Request) => told(request).split('\n').filter(line => /touch/.test(line));
  // Clara, who touched, has left: her touch is gone and the two others hold. Then Boris leaves, and none is left.
  assert.deepEqual(sent.anna.slice(1).map(touching), [['You touch Boris (hold, firm, for 0 s): HAND-ON-WRIST.', 'Boris touches you (lean, light, for 0 s): SHOULDER-ON-SHOULDER.'], []]);
  assert.ok(![...sent.boris.slice(2), ...sent.clara.slice(1), ...sent.dan].some(request => /touch|WRIST|SHOULDER|PALM/.test(told(request))));
  assert.deepEqual(replay(world, journal.all).touches, []);
});

test('a journal with touches replays to the same touches, and is no journal of the world without the switch', async () => {
  const { respond } = standIn({
    anna: [act('do', { text: 'takes his wrist', seconds: 30 }), act('do', { text: 'grips harder', seconds: 100 })],
    world: [came({ touches: [hold({}), hold({ of: 'boris', to: 'clara', kind: 'lean', force: 'light', text: 'SHOULDER-ON-SHOULDER' })] }), came({ touches: [hold({ force: 'hard' })] })],
  });
  const journal = memoryStore();
  await runLive({ world, respond, model: 'stand-in', minutes: 4, journal, pause: true });
  assert.deepEqual(replay(world, journal.all).touches, [{ of: 'anna', to: 'boris', kind: 'hold', force: 'hard', text: 'HAND-ON-WRIST', since: 30 },
    { of: 'boris', to: 'clara', kind: 'lean', force: 'light', text: 'SHOULDER-ON-SHOULDER', since: 0 }]);
  // A record whose touches the rules would not have read so, and the same records under the world with no switch.
  const first = journal.all.findIndex(entry => entry.record.kind === 'result'), forged = structuredClone(journal.all);
  Object.assign(forged[first].record, { touches: [hold({ to: 'anna' })] });
  assert.throws(() => replay(world, forged), JournalError);
  assert.throws(() => replay(plain, journal.all), JournalError);
});

test('a world without the switch is asked and kept as before, whatever an answer holds', async () => {
  const { sent, respond } = standIn({ anna: [act('do', { text: 'takes his wrist', seconds: 30 })], world: [came({ touches: [hold({})], lingers: [burn({})] })] });
  const journal = memoryStore();
  await runLive({ world: plain, respond, model: 'stand-in', minutes: 2, journal, pause: true });
  assert.ok(!/linger|Feelings that last/.test(JSON.stringify([sent, journal.all])));
  // A character begins with marks only in a world file that has the setting.
  assert.throws(() => readWorld({ ...sore, marks: false }), WorldError);
  assert.equal(sent.world[0].system, `${WORLD_INSTRUCTIONS}\n\nThe world: Two rooms\nA house with two rooms.`);
  assert.deepEqual((sent.world[0].schema as { required: string[] }).required, ['search', 'finds', 'moves', 'sets', 'poses', 'wakes', 'feels', 'beyond', 'result']);
  // The published instructions already say that a gesture touches nobody; the whole shared text must stay itself.
  const residents = [...sent.anna, ...sent.boris, ...sent.clara].map(request => {
    assert.ok(request.system!.startsWith(`${INSTRUCTIONS}\n\n`));
    return { ...request, system: request.system!.slice(INSTRUCTIONS.length) };
  });
  assert.ok(!/touch/i.test(JSON.stringify([sent.world[0].schema, told(sent.world[0]), residents])));
  assert.ok(!journal.all.some(entry => 'touches' in entry.record || 'touches' in entry.event));
  assert.deepEqual(replay(plain, journal.all).touches, []);
});

test('a place holds no more touches than its limit, and no request grows by them past what the bound grows by', async () => {
  // Everyone in one room, every one of them touching every other, each text as long as a text may be, for hours.
  const crowded = { ...file, characters: file.characters.map(character => ({ ...character, place: 'red' })) };
  const ids = crowded.characters.map(character => character.id), long = Array.from({ length: 15 }, () => 'x'.repeat(9)).join(' ');
  const all = ids.flatMap(of => ids.filter(to => to !== of).map(to => ({ of, to, kind: 'embrace', force: 'light', text: long })));
  const run = async (given: typeof world) => {
    const { sent, respond } = standIn({ anna: [act('do', { text: 'opens her arms', seconds: 10 }), wait, wait, act('do', { text: 'opens her arms', seconds: 10 })], world: [came({ touches: all })] });
    const journal = memoryStore();
    await runLive({ world: given, respond, model: 'stand-in', minutes: 600, journal, pause: true });
    return { journal, sizes: Object.values(sent).flat().map(request => request.system!.length + told(request).length), sent };
  };
  const on = await run(readWorld({ ...crowded, touch: true })), off = await run(readWorld(crowded));
  assert.equal(replay(readWorld({ ...crowded, touch: true }), on.journal.all).touches.length, MAX_TOUCHES);
  assert.equal(told(on.sent.world[1]).split('\n').filter(line => line.startsWith('- of ')).length, MAX_TOUCHES);
  assert.equal(told(on.sent.dan.at(-1)!).split('\n').filter(line => / touch(es)? /.test(line)).length, MAX_TOUCHES);
  // The same run with and without the switch asks the same requests, one for one: none is larger by more than the bound is.
  const room = requestLimit(readWorld({ ...crowded, touch: true })) - requestLimit(readWorld(crowded));
  assert.equal(on.sizes.length, off.sizes.length);
  assert.ok(on.sizes.every((size, index) => size - off.sizes[index] <= room && size <= requestLimit(readWorld({ ...crowded, touch: true }))));
  assert.ok(on.sizes.some((size, index) => size - off.sizes[index] > MAX_TOUCHES * 150));
});

test('a mark of the world file is told to its owner on every turn and to the world with every deed, and to nobody else; what an entry changes for some minutes comes back by the clock at its second, and `none` ends it', async () => {
  const { sent, respond } = standIn({
    anna: [act('do', { text: 'rubs cream in', seconds: 60 }), act('do', { text: 'pats it', seconds: 30 }), act('wait', { seconds: 269 }), act('wait', { seconds: 1 }), act('wait', { seconds: 40 }),
      act('do', { text: 'washes it off', seconds: 10 })],
    clara: [act('wait', { seconds: 100 })],
    // The first answer also names someone elsewhere, a zone that is none, minutes below and above the bounds, a
    // mark that is not there to end and one with no word: all dropped.
    world: [came({ lingers: [burn({}), burn({ of: 'dan' }), burn({ zone: 'elbow' }), burn({ kind: 'pain', minutes: 0 }), burn({ kind: 'ache', minutes: 2000 }),
      burn({ of: 'boris', level: 'none', minutes: null }), burn({ kind: 'itch', text: ' ' })] }), came(), came({ lingers: [burn({ level: 'none', minutes: null })] })],
  });
  const journal = memoryStore(), given = readWorld(sore);
  await runLive({ world: given, respond, model: 'stand-in', minutes: 8, journal, pause: true });
  assert.deepEqual(journal.all.filter(entry => entry.record.kind === 'result').map(entry => entry.event.lingers), [
    [{ of: 'anna', zone: 'shoulders', kind: 'burn', level: 'faint', minutes: 5, text: 'COOL-TEXT' }], [], [{ of: 'anna', zone: 'shoulders', kind: 'burn', level: 'none', minutes: null, text: '' }]]);
  const lines = (requests: Request[], line: RegExp) => requests.map(request => told(request).split('\n').filter(item => line.test(item)));
  // The owner, at 0, 60, 90 and 359 s, then at 360 s, where the five minutes after the deed of 60 s are over, at
  // 400 s, and after the end.
  const strong = ['Your shoulders (burn, strong): SUNBURN-TEXT.'], faint = ['Your shoulders (burn, faint): COOL-TEXT.'];
  assert.deepEqual(lines(sent.anna, /^Your shoulders/), [strong, faint, faint, faint, strong, strong, []]);
  assert.match(told(sent.anna[0]), /\nYou feel rested\.\nYour shoulders \(burn, strong\): SUNBURN-TEXT\.\nMinutes from here: /);
  // The world, at 0, 60 and 400 s: how long it has been so, and how long is left of what is so only for a while.
  assert.deepEqual(lines(sent.world, /Feelings that last|^- of /), [['Feelings that last now:', '- of anna, shoulders: burn, strong: SUNBURN-TEXT.'],
    ['Feelings that last now:', '- of anna, shoulders: burn, faint, for 60 s, 5 min left: COOL-TEXT.'], ['Feelings that last now:', '- of anna, shoulders: burn, strong, for 40 s: SUNBURN-TEXT.']]);
  // Clara stands by at 0 and at 100 s, Boris at 0 s, Dan is next door: none of them is told anything of it.
  assert.equal(sent.clara.length, 2);
  assert.ok(![...sent.boris, ...sent.clara, ...sent.dan].some(request => /SUNBURN|COOL|shoulders|burn/.test(told(request))));
  assert.deepEqual(replay(given, journal.all).marks, []);
  // Both texts that a model reads say what the lines are, the world's between the points on `feels` and on `beyond`.
  assert.match(sent.anna[0].system!, /nobody else is told it\. A line like `Your back \(burn, strong\): …` is a feeling that stays/);
  assert.match(sent.world[0].system!, /\n- feels: [^\n]+\n- lingers: [^\n]+\n- beyond: /);
  assert.deepEqual((sent.world[0].schema as { required: string[] }).required, ['search', 'finds', 'moves', 'sets', 'poses', 'wakes', 'feels', 'lingers', 'beyond', 'result']);
});

test('what is so for a while lies over what the mark would be then, which may be nothing or a mark that itself ends; what would have run out by then is dropped', () => {
  const toe = (more: object) => ({ of: 'anna', zone: 'feet' as const, kind: 'pain' as const, level: 'clear' as const, minutes: 10 as number | null, text: 'TOE', ...more });
  const now = (marks: ReturnType<typeof marked>, at: number) => marksAt(marks, at).map(mark => [mark.layers[0].level, mark.layers[0].since, mark.layers.length]);
  // A pain for ten minutes after a deed of 20 s, where nothing was, and over it two minutes of ease after a deed at 100 s.
  const stubbed = marked([], [toe({})], 0, 20), eased = marked(stubbed, [toe({ level: 'faint', minutes: 2 })], 100, 100);
  assert.deepEqual([100, 219, 220, 619, 620].map(at => now(eased, at)), [[['faint', 100, 2]], [['faint', 100, 2]], [['clear', 220, 1]], [['clear', 220, 1]], []]);
  // An ease that outlasts the pain leaves nothing under it, and so does being gone for longer than the pain lasts.
  assert.deepEqual(marked(stubbed, [toe({ level: 'faint', minutes: 30 })], 100, 100).map(mark => mark.layers.length), [1]);
  assert.deepEqual(marked(stubbed, [toe({ level: 'none', minutes: 30 })], 100, 100), []);
  // For good, the entry is all there is; gone for a while, it returns; a fourth layer is not taken.
  const lasting = marked(eased, [toe({ level: 'strong', minutes: null })], 150, 150), numbed = marked(lasting, [toe({ level: 'none', minutes: 3 })], 200, 200);
  assert.deepEqual([now(lasting, 10_000), now(numbed, 379), now(numbed, 380)], [[['strong', 150, 1]], [['none', 200, 2]], [['strong', 380, 1]]]);
  const deep = marked(marked(lasting, [toe({ minutes: 30 })], 200, 200), [toe({ level: 'faint', minutes: 20 })], 200, 200);
  assert.deepEqual(readLingers([toe({ level: 'none', minutes: 10 })], ['anna'], deep, 200, 200), []);
  assert.deepEqual(readLingers([toe({ level: 'none', minutes: 20 })], ['anna'], deep, 200, 200), [toe({ level: 'none', minutes: 20, text: '' })]);
});

test('a journal with marks replays to the same marks, and is no journal of the world without the switch', async () => {
  const { respond } = standIn({ anna: [act('do', { text: 'rubs cream in', seconds: 60 })], world: [came({ lingers: [burn({}), burn({ of: 'boris', zone: 'feet', kind: 'pain', level: 'clear', minutes: 2, text: 'TOE' })] })] });
  const journal = memoryStore(), given = readWorld(sore);
  await runLive({ world: given, respond, model: 'stand-in', minutes: 4, journal, pause: true });
  assert.deepEqual(replay(given, journal.all).marks, [{ of: 'anna', zone: 'shoulders', kind: 'burn', layers: [{ level: 'faint', text: 'COOL-TEXT', since: 0, until: 360 }, { level: 'strong', text: 'SUNBURN-TEXT', since: null, until: null }] },
    { of: 'boris', zone: 'feet', kind: 'pain', layers: [{ level: 'clear', text: 'TOE', since: 0, until: 180 }] }]);
  // A record whose entries the rules would not have read so, and the same records under the world with no switch.
  const first = journal.all.findIndex(entry => entry.record.kind === 'result'), forged = structuredClone(journal.all);
  Object.assign(forged[first].record, { lingers: [burn({ minutes: 0 })] });
  assert.throws(() => replay(given, forged), JournalError);
  assert.throws(() => replay(plain, journal.all), JournalError);
});

test('a person has no more marks than the limit, and no request grows by them past what the bound grows by', async () => {
  // Everyone in one room, each with as many marks as a person has, each text as long as a text may be, for hours.
  const long = Array.from({ length: 15 }, () => 'x'.repeat(9)).join(' '), zones = ['head', 'neck', 'chest', 'back', 'arms', 'legs'];
  const crowded = { ...file, characters: file.characters.map(character => ({ ...character, place: 'red' })) };
  const full = readWorld({ ...crowded, marks: true, characters: crowded.characters.map(character => ({ ...character, marks: zones.map(zone => ({ zone, kind: 'ache', level: 'strong', text: long })) })) });
  const run = async (given: typeof world) => {
    // The answer changes every mark of Anna for a while and begins one more for her, which is dropped.
    const { sent, respond } = standIn({ anna: [act('do', { text: 'stretches', seconds: 10 }), wait, wait, act('do', { text: 'stretches', seconds: 10 })],
      world: [came({ lingers: [...zones, 'feet'].map(zone => ({ of: 'anna', zone, kind: 'ache', level: 'clear', minutes: 1440, text: long })) })] });
    const journal = memoryStore();
    await runLive({ world: given, respond, model: 'stand-in', minutes: 600, journal, pause: true });
    return { journal, sizes: Object.values(sent).flat().map(request => request.system!.length + told(request).length), sent };
  };
  const on = await run(full), off = await run(readWorld(crowded));
  assert.equal(replay(full, on.journal.all).marks.length, 4 * MAX_MARKS);
  assert.equal(told(on.sent.world[1]).split('\n').filter(line => line.startsWith('- of ')).length, 4 * MAX_MARKS);
  assert.equal(told(on.sent.anna.at(-1)!).split('\n').filter(line => / \(ache, clear\): /.test(line)).length, MAX_MARKS);
  // The same run with and without the switch asks the same requests, one for one: none is larger by more than the bound is.
  const room = requestLimit(full) - requestLimit(readWorld(crowded));
  assert.equal(on.sizes.length, off.sizes.length);
  assert.ok(on.sizes.every((size, index) => size - off.sizes[index] <= room && size <= requestLimit(full)));
  assert.ok(on.sizes.some((size, index) => size - off.sizes[index] > 4 * MAX_MARKS * 150));
});
