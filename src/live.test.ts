// The live mode against a scripted stand-in for the model. No network and no sign-in.
// These are here because a mistake in what a character is sent shows it another's secret, a mistake in the clock or
// in the stopping spends the plan on calls nobody asked for, and a mistake around sleep loses what a character knew.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ModelError } from './chatgpt.ts';
import type { Request } from './chatgpt.ts';
import { advance, begin, JournalError, memoryStore, replay } from './journal.ts';
import type { Record } from './journal.ts';
import { INSTRUCTIONS, runLive, WORLD_INSTRUCTIONS } from './live.ts';
import { readWorld } from './laws.ts';
import { readAction } from './action.ts';
import { travelSeconds } from './time.ts';

// Sixty words a minute: one word is one second. Both rooms have a clock, so everyone reads the exact time.
const world = readWorld({ title: 'Two rooms', about: 'A house with two rooms.', clock: '09:00', wordsPerMinute: 60, remote: 'telephone', travelMinutes: 1,
  places: [{ id: 'red', name: 'Red room', about: 'Red walls.', clock: true }, { id: 'blue', name: 'Blue room', about: 'Blue walls.', clock: true }],
  characters: [{ id: 'anna', name: 'Anna', place: 'red', sheet: 'SHEET-ANNA' }, { id: 'boris', name: 'Boris', place: 'red', sheet: 'SHEET-BORIS' },
    { id: 'clara', name: 'Clara', place: 'blue', sheet: 'SHEET-CLARA' }, { id: 'dan', name: 'Dan', place: 'blue', sheet: 'SHEET-DAN' }] });
const act = (action: string, more: object = {}) => JSON.stringify({ action, text: null, to: null, place: null, seconds: null, until: null, note: null, ...more });
// The world's answer to a deed, with every field of its schema.
const came = (more: object = {}) => JSON.stringify({ search: false, finds: [], moves: [], sets: [], poses: [], wakes: [], feels: [], beyond: null, result: null, ...more });
const words = (count: number) => Array.from({ length: count }, (_, index) => `w${index + 1}`).join(' ');
// Each character answers from its own list, then waits; the world answers from the list `world`, then that nothing came
// of the deed. The requests are kept as they were sent, per character.
function standIn(script: { [id: string]: (string | Error)[] }) {
  const sent: { [id: string]: Request[] } = {};
  const respond = async (request: Request) => {
    const id = /\nYou are \w+ \((\w+)\)\.\n/.exec(request.system ?? '')?.[1] ?? 'world';
    (sent[id] ??= []).push(structuredClone(request));
    const answer = script[id]?.shift() ?? (id === 'world' ? came() : act('wait', { seconds: 600 }));
    if (answer instanceof Error) throw answer;
    return { text: answer, usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10, reasoningTokens: 0 } };
  };
  return { sent, respond };
}
const SYSTEM = `${INSTRUCTIONS}

The world: Two rooms
A house with two rooms.

Places:
- Red room (red): Red walls.
- Blue room (blue): Blue walls.

People:
- Anna (anna)
- Boris (boris)
- Clara (clara)
- Dan (dan)

Means of remote contact: telephone.

You are Boris (boris).
SHEET-BORIS`;

