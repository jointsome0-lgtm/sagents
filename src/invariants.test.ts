// The guard of the live world's rules: a world of thirty people is played for thousands of steps by a stand-in whose
// answer is a function of the request, and then the journal alone is checked against what must hold whatever a model
// answers: the laws below. It is here because a broken law shows one character another's life, or loses a memory,
// without any error. README lists the same laws, word for word.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import type { Request } from './chatgpt.ts';
import { JournalError, memoryStore, replay, StateError } from './journal.ts';
import type { Entry } from './journal.ts';
import { requestLimit, runLive } from './live.ts';
import { openState } from './state.ts';
import { readWorld, sizeOf } from './world.ts';

const PLACES = 6, PEOPLE = 30;
const source = JSON.stringify({ title: 'Town', about: 'A small town.', clock: '20:00', remote: 'radio', travelMinutes: 3, shortWords: 300, longWords: 60,
  // Thirteen hours awake at the start, and the limit a quarter of an hour on, so that some reach it.
  dayStart: '07:00', tiredHours: 13.1, spentHours: 13.25,
  places: Array.from({ length: PLACES }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, about: 'A place.', minutesTo: index ? { p0: index } : {} })),
  characters: Array.from({ length: PEOPLE }, (_, index) => ({ id: `c${index}`, name: `Person ${index}`, place: `p${index % PLACES}`, sheet: `Sheet ${index}.` })) });
const world = readWorld(JSON.parse(source));

// The laws of a live world, each one sentence. A run that breaks one fails with that sentence and the record's number.
export const LAWS = {
  time: 'Time never goes back.',
  place: 'Nobody perceives what happened in another place, except the one a call was made to.',
  absent: 'A traveller or a sleeper perceives nothing and takes no action.',
  speech: 'Nobody acts before a speech they are hearing or making has ended.',
  limit: 'A speech never holds more words than its turn allowed.',
  arrival: 'A traveller arrives in the place it set out for.',
  memory: 'A long-term memory never exceeds its limit in words.',
  folded: 'The record up to which a character\'s lines were folded never moves back.',
  request: 'No request to the model exceeds the size fixed by the world file.',
  replay: 'Replaying the records gives every stored event again, and a journal that was changed is refused.',
  resume: 'A run stopped and continued from its file gives the same journal as one that never stopped.',
  deed: 'Every deed is followed by the world\'s answer and by nothing else.',
  waking: 'A sleeper wakes only when its sleep ends or a deed\'s result wakes it.',
  spent: 'Nobody acts after being awake for the world\'s limit: at that turn it falls asleep instead.',
};
const law = (name: keyof typeof LAWS, holds: boolean, record: number) => assert.ok(holds, `Law broken at record ${record}: ${LAWS[name]}`);

