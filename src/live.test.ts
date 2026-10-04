// The live mode against a scripted stand-in for the model. No network and no sign-in.
// These are here because a mistake in what a character is sent shows it another's secret, and a mistake in the clock or
// in the stopping spends the plan on calls nobody asked for.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ModelError } from './chatgpt.ts';
import type { Request } from './chatgpt.ts';
import { INSTRUCTIONS, runLive } from './live.ts';
import { readWorld } from './world.ts';

// Sixty words a minute: one word is one second.
const world = readWorld({ title: 'Two rooms', about: 'A house with two rooms.', clock: '09:00', wordsPerMinute: 60, remote: 'telephone', travelMinutes: 1,
  places: [{ id: 'red', name: 'Red room', about: 'Red walls.' }, { id: 'blue', name: 'Blue room', about: 'Blue walls.' }],
  characters: [{ id: 'anna', name: 'Anna', place: 'red', sheet: 'SHEET-ANNA' }, { id: 'boris', name: 'Boris', place: 'red', sheet: 'SHEET-BORIS' },
    { id: 'clara', name: 'Clara', place: 'blue', sheet: 'SHEET-CLARA' }, { id: 'dan', name: 'Dan', place: 'blue', sheet: 'SHEET-DAN' }] });
const act = (action: string, more: object = {}) => JSON.stringify({ action, text: null, to: null, place: null, seconds: null, note: null, ...more });
const words = (count: number) => Array.from({ length: count }, (_, index) => `w${index + 1}`).join(' ');
// Each character answers from its own list, then waits. The requests are kept as they were sent, per character.
function standIn(script: { [id: string]: (string | Error)[] }) {
  const sent: { [id: string]: Request[] } = {};
  const respond = async (request: Request) => {
    const id = /\nYou are \w+ \((\w+)\)\.\n/.exec(request.system ?? '')![1];
    (sent[id] ??= []).push(structuredClone(request));
    const answer = script[id]?.shift() ?? act('wait', { seconds: 600 });
    if (answer instanceof Error) throw answer;
    return { text: answer, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 0 } };
  };
  return { sent, respond };
}

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
  const system = `${INSTRUCTIONS}

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
  const first = `Since your last turn:
09:00:00 Anna says: "RED-WORD is here"

Now 09:00:03. You are in Red room (red). Here with you: Anna (anna).
Minutes from here: Blue room (blue) 1.
This turn the \`text\` of a say or a call may hold 57 words at most. 0 min 57 s of the story are left.`;
  assert.equal(sent.boris.length, 1);
  assert.deepEqual(Object.keys(sent.boris[0]).sort(), ['messages', 'model', 'schema', 'system']);
  assert.equal(sent.boris[0].system, system);
  assert.deepEqual(sent.boris[0].messages, [{ role: 'user', content: first }]);
  // Anna's second turn: the call as its recipient hears it, after her own first turn and answer, which are unchanged.
  assert.deepEqual(sent.anna[1].messages.slice(0, 2), [...sent.anna[0].messages, { role: 'assistant', content: act('say', { text: 'RED-WORD is here', note: 'NOTE-ANNA' }) }]);
  assert.match(sent.anna[1].messages[2].content, /^Since your last turn:\n09:00:00 Clara calls you \(telephone\): "CALL-WORD for you"\n\nNow 09:00:03\./);
  assert.match(sent.dan[0].messages[0].content, /^Since your last turn:\n09:00:00 Clara calls Anna \(telephone\): "CALL-WORD for you"\n\nNow 09:00:03\./);
});

test('speech takes the time of its words, holds its listeners and is cut at the limit; the horizon and the call limit end the run', async () => {
  const { sent, respond } = standIn({
    anna: [act('say', { text: words(10) }), act('say', { text: words(70) }), 'not an action', act('wait', { seconds: 600 })],
    boris: [act('do', { text: 'reads', seconds: 300 }), act('wait', { seconds: 600 })],
  });
  const outcome = await runLive({ world, respond, model: 'stand-in', minutes: 3 });
  const anna = outcome.events.filter(event => event.who === 'anna');
  const boris = outcome.events.filter(event => event.who === 'boris');
  // Ten words are ten seconds. Boris, held by them, acts when they end and before Anna, who spoke last.
  assert.deepEqual([anna[0].at, anna[0].seconds, anna[0].cut, anna[0].heard], [0, 10, false, ['boris']]);
  assert.deepEqual([boris[0].kind, boris[0].at], ['do', 10]);
  // Seventy words are cut at sixty-five. They interrupt what Boris was doing and hold him until they end.
  assert.deepEqual([anna[1].at, anna[1].seconds, anna[1].cut, anna[1].text], [10, 65, true, words(65)]);
  assert.deepEqual([boris[1].kind, boris[1].at], ['wait', 75]);
  assert.match(sent.anna[2].messages[4].content, /^Your last speech was longer than the limit/);
  // An answer that cannot be used is a wait of thirty seconds, and the next turn says so.
  assert.deepEqual([anna[2].kind, anna[2].at, anna[2].seconds], ['wait', 75, 30]);
  assert.match(sent.anna[3].messages[6].content, /^Your last answer could not be used and counted as a wait of 30 seconds\.\n\nNow 09:01:45\./);
  assert.match(sent.anna[3].messages[6].content, /may hold 65 words at most\. 1 min 15 s of the story are left\.$/);
  // Nobody is free before the horizon any more: the run ends without another call.
  assert.deepEqual({ ...outcome, events: outcome.events.length },
    { status: 'done', reason: 'horizon', seconds: 180, calls: 8, invalid: 1, inputTokens: 800, outputTokens: 80, events: 8 });

  const short = standIn({});
  const limited = await runLive({ world, respond: short.respond, model: 'stand-in', minutes: 600, calls: 3 });
  assert.deepEqual([limited.status, limited.reason, limited.calls, limited.events.length], ['done', 'calls', 3, 3]);
  assert.equal(Object.values(short.sent).flat().length, 3);
});

test('a failing connection stops the run at once with the events so far', async () => {
  const { sent, respond } = standIn({ anna: [act('say', { text: 'one two' })], clara: [act('wait', { seconds: 5 })], dan: [new ModelError('budget_exceeded', 429)] });
  const outcome = await runLive({ world, respond, model: 'stand-in' });
  assert.deepEqual([outcome.status, outcome.reason, outcome.calls], ['failed', 'budget_exceeded', 2]);
  assert.deepEqual(outcome.events.map(event => `${event.who} ${event.kind}`), ['anna say', 'clara wait']);
  // The call that failed was the last one: nothing was tried again and nobody else was asked.
  assert.equal(Object.values(sent).flat().length, 3);
});