test('a character is sent its own sheet and what it perceived, and nothing else', async () => {
  const { sent, respond } = standIn({
    anna: [act('say', { text: 'RED-WORD is here', note: 'NOTE-ANNA' })],
    boris: [act('wait', { seconds: 600 })],
    clara: [act('call', { to: 'anna', text: 'CALL-WORD for you', note: 'NOTE-CLARA' })],
    dan: [act('wait', { seconds: 600 })],
  });
  const outcome = await runLive({ world, respond, model: 'stand-in', minutes: 1 });
  assert.equal(outcome.status, 'done');
  const seen = (id: string) => JSON.stringify(sent[id]);
  // Said in the red room: Boris heard it, the blue room did not. Called from the blue room to Anna: Dan heard Clara's
  // half, Boris heard nothing. A note and a sheet stay with their owner.
  for (const [mark, knowers] of Object.entries({ 'RED-WORD': ['anna', 'boris'], 'CALL-WORD': ['anna', 'clara', 'dan'], 'NOTE-ANNA': ['anna'],
    'NOTE-CLARA': ['clara'], 'SHEET-ANNA': ['anna'], 'SHEET-BORIS': ['boris'], 'SHEET-CLARA': ['clara'], 'SHEET-DAN': ['dan'] })) {
    for (const id of ['anna', 'boris', 'clara', 'dan']) assert.equal(seen(id).includes(mark), knowers.includes(id), `${mark} in the requests of ${id}`);
  }
  // Boris whole, to the letter: his first turn came after Anna's speech, his second after his wait ran out unnoticed.
  const first = `So far:
09:00:00 Anna says: "RED-WORD is here"

Now 09:00:03. You are in Red room (red). Here with you:
- Anna (anna).
You feel rested.
Minutes from here: Blue room (blue) 1.
This turn the \`text\` of a say or a call may hold 57 words at most. 0 min 57 s of the story are left.`;
  assert.equal(sent.boris.length, 1);
  assert.deepEqual(Object.keys(sent.boris[0]).sort(), ['messages', 'model', 'schema', 'system']);
  assert.equal(sent.boris[0].system, SYSTEM);
  assert.deepEqual(sent.boris[0].messages, [{ role: 'user', content: first }]);
  // Anna's second turn is one message again: her own speech and note, then the call as its recipient hears it.
  assert.equal(sent.anna[1].messages.length, 1);
  assert.match(sent.anna[1].messages[0].content,
    /^So far:\n09:00:00 You say: "RED-WORD is here"\n09:00:00 Your note: NOTE-ANNA\n09:00:00 Clara calls you \(telephone\): "CALL-WORD for you"\n\nNow 09:00:03\./);
  assert.match(sent.dan[0].messages[0].content, /^So far:\n09:00:00 Clara calls Anna \(telephone\): "CALL-WORD for you"\n\nNow 09:00:03\./);
});

test('speech takes the time of its words, holds its listeners and is cut at the limit; the horizon and the call limit end the run', async () => {
  const { sent, respond } = standIn({
    anna: [act('say', { text: words(10) }), act('say', { text: words(70) }), 'not an action', act('wait', { seconds: 600 })],
    boris: [act('do', { text: 'reads', seconds: 300 }), act('wait', { seconds: 600 })],
  });
  const journal = memoryStore();
  const outcome = await runLive({ world, respond, model: 'stand-in', minutes: 3, journal });
  const anna = journal.all.map(entry => entry.event).filter(event => event.who === 'anna');
  const boris = journal.all.map(entry => entry.event).filter(event => event.who === 'boris' && event.kind !== 'result');
  // Ten words are ten seconds. Boris, held by them, acts when they end and before Anna, who spoke last.
  assert.deepEqual([anna[0].at, anna[0].seconds, anna[0].cut, anna[0].heard], [0, 10, false, ['boris']]);
  assert.deepEqual([boris[0].kind, boris[0].at], ['do', 10]);
  // Seventy words are cut at sixty-five. They interrupt what Boris was doing and hold him until they end.
  assert.deepEqual([anna[1].at, anna[1].seconds, anna[1].cut, anna[1].text], [10, 65, true, words(65)]);
  assert.deepEqual([boris[1].kind, boris[1].at], ['wait', 75]);
  assert.match(sent.anna[2].messages[0].content, /\n09:00:10 Your speech was longer than the limit: the others heard only its first words\.\n\nNow 09:01:15\./);
  // An answer that cannot be used is a wait of thirty seconds, and the next turn says so and what to do instead.
  assert.deepEqual([anna[2].kind, anna[2].at, anna[2].seconds], ['wait', 75, 30]);
  assert.match(sent.anna[3].messages[0].content, /\n09:01:15 Your answer could not be used and counted as a wait of 30 seconds\. Answer with one JSON object and nothing else, with one of the listed actions\.\n\nNow 09:01:45\./);
  assert.match(sent.anna[3].messages[0].content, /may hold 65 words at most\. 1 min 15 s of the story are left\.$/);
  // Nobody is free before the horizon any more: the run ends without another call.
  assert.deepEqual({ ...outcome, events: journal.all.length },
    { status: 'done', reason: 'horizon', seconds: 180, calls: 9, invalid: 1, overlong: 0, unreported: 0, rewrites: 0, lost: 0, refused: 0, void: 0, inputTokens: 900, cachedInputTokens: 360, outputTokens: 90, events: 9,
      models: { 'stand-in': { calls: 9, invalid: 1, overlong: 0, unreported: 0, inputTokens: 900, cachedInputTokens: 360, outputTokens: 90 } },
      kinds: { turn: { calls: 8, inputTokens: 800, cachedInputTokens: 320, outputTokens: 80 }, memory: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, world: { calls: 1, inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 } } });

  const short = standIn({});
  const few = memoryStore();
  const limited = await runLive({ world, respond: short.respond, model: 'stand-in', minutes: 600, calls: 3, journal: few });
  assert.deepEqual([limited.status, limited.reason, limited.calls, few.all.length], ['done', 'calls', 3, 3]);
  assert.equal(Object.values(short.sent).flat().length, 3);
});

