// The guard of the live world's rules: a world of thirty people is played for thousands of steps by a stand-in whose
// answer is a function of the request, and then the journal alone is checked against what must hold whatever a model
// answers. It is here because a broken rule shows one character another's life, or loses a memory, without any error.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Request } from './chatgpt.ts';
import { JournalError, memoryStore, replay, StateError } from './journal.ts';
import type { Entry } from './journal.ts';
import { requestLimit, runLive } from './live.ts';
import { openState } from './state.ts';
import { readWorld, sizeOf } from './world.ts';

const PLACES = 6, PEOPLE = 30;
const source = JSON.stringify({ title: 'Town', about: 'A small town.', clock: '20:00', remote: 'radio', travelMinutes: 3, shortWords: 300, longWords: 60,
  places: Array.from({ length: PLACES }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, about: 'A place.', minutesTo: index ? { p0: index } : {} })),
  characters: Array.from({ length: PEOPLE }, (_, index) => ({ id: `c${index}`, name: `Person ${index}`, place: `p${index % PLACES}`, sheet: `Sheet ${index}.` })) });
const world = readWorld(JSON.parse(source));

// The same request always gets the same answer, so the same world always gets the same journal. The answers are of
// every kind, the unusable and the oversized among them.
function standIn() {
  const seen = { largest: 0 };
  const respond = async (request: Request) => {
    const body = `${request.system}${request.messages.map(message => message.content).join('')}`;
    seen.largest = Math.max(seen.largest, body.length);
    let seed = 2166136261;
    for (let index = 0; index < body.length; index += 1) seed = Math.imul(seed ^ body.charCodeAt(index), 16777619) >>> 0;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const upTo = (most: number) => 1 + Math.floor(random() * most);
    const words = (count: number) => Array.from({ length: count }, () => `w${upTo(999)}`).join(' ');
    const roll = random();
    let answer: unknown;
    if ('memory' in (request.schema as { properties: object }).properties) {
      answer = roll < 0.08 ? { memory: '' } : roll < 0.12 ? { memory: 'x'.repeat(5000) } : { memory: words(roll < 0.3 ? 61 + upTo(100) : upTo(60)) };
    } else {
      const none = { text: null, to: null, place: null, seconds: null, note: roll * 1000 % 1 < 0.3 ? words(upTo(90)) : null };
      answer = roll < 0.03 ? 'not an action'
        : roll < 0.4 ? { ...none, action: 'say', text: roll < 0.05 ? 'y'.repeat(3000) : words(upTo(90)) }
          : roll < 0.55 ? { ...none, action: 'call', to: `c${upTo(PEOPLE) - 1}`, text: words(upTo(40)) }
            : roll < 0.7 ? { ...none, action: 'go', place: `p${upTo(PLACES) - 1}` }
              : roll < 0.8 ? { ...none, action: 'do', text: words(upTo(120)), seconds: upTo(600) }
                : roll < 0.92 ? { ...none, action: 'wait', seconds: upTo(300) } : { ...none, action: 'sleep', seconds: upTo(roll < 0.93 ? 43_200 : 1800) };
    }
    return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: null };
  };
  return { seen, respond };
}