// The same request always gets the same answer, so the same world always gets the same journal. The answers are of
// every kind: the oversized, a time of day in place of seconds, and the unusable for each of its reasons.
// `record` says how many records the journal held at a request, so that the largest request can be placed.
function standIn(record: () => number) {
  const seen = { largest: 0, record: 0 };
  const respond = async (request: Request) => {
    const body = `${request.system}${request.messages.map(message => message.content).join('')}`;
    if (body.length > seen.largest) Object.assign(seen, { largest: body.length, record: record() });
    let seed = 2166136261;
    for (let index = 0; index < body.length; index += 1) seed = Math.imul(seed ^ body.charCodeAt(index), 16777619) >>> 0;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const upTo = (most: number) => 1 + Math.floor(random() * most);
    const words = (count: number) => Array.from({ length: count }, () => `w${upTo(999)}`).join(' ');
    const roll = random();
    let answer: unknown;
    if ('result' in (request.schema as { properties: object }).properties) {
      // The world: sometimes no answer, sometimes nothing to notice, and it wakes some of the sleepers and names others.
      const sleepers = [...body.matchAll(/\((c\d+)\), asleep/g)].map(match => match[1]);
      answer = roll < 0.1 ? 'no answer' : { result: roll < 0.4 ? null : words(upTo(90)), wakes: [...sleepers.filter(() => random() < 0.5), `c${upTo(PEOPLE) - 1}`] };
    } else if ('memory' in (request.schema as { properties: object }).properties) {
      answer = roll < 0.08 ? { memory: '' } : roll < 0.12 ? { memory: 'x'.repeat(5000) } : { memory: words(roll < 0.3 ? 61 + upTo(100) : upTo(60)) };
    } else {
      const none = { text: null, to: null, place: null, seconds: null, until: null, note: roll * 1000 % 1 < 0.3 ? words(upTo(90)) : null };
      // A time of day at random: for a wait it is mostly out of reach, for a sleep about half the time.
      const until = `${String(upTo(24) - 1).padStart(2, '0')}:${String(upTo(60) - 1).padStart(2, '0')}`;
      answer = roll < 0.02 ? 'not an action' : roll < 0.03 ? { ...none, action: 'fly' } : roll < 0.04 ? { ...none, action: 'say' }
        : roll < 0.05 ? { ...none, action: 'call', to: 'all', text: 'anyone' } : roll < 0.06 ? { ...none, action: 'go', place: 'gates' }
        : roll < 0.4 ? { ...none, action: 'say', text: roll < 0.08 ? 'y'.repeat(3000) : words(upTo(90)) }
          : roll < 0.55 ? { ...none, action: 'call', to: `c${upTo(PEOPLE) - 1}`, text: words(upTo(40)) }
            : roll < 0.7 ? { ...none, action: 'go', place: `p${upTo(PLACES) - 1}` }
              : roll < 0.8 ? { ...none, action: 'do', text: words(upTo(120)), seconds: upTo(600) }
                : roll < 0.86 ? { ...none, action: 'wait', seconds: upTo(300) }
                  : roll < 0.9 ? { ...none, action: 'wait', until, seconds: 5 }
                    : roll < 0.95 ? { ...none, action: 'sleep', until } : { ...none, action: 'sleep', seconds: upTo(roll < 0.96 ? 43_200 : 1800) };
    }
    return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: null };
  };
  return { seen, respond };
}