test('a failing connection stops the run at once with the events so far', async () => {
  const { sent, respond } = standIn({ anna: [act('say', { text: 'one two' })], clara: [act('wait', { seconds: 5 })], dan: [new ModelError('budget_exceeded', 429)] });
  const journal = memoryStore();
  const outcome = await runLive({ world, respond, model: 'stand-in', journal });
  assert.deepEqual([outcome.status, outcome.reason, outcome.calls], ['failed', 'budget_exceeded', 2]);
  assert.deepEqual(journal.all.map(({ event }) => `${event.who} ${event.kind}`), ['anna say', 'clara wait']);
  // The call that failed was the last one: nothing was tried again and nobody else was asked.
  assert.equal(Object.values(sent).flat().length, 3);
});

test('a sleeper perceives nothing and wakes with the memory it wrote and the calls that waited; a rewrite that fails twice is lost in the open', async () => {
  const { sent, respond } = standIn({
    anna: [act('say', { text: 'SECRET-WORD before sleep', note: 'NOTE-ANNA' }), act('sleep', { seconds: 600 }), JSON.stringify({ memory: 'LONG-ANNA' })],
    boris: [act('wait', { seconds: 30 }), act('say', { text: 'NIGHT-WORD' })],
    clara: [act('wait', { seconds: 60 }), act('call', { to: 'anna', text: 'WAITING-WORD' })],
    dan: [act('wait', { seconds: 3 }), act('sleep', { seconds: 97 }), 'no memory', JSON.stringify({ memory: ' ' })],
  });
  const journal = memoryStore();
  const outcome = await runLive({ world, respond, model: 'stand-in', minutes: 11, journal, pause: true });
  assert.deepEqual([outcome.status, outcome.rewrites, outcome.lost], ['done', 2, 1]);
  // Boris sees her asleep, and what he says then reaches nobody.
  assert.match(sent.boris[1].messages[0].content, /\n09:00:03 Anna falls asleep\.\n\nNow 09:00:33\. You are in Red room \(red\)\. Here with you:\n- Anna \(anna\), asleep\.\n/);
  assert.deepEqual(journal.all.find(({ event }) => event.text === 'NIGHT-WORD')?.event.heard, []);
  assert.equal(JSON.stringify(sent.anna).includes('NIGHT-WORD'), false);
  // At the waking she writes her memory from everything before the sleep, with her own system text and one field.
  assert.equal(sent.anna[2].system, sent.anna[0].system);
  assert.deepEqual(sent.anna[2].schema, { type: 'object', additionalProperties: false, required: ['memory'], properties: { memory: { type: 'string' } } });
  assert.match(sent.anna[2].messages[0].content,
    /^So far:\n09:00:00 You say: "SECRET-WORD before sleep"\n09:00:00 Your note: NOTE-ANNA\n09:00:03 You lie down to sleep \(600 s\)\.\n\nNow 09:10:03\. This is not a turn/);
  // Her next turn holds that memory, the call that waited and the waking, and none of the lines that were folded.
  assert.deepEqual(sent.anna[3].messages, [{ role: 'user', content: `What you remember:
LONG-ANNA

Since then:
09:01:00 Clara called you (telephone) while you were asleep: "WAITING-WORD"
09:10:03 You wake.

Now 09:10:03. You are in Red room (red). Here with you:
- Boris (boris).
You feel rested.
Minutes from here: Blue room (blue) 1.
This turn the \`text\` of a say or a call may hold 65 words at most.` }]);
  // Dan's two answers could not be used: the journal says the rewrite was lost, and he wakes knowing only that he woke.
  const lost = journal.all.find(({ record }) => record.kind === 'memory' && record.who === 'dan');
  assert.deepEqual([lost?.event.kind, lost?.event.text, sent.dan.length], ['memory', null, 5]);
  assert.match(sent.dan[4].messages[0].content, /^So far:\n09:01:40 You wake\.\n\nNow 09:01:40\./);
});