test('thousands of steps of any answers leave a journal in which every rule of the world and of memory holds', async () => {
  const { seen, respond } = standIn();
  const journal = memoryStore();
  const whole = await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls: 4000, journal, pause: true });
  assert.deepEqual([whole.status, whole.reason, whole.calls], ['done', 'calls', 4000]);

  const place = new Map(world.characters.map(character => [character.id, character.place]));
  const away = new Map<string, string>(), asleep = new Set<string>(), held = new Map<string, number>(), folded = new Map<string, number>();
  const count = { say: 0, call: 0, waited: 0, go: 0, do: 0, sleep: 0, wake: 0, unusable: 0, cut: 0, memory: 0, memoryCut: 0, memoryLost: 0 };
  let at = 0;
  for (const [index, { seq, record, event }] of journal.all.entries()) {
    const where = `record ${index}`;
    assert.equal(seq, index, where);
    // Time never goes back.
    assert.ok(event.at >= at && event.at === record.at, where);
    at = event.at;
    assert.equal(event.who, record.who, where);
    if (record.kind === 'act') {
      // A traveller or a sleeper takes no action, and nobody acts before a speech they hear or make has ended.
      assert.ok(!away.has(record.who) && !asleep.has(record.who), where);
      assert.ok(record.at >= (held.get(record.who) ?? 0), where);
      if (!record.action) count.unusable += 1;
    }
    for (const id of event.heard) {
      // Nobody perceives what happened in another place, except the one called; a traveller or a sleeper perceives nothing.
      assert.ok(id !== event.who && !away.has(id) && !asleep.has(id), where);
      assert.ok(place.get(id) === event.place || (event.kind === 'call' && id === event.to), where);
    }
    if (event.kind === 'say' || event.kind === 'call') {
      assert.ok(sizeOf(event.text as string) <= (record.kind === 'act' ? record.limit : 0), where);
      for (const id of [event.who, ...event.heard]) held.set(id, Math.max(held.get(id) ?? 0, event.at + event.seconds));
      count[event.kind] += 1;
      if (event.cut) count.cut += 1;
      if (event.kind === 'call' && !event.heard.includes(event.to as string)) count.waited += 1;
    } else if (event.kind === 'go') {
      away.set(event.who, event.to as string);
      count.go += 1;
    } else if (event.kind === 'arrive') {
      assert.equal(away.get(event.who), event.place, where);
      away.delete(event.who);
      place.set(event.who, event.place);
    } else if (event.kind === 'sleep') {
      asleep.add(event.who);
      count.sleep += 1;
    } else if (event.kind === 'wake') {
      assert.ok(asleep.delete(event.who), where);
      count.wake += 1;
    } else if (event.kind === 'memory' && record.kind === 'memory') {
      // A long-term text never exceeds its limit, and the folded position only moves on.
      assert.ok(record.text === null || sizeOf(record.text) <= world.longWords, where);
      assert.ok(record.upTo > (folded.get(record.who) ?? -1) && record.upTo < seq, where);
      folded.set(record.who, record.upTo);
      count.memory += 1;
      if (record.cut) count.memoryCut += 1;
      if (record.text === null) count.memoryLost += 1;
    } else if (event.kind === 'do') count.do += 1;
  }
  // The run had all of it in it, or the checks above proved little.
  for (const [kind, times] of Object.entries(count)) assert.ok(times >= 5, `${kind} happened ${times} times`);
  assert.deepEqual([whole.rewrites, whole.lost], [count.memory, count.memoryLost]);
  // No request exceeds the world's fixed bound.
  assert.ok(seen.largest <= requestLimit(world), `a request of ${seen.largest} characters`);

  // Replaying the records gives every event again, and a journal that was touched is refused by name.
  assert.equal(replay(world, journal.all).seq, journal.all.length);
  const touched = (change: (entries: Entry[]) => unknown) => {
    const entries = structuredClone(journal.all.slice(0, 500));
    change(entries);
    return () => replay(world, entries);
  };
  assert.throws(touched(entries => entries[400].event.heard.push('c0', 'c1', 'c2')), JournalError);
  assert.throws(touched(entries => { entries[400].record.at += 1; }), JournalError);
  assert.throws(touched(entries => entries.splice(300, 1)), JournalError);

  // A run stopped and continued from its file, several times, gives the same journal as the one that never stopped.
  const directory = mkdtempSync(join(tmpdir(), 'sagents-test-'));
  try {
    const path = join(directory, 'world.sqlite');
    for (const calls of [300, 1, 250, 349]) {
      const state = openState(path, source);
      try {
        assert.throws(() => openState(path, source), StateError);
        await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls, journal: state, pause: true });
      } finally { state.close(); }
    }
    assert.throws(() => openState(path, `${source} `), StateError);
    const state = openState(path, source);
    try {
      const continued = [...state.entries()];
      assert.ok(continued.length > 800);
      assert.deepEqual(continued, journal.all.slice(0, continued.length));
    } finally { state.close(); }
  } finally { rmSync(directory, { recursive: true }); }
});