test('thousands of steps of any answers leave a journal in which every law of the world holds', async () => {
  const journal = memoryStore();
  const { seen, respond } = standIn(() => journal.all.length);
  const whole = await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls: 4000, journal, pause: true });
  assert.deepEqual([whole.status, whole.reason, whole.calls], ['done', 'calls', 4000]);

  const place = new Map(world.characters.map(character => [character.id, character.place]));
  const away = new Map<string, string>(), asleep = new Set<string>(), held = new Map<string, number>(), folded = new Map<string, number>();
  const count = { say: 0, call: 0, waited: 0, go: 0, do: 0, sleep: 0, wake: 0, until: 0, cut: 0, memory: 0, memoryCut: 0, memoryLost: 0,
    json: 0, action: 0, text: 0, to: 0, here: 0, place: 0, time: 0, result: 0, nothing: 0, woken: 0, spent: 0 };
  const sleepEnds = new Map<string, number>();
  // Each one's sleep debt, counted here from the events alone: one for a second awake, two back for a second asleep.
  const debts = new Map(world.characters.map(character => [character.id, { debt: 13 * 3600, since: 0 }]));
  const debtOf = (id: string, now: number) => { const { debt, since } = debts.get(id)!; return asleep.has(id) ? Math.max(0, debt - 2 * (now - since)) : debt + now - since; };
  const limit = world.spentHours * 3600;
  let at = 0;
  for (const { seq, record, event } of journal.all) {
    law('time', event.at >= at, seq);
    const before = journal.all[seq - 1]?.event;
    law('deed', (before?.kind === 'do') === (record.kind === 'result') && (record.kind !== 'result' || (before.who === record.who && before.at === record.at)), seq);
    if (record.kind === 'result') {
      for (const id of record.wakes) {
        law('waking', asleep.has(id) && place.get(id) === event.place, seq);
        sleepEnds.set(id, Math.min(sleepEnds.get(id)!, before.at + before.seconds));
      }
      count.result += 1;
      count.woken += record.wakes.length;
      if (record.text === null) count.nothing += 1;
    }
    at = event.at;
    if (record.kind === 'spent') count.spent += 1;
    if (record.kind === 'act' || record.kind === 'spent') law('spent', (debtOf(record.who, record.at) >= limit) === (record.kind === 'spent'), seq);
    if (event.kind === 'sleep' || event.kind === 'wake') debts.set(event.who, { debt: debtOf(event.who, event.at), since: event.at });
    if (record.kind === 'act') {
      law('absent', !away.has(record.who) && !asleep.has(record.who), seq);
      law('speech', record.at >= (held.get(record.who) ?? 0), seq);
      if (typeof record.action === 'string') count[record.action] += 1;
      else if (record.action.until !== null) count.until += 1;
    }
    for (const id of event.heard) {
      law('absent', !away.has(id) && !asleep.has(id), seq);
      law('place', id !== event.who && (place.get(id) === event.place || (event.kind === 'call' && id === event.to)), seq);
    }
    if (event.kind === 'say' || event.kind === 'call') {
      law('limit', sizeOf(event.text as string) <= (record.kind === 'act' ? record.limit : 0), seq);
      for (const id of [event.who, ...event.heard]) held.set(id, Math.max(held.get(id) ?? 0, event.at + event.seconds));
      count[event.kind] += 1;
      if (event.cut) count.cut += 1;
      if (event.kind === 'call' && !event.heard.includes(event.to as string)) count.waited += 1;
    } else if (event.kind === 'go') {
      away.set(event.who, event.to as string);
      count.go += 1;
    } else if (event.kind === 'arrive') {
      law('arrival', away.get(event.who) === event.place, seq);
      away.delete(event.who);
      place.set(event.who, event.place);
    } else if (event.kind === 'sleep') {
      asleep.add(event.who);
      sleepEnds.set(event.who, event.at + event.seconds);
      count.sleep += 1;
    } else if (event.kind === 'wake') {
      law('waking', asleep.delete(event.who) && event.at === sleepEnds.get(event.who), seq);
      count.wake += 1;
    } else if (event.kind === 'memory' && record.kind === 'memory') {
      law('memory', record.text === null || sizeOf(record.text) <= world.longWords, seq);
      law('folded', record.upTo > (folded.get(record.who) ?? -1) && record.upTo < seq, seq);
      folded.set(record.who, record.upTo);
      count.memory += 1;
      if (record.cut) count.memoryCut += 1;
      if (record.text === null) count.memoryLost += 1;
    } else if (event.kind === 'do') count.do += 1;
  }
  // The run had all of it in it, or the laws above were tried on little.
  for (const [kind, times] of Object.entries(count)) assert.ok(times >= 5, `${kind} happened ${times} times`);
  assert.deepEqual([whole.rewrites, whole.lost], [count.memory, count.memoryLost]);
  law('request', seen.largest <= requestLimit(world), seen.record);

  // The record a replay refuses, which the journal's own sentence names, or null when it takes them all.
  const refused = (entries: Entry[]) => {
    try { replay(world, entries); } catch (error) {
      if (!(error instanceof JournalError)) throw error;
      return Number(/record (\d+)/.exec(error.message)![1]);
    }
    return null;
  };
  law('replay', refused(journal.all) === null, refused(journal.all) ?? 0);
  const touched = (change: (entries: Entry[]) => unknown) => {
    const entries = structuredClone(journal.all.slice(0, 500));
    change(entries);
    return refused(entries);
  };
  law('replay', touched(entries => entries[400].event.heard.push('c0', 'c1', 'c2')) === 400, 400);
  law('replay', touched(entries => { entries[400].record.at += 1; }) === 400, 400);
  law('replay', touched(entries => entries.splice(300, 1)) === 300, 300);

  const directory = mkdtempSync(join(tmpdir(), 'sagents-test-'));
  try {
    const path = join(directory, 'world.sqlite');
    // Many of the runs are one call long, so that some stop between a deed and the world's answer to it.
    const stops: string[] = [];
    for (const calls of [300, ...Array.from({ length: 40 }, () => 1), 250, 310]) {
      const state = openState(path, source);
      try {
        // Two runs cannot write one file, and a file does not take another world.
        assert.throws(() => openState(path, source), StateError);
        let last = '';
        await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls, journal: state, pause: true, onEvent: event => { last = event.kind; } });
        stops.push(last);
      } finally { state.close(); }
    }
    assert.ok(stops.includes('do'), 'no run stopped between a deed and its result');
    assert.throws(() => openState(path, `${source} `), StateError);
    const state = openState(path, source);
    try {
      const continued = [...state.entries()];
      const differs = continued.findIndex((entry, index) => !isDeepStrictEqual(entry, journal.all[index]));
      law('resume', differs === -1, differs);
      assert.ok(continued.length > 800);
    } finally { state.close(); }
  } finally { rmSync(directory, { recursive: true }); }
});

test('README lists the laws as they are checked here', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  for (const sentence of Object.values(LAWS)) assert.ok(readme.includes(`- ${sentence}`), sentence);
});