test('a time of day is the next moment the clock shows it, within the span the action allows, and the journal takes nothing else; without a clock it is missed within bounds and no clock is told', async () => {
  // The clock began at 09:00, so 53,400 seconds on it is 23:50.
  const late = 53_400;
  const read = (more: object, at = late) => {
    const state = begin(world);
    for (const person of state.people) person.freeAt = at;
    const action = readAction(world, state.people[0], act('x', more));
    return typeof action === 'string' ? action : [action.seconds, action.until, advance(world, state, { kind: 'act', who: 'anna', at, limit: 65, action }).seconds];
  };
  // Across midnight, and to the last second of each span; one minute more is refused, and so is the minute it is now.
  assert.deepEqual(read({ action: 'wait', until: '00:10' }), [null, '00:10', 1200]);
  assert.deepEqual(read({ action: 'do', text: 'reads', until: '0:50', seconds: 5 }), [null, '00:50', 3600]);
  assert.equal(read({ action: 'wait', until: '00:51' }), 'time');
  assert.deepEqual(read({ action: 'sleep', until: '11:50' }), [null, '11:50', 43_200]);
  assert.equal(read({ action: 'sleep', until: '11:51' }), 'time');
  assert.equal(read({ action: 'sleep', until: '23:50' }), 'time');
  assert.deepEqual(read({ action: 'wait', until: '23:51' }, late + 59), [null, '23:51', 1]);
  assert.equal(read({ action: 'sleep', until: 'six' }), 'time');
  assert.deepEqual(read({ action: 'sleep', seconds: 43_200 }), [43_200, null, 43_200]);
  assert.equal(read({ action: 'sleep', seconds: 43_201 }), 'time');
  // A record keeps one of the two, and a reason of the list or an action: the journal refuses the rest.
  const wait = { action: 'wait' as const, text: null, to: null, place: null, seconds: 600, until: null, note: null };
  const taken = (action: unknown) => advance(world, begin(world), { kind: 'act', who: 'anna', at: 0, limit: 65, action } as Record);
  assert.equal(taken(wait).seconds, 600);
  assert.equal(taken('here').seconds, 30);
  for (const action of [{ ...wait, until: '10:00' }, 'tired', null]) assert.throws(() => taken(action), JournalError);
  // A walk takes the minutes a pair gives, else the straight line at the world's pace, else the world's minutes.
  const spread = readWorld({ title: 'T', about: 'A.', clock: '09:00', travelMinutes: 7, walkMetresPerMinute: 100, characters: [{ id: 'a', name: 'A', place: 'p', sheet: 'S' }],
    places: [{ id: 'p', name: 'P', about: 'P.', at: [0, 0], minutesTo: { q: 2 } }, { id: 'q', name: 'Q', about: 'Q.', at: [3000, 4000] }, { id: 'r', name: 'R', about: 'R.', at: [30, 40] },
      { id: 's', name: 'S', about: 'S.' }] });
  assert.deepEqual([['q', 'p'], ['q', 'r'], ['p', 'r'], ['s', 'q']].map(([from, to]) => travelSeconds(spread, from, to)), [120, 3000, 30, 420]);
  // With no clock in the rooms only Boris, who has a watch, ends at the minute. Anna is off, within a twentieth of a
  // wait and a tenth of a sleep, and is told the part of the day and never the clock.
  const dark = { ...world, places: world.places.map(place => ({ ...place, clock: false })), characters: world.characters.map(character => ({ ...character, clock: character.id === 'boris' })) };
  const { sent, respond } = standIn({ anna: [act('wait', { until: '09:20' }), act('sleep', { until: '11:00' })], boris: [act('wait', { until: '09:20' })] });
  const journal = memoryStore();
  await runLive({ world: dark, respond, model: 'stand-in', minutes: 200, calls: 8, journal });
  const [waited, slept] = journal.all.filter(entry => entry.event.who === 'anna' && entry.record.kind === 'act').map(entry => entry.event.seconds);
  assert.ok(waited !== 1200 && Math.abs(waited - 1200) <= 60, `a wait of ${waited} s`);
  const whole = 7200 - waited;
  assert.ok(slept !== whole && Math.abs(slept - whole) <= whole / 10, `a sleep of ${slept} s`);
  assert.equal(journal.all.find(entry => entry.event.who === 'boris')!.event.seconds, 1200);
  assert.equal(sent.anna[1].messages[0].content.split('\n').slice(0, 4).join('\n'), `So far:
[morning] You wait (until about 09:20).

Now morning, as far as you can tell: no clock is at hand. You are in Red room (red). Here with you:`);
  assert.match(sent.boris[1].messages[0].content, /^So far:\n09:00:00 You wait \(1200 s\)\.\n09:\d\d:\d\d Anna falls asleep\.\n\nNow 09:20:00\. You are in Red room/);
  assert.doesNotMatch(JSON.stringify(sent.anna), /\d\d:\d\d:\d\d/);
});

test('a character with a model of its own is asked through that connection under that name, for a turn and for a memory alike', async () => {
  const most = standIn({ boris: [act('say', { text: 'hello' })] });
  const hers = standIn({ anna: [act('sleep', { seconds: 5 }), act('wait', { seconds: 1 }), act('sleep', { seconds: 20 }), 'no memory', JSON.stringify({ memory: 'LONG-ANNA' }), act('wait', { seconds: 600 })] });
  const journal = memoryStore();
  const outcome = await runLive({ world, respond: most.respond, model: 'common', cast: { anna: { respond: hers.respond, model: 'own', name: 'api:own' } },
    minutes: 1, journal });
  // Anna's six requests went to her connection and nobody else's did; each carries the model of its connection.
  assert.deepEqual([Object.keys(hers.sent), hers.sent.anna.map(request => request.model)], [['anna'], Array(6).fill('own')]);
  assert.deepEqual(Object.keys(most.sent).sort(), ['boris', 'clara', 'dan']);
  assert.ok(Object.values(most.sent).flat().every(request => request.model === 'common'));
  // The journal says who answered, by the name as it was given, and nobody for a waking; the totals count each name.
  // Her first sleep had nothing before it to remember, so she woke from it without a rewrite and no model was asked.
  assert.deepEqual(journal.all.filter(entry => entry.event.who === 'anna').map(entry => [entry.record.kind, entry.by]),
    [['act', 'api:own'], ['wake', null], ['act', 'api:own'], ['act', 'api:own'], ['memory', 'api:own'], ['wake', null], ['act', 'api:own']]);
  assert.ok(journal.all.filter(entry => entry.event.who !== 'anna').every(entry => entry.by === 'common'));
  assert.deepEqual(outcome.models['api:own'], { calls: 6, invalid: 1, overlong: 0, unreported: 0, inputTokens: 600, cachedInputTokens: 240, outputTokens: 60 });
  assert.equal(outcome.models.common.calls, outcome.calls - 6);
  // An answer cut at the model's limit is a lost turn, and the third in a row of one model ends the run, whatever
  // the other models answered meanwhile.
  const cut = standIn({ anna: Array.from({ length: 5 }, () => new ModelError('output_limit')) });
  const ended = await runLive({ world, respond: standIn({}).respond, model: 'common', cast: { anna: { respond: cut.respond, model: 'own' } }, minutes: 60 });
  assert.deepEqual([ended.status, ended.reason, ended.models.own], ['failed', 'output_limit', { calls: 3, invalid: 3, overlong: 3, unreported: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }]);
});

test('the world answers a deed from facts, bodies, things under labels and the weather, a resident is sent its own, what it sees of those with it and the weather that reaches it, and the answer has one place in the journal', async () => {
  const withFacts = readWorld({ title: 'Two rooms', about: 'A house with two rooms.', facts: 'FACT-WORLD', clock: '09:00', wordsPerMinute: 60, remote: 'telephone', travelMinutes: 1,
    places: [{ id: 'red', name: 'Red room', about: 'Red walls.', facts: 'FACT-RED', clock: true, nextDoor: ['blue'], things: [{ name: 'TABLE-RED', fixed: true, open: true, holds: [{ name: 'KEY-RED', facts: 'FACT-KEY' }] }] },
      { id: 'blue', name: 'Blue yard', about: 'Blue walls.', facts: 'FACT-BLUE', open: true, clock: true, things: [{ name: 'BENCH-BLUE', fixed: true }] }],
    // The second weather does not get under a roof.
    weather: { start: { text: 'SKY-ONE', indoors: 'ROOF-ONE' }, changes: [{ day: 1, at: '09:01', text: 'SKY-TWO', indoors: null }] },
    characters: [{ id: 'anna', name: 'Anna', place: 'red', sheet: 'SHEET-ANNA', facts: 'FACT-ANNA', looks: 'LOOKS-ANNA', pose: 'POSE-ANNA', carries: [{ name: 'COAT-ANNA', holds: [{ name: 'PURSE-ANNA' }] }] },
      { id: 'boris', name: 'Boris', place: 'red', sheet: 'SHEET-BORIS', facts: 'FACT-BORIS', looks: 'LOOKS-BORIS', pose: 'POSE-BORIS', carries: [{ name: 'BAG-BORIS', holds: [{ name: 'COINS-BORIS', n: 9, money: true }] }] },
      { id: 'clara', name: 'Clara', place: 'blue', sheet: 'SHEET-CLARA', looks: 'LOOKS-CLARA', pose: 'POSE-CLARA', carries: [{ name: 'HAT-CLARA' }] },
      { id: 'dan', name: 'Dan', place: 'blue', sheet: 'SHEET-DAN', facts: 'FACT-DAN', looks: 'LOOKS-DAN', pose: 'POSE-DAN', carries: [{ name: 'HAT-DAN' }] }] });
  const { sent, respond } = standIn({
    anna: [act('say', { text: 'SPEECH-WORD', note: 'NOTE-ANNA' }), act('sleep', { seconds: 600 }), JSON.stringify({ memory: 'LONG-ANNA' }), act('wait', { seconds: 50 }),
      act('wait', { seconds: 50 })],
    boris: [act('wait', { seconds: 5 }), act('do', { text: 'shakes Anna', seconds: 10 }), act('go', { place: 'blue' }), act('wait', { seconds: 5 })],
    clara: [act('do', { text: 'opens the window', seconds: 5 })],
    dan: [act('wait', { seconds: 3 })],
    // The second answer names a sleeper of the place, someone awake there and someone elsewhere: only the first is woken.
    // It moves the key from the table to Boris and four of his coins onto the table, and poses someone here and
    // someone elsewhere: the pose elsewhere is dropped. Of what bodies feel, the witness of the first deed and the doer
    // of the second are told theirs; the sleeper the deed wakes and someone elsewhere are told none.
    world: [came({ result: 'COLD-WORD', feels: [{ of: 'dan', text: 'FEEL-DAN' }] }), came({ result: 'RESULT-WORD', beyond: 'BEYOND-WORD', wakes: ['dan', 'boris', 'anna'], moves: [{ what: 't2', n: 1, to: 'boris' }, { what: 't7', n: 4, to: 't1' }],
      poses: [{ of: 'anna', text: 'POSE-NEW' }, { of: 'dan', text: 'POSE-STOLEN' }], feels: [{ of: 'anna', text: 'FEEL-STOLEN' }, { of: 'boris', text: 'FEEL-BORIS' }, { of: 'dan', text: 'FEEL-STOLEN' }] })],
  });
  const journal = memoryStore();
  await runLive({ world: withFacts, respond, model: 'stand-in', minutes: 3, journal, pause: true });
  // The world is sent the facts of the world, the facts and things of the place, all of those in it with what they
  // carry, and the deed; its schema lets it name what is there and nothing else.
  assert.deepEqual(sent.world[1], { model: 'stand-in', system: `${WORLD_INSTRUCTIONS}\n\nThe world: Two rooms\nA house with two rooms.\nFacts: FACT-WORLD`,
    schema: sent.world[1].schema, messages: [{ role: 'user', content: `The place: Red room (red), under a roof. Red walls. Facts: FACT-RED.
Things here:
- t1 TABLE-RED, fixed, open [t2 KEY-RED]
Other places, which nobody reaches by a deed: Blue yard (blue).
Next door:
- Blue yard (blue): Clara (clara), awake; Dan (dan), awake.
The weather outside: SKY-ONE. Under this roof: ROOF-ONE.
Here:
- Anna (anna), asleep. Looks: LOOKS-ANNA. Carries: t4 COAT-ANNA [t5 PURSE-ANNA]. Facts: FACT-ANNA.
- Boris (boris), awake. Looks: LOOKS-BORIS. Pose: POSE-BORIS. Carries: t6 BAG-BORIS [t7 COINS-BORIS ×9]. Facts: FACT-BORIS.
Facts of things:
- t2: FACT-KEY.
Now 09:00:07. Boris does, for 10 s: shakes Anna
What comes of it?` }] });
  const lists = (sent.world[1].schema as { properties: { moves: { items: { properties: { what: object; to: object } } }; wakes: object; feels: { items: { properties: { of: object } } } } }).properties;
  assert.deepEqual([lists.moves.items.properties.what, lists.moves.items.properties.to, lists.wakes, lists.feels.items.properties.of], [{ type: 'string', enum: ['t2', 't4', 't5', 't6', 't7'] },
    { type: 'string', enum: ['anna', 'boris', 'red', 't1', 't4', 't6'] }, { type: 'array', items: { type: 'string', enum: ['anna'] } }, { type: 'string', enum: ['boris'] }]);
  for (const mark of ['SHEET-', 'NOTE-', 'LONG-', 'SPEECH-', 'FEEL-']) assert.equal(JSON.stringify(sent.world).includes(mark), false, `${mark} in the requests to the world`);
  const { world: _, ...residents } = sent;
  // No resident is sent a fact, a label or a thing of a place that nobody moved. It is sent what it carries, with what
  // is inside, and of those in its place the looks, the pose and what they carry, without what is inside: Boris walks
  // from the red room to the blue.
  for (const mark of ['FACT-', 'BENCH-', 'STOLEN']) assert.equal(JSON.stringify(residents).includes(mark), false, `${mark} in a resident's request`);
  assert.doesNotMatch(JSON.stringify(residents), /\bt\d+\b/);
  const marks = (requests: { system?: string; messages: { content: string }[] }[]) =>
    [...new Set(requests.flatMap(request => `${request.system}\n${request.messages[0].content}`.match(/(LOOKS|POSE|COAT|PURSE|BAG|COINS|KEY|HAT)-[A-Z]+/g) ?? []))].sort();
  assert.deepEqual(marks(sent.anna), ['BAG-BORIS', 'COAT-ANNA', 'KEY-RED', 'LOOKS-ANNA', 'LOOKS-BORIS', 'POSE-ANNA', 'POSE-BORIS', 'POSE-NEW', 'PURSE-ANNA']);
  assert.deepEqual(marks(sent.clara), ['BAG-BORIS', 'HAT-CLARA', 'HAT-DAN', 'KEY-RED', 'LOOKS-BORIS', 'LOOKS-CLARA', 'LOOKS-DAN', 'POSE-CLARA', 'POSE-DAN']);
  // What the world moved is where the rules put it, and its pose for someone here took the place of the old one; a walker has no pose.
  assert.match(sent.boris[2].messages[0].content, / Here with you:\n- Anna \(anna\)\. Looks: LOOKS-ANNA\. Pose: POSE-NEW\. Carries: COAT-ANNA\.\nYour pose: POSE-BORIS\. You carry: BAG-BORIS \[COINS-BORIS ×5\]; KEY-RED\.\nThe weather, from under the roof: ROOF-ONE\.\nYou feel rested\.\n/);
  assert.match(sent.boris[3].messages[0].content, /\n- Dan \(dan\)\. Looks: LOOKS-DAN\. Pose: POSE-DAN\. Carries: HAT-DAN\.\nYou carry: BAG-BORIS \[COINS-BORIS ×5\]; KEY-RED\.\nThe weather: SKY-TWO\.\nYou feel rested\.\n/);
  assert.match(sent.boris[0].system ?? '', /\nSHEET-BORIS\nHow you look: LOOKS-BORIS$/);
  // The weather reaches each one as its place gives it. The change at 09:01 is perceived under the open sky, where it
  // ends the waiting, and not under the roof, which it does not get under; the world is told it wherever the deed is.
  assert.match(sent.world[0].messages[0].content, /^The place: Blue yard \(blue\), under the open sky\. Blue walls\. Facts: FACT-BLUE\.\nThings here:\n- t3 BENCH-BLUE, fixed\nOther places, which nobody reaches by a deed: Red room \(red\)\.\nNext door:\n- Red room \(red\): Anna \(anna\), awake; Boris \(boris\), awake\.\nThe weather: SKY-ONE\.\nHere:\n/);
  assert.match(sent.boris[0].messages[0].content, /\nThe weather, from under the roof: ROOF-ONE\.\nYou feel rested\.\nMinutes from here/);
  assert.match(sent.clara[0].messages[0].content, /\nThe weather: SKY-ONE\.\nYou feel rested\.\nMinutes from here/);
  assert.match(sent.clara.at(-1)!.messages[0].content, /\n09:01:00 The weather changes: SKY-TWO\n[^]*\nThe weather: SKY-TWO\.\nYou feel rested\.\nMinutes from here/);
  assert.match(sent.boris[3].messages[0].content, /\nNow 09:01:17\. [^]*\nThe weather: SKY-TWO\.\nYou feel rested\.\nMinutes from here/);
  assert.equal(JSON.stringify([sent.anna, sent.boris.slice(0, 3)]).includes('SKY-'), false);
  assert.equal(JSON.stringify([sent.clara, sent.dan]).includes('ROOF-'), false);
  assert.match(sent.anna.at(-1)!.messages[0].content, /\nNow 09:01:07\. [^]*\nYour pose: POSE-NEW\. You carry: COAT-ANNA \[PURSE-ANNA\]\.\nYou feel rested\.\nMinutes from here/);
  const turned = journal.all.find(({ record }) => record.kind === 'weather')!;
  assert.deepEqual([turned.record, turned.event.heard, turned.by], [{ kind: 'weather', at: 60, n: 1 }, ['clara', 'dan'], null]);
  assert.throws(() => advance(withFacts, begin(withFacts), { kind: 'weather', at: 0, n: 1 }), JournalError);
  assert.throws(() => replay(withFacts, journal.all.filter(({ record }) => record.kind !== 'weather').map((entry, seq) => ({ ...entry, seq }))), JournalError);
  // The doer and a witness read what came of the deed, and after it what the rules say went where; the sleeper it woke reads who woke it and wakes when the deed ends.
  assert.match(sent.boris[2].messages[0].content, /\n09:00:07 You do \(10 s\): shakes Anna\n09:00:07 What came of it: RESULT-WORD\n09:00:07 KEY-RED went from TABLE-RED to Boris\. COINS-BORIS ×4 went from Boris to TABLE-RED\.\n09:00:07 You feel: FEEL-BORIS\n/);
  assert.match(sent.dan[1].messages[0].content, /\n09:00:00 Clara does \(5 s\): opens the window\n09:00:00 What came of what Clara did: COLD-WORD\n09:00:00 You feel: FEEL-DAN\n/);
  // What a body feels is in the requests of its owner and of nobody else.
  assert.deepEqual([sent.anna, sent.boris, sent.clara, sent.dan].map(requests => [...new Set(JSON.stringify(requests).match(/FEEL-[A-Z]+/g))]), [[], ['FEEL-BORIS'], [], ['FEEL-DAN']]);
  assert.match(sent.anna[3].messages[0].content, /\nSince then:\n09:00:17 Boris woke you by this: shakes Anna\n09:00:17 You wake\.\n\nNow 09:00:17\./);
  // What the world says is heard next door is one line for those awake there, whichever of the two places lists the
  // other, and it ends their waiting; nobody in the deed's own place is told it. Everyone is told which places are next door.
  assert.match(sent.dan[2].messages[0].content, /\n09:00:07 From Red room, next door: BEYOND-WORD\n\nNow 09:00:07\./);
  assert.deepEqual([sent.anna, sent.boris, sent.clara, sent.dan].map(requests => JSON.stringify(requests).includes('BEYOND-')), [false, false, true, true]);
  assert.match(sent.dan[0].system ?? '', /\nPlaces:\n- Red room \(red\): Red walls\. Next door: Blue yard\.\n- Blue yard \(blue\): Blue walls\. Next door: Red room\.\n/);
  // The answer is the record right after its deed, and the journal takes it nowhere else and nothing else there.
  const deed = journal.all.findIndex(({ event }) => event.kind === 'do' && event.who === 'boris');
  assert.deepEqual(journal.all[deed + 1].record, { kind: 'result', who: 'boris', at: 7, text: 'RESULT-WORD', wakes: ['anna'], moves: [{ what: 't2', n: 1, to: 'boris' }, { what: 't7', n: 4, to: 't1' }],
    sets: [], poses: [{ of: 'anna', text: 'POSE-NEW' }], feels: [{ of: 'boris', text: 'FEEL-BORIS' }], beyond: 'BEYOND-WORD', search: false, finds: [] });
  // The event holds what the rules made of the moves: a whole thing under its label, and a part of a count as a new record.
  assert.deepEqual(journal.all[deed + 1].event.moved, [{ what: 't2', name: 'KEY-RED', n: null, from: 't1', to: 'boris', as: 't2', stock: false, out: 'TABLE-RED', into: 'Boris' },
    { what: 't7', name: 'COINS-BORIS', n: 4, from: 't6', to: 't1', as: 't10', stock: false, out: 'Boris', into: 'TABLE-RED' }]);
  assert.throws(() => replay(withFacts, journal.all.filter((_entry, index) => index !== deed + 1).map((entry, seq) => ({ ...entry, seq }))), JournalError);
  assert.throws(() => advance(withFacts, begin(withFacts), { kind: 'result', who: 'anna', at: 0, text: null, wakes: [], moves: [], sets: [], poses: [], feels: [], beyond: null, search: false, finds: [] }), JournalError);
  // A person under the id of its place would share one list of things with it, so a world file that gives one is refused.
  assert.throws(() => readWorld({ title: 'T', about: 'A.', clock: '09:00', places: [{ id: 'red', name: 'Red', about: 'Red.' }], characters: [{ id: 'red', name: 'Anna', place: 'red', sheet: 'S' }] }), /`characters\[0\]\.id` repeats an id/);
});
