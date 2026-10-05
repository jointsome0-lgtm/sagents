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
import { readWorld } from './laws.ts';
import { clockAt, sizeOf } from './world.ts';

const PLACES = 6, PEOPLE = 30;
// The weather changes every ten minutes of the story, from the fifth on; every third change does not get under a roof.
// Each text is one word that says which state it is of and whether it is the sky's or the roof's.
const SKIES = Array.from({ length: 2000 }, (_, index) => ({ at: 300 + index * 600, text: `sky-${index + 1}-0`, indoors: index % 3 ? `roof-${index + 1}-0` : null }));
const START = 20 * 3600;
const source = JSON.stringify({ title: 'Town', about: 'A small town.', clock: '20:00', remote: 'radio', travelMinutes: 3, shortWords: 300, longWords: 60,
  // Thirteen hours awake at the start, and the limit a quarter of an hour on, so that some reach it.
  tiredHours: 13.1,
  weather: { start: { text: 'sky-0-0', indoors: 'roof-0-0' }, changes: SKIES.map(({ at, text, indoors }) => ({ text, indoors, day: Math.floor((START + at) / 86_400) + 1,
    at: [Math.floor((START + at) % 86_400 / 3600), Math.floor((START + at) / 60) % 60].map(part => String(part).padStart(2, '0')).join(':') })) },
  // Two places of the six have a clock and every fifth person carries one.
  // Every text of a body, of belongings, of things and of facts is one word that names its kind and its owner, so
  // that a request shows whose it holds.
  places: Array.from({ length: PLACES }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, about: 'A place.', minutesTo: index ? { p0: index } : {}, open: index % 2 === 1, clock: index % 3 === 0,
    things: `things-p${index}-0`, facts: `facts-p${index}-0`,
    // Three things are hidden in every place: one that a few minutes of searching find, one that takes half an hour,
    // and one that no search here lasts long enough for.
    hidden: [{ text: `hidden-p${index}-0`, minutes: 3 }, { text: `hidden-p${index}-1`, minutes: 30 }, { text: `hidden-p${index}-2`, minutes: 600 }] })),
  characters: Array.from({ length: PEOPLE }, (_, index) => ({ id: `c${index}`, name: `Person ${index}`, place: `p${index % PLACES}`, sheet: `Sheet ${index}.`,
    facts: `facts-c${index}-0`, looks: `looks-c${index}-0`, pose: `pose-c${index}-0`, holds: `holds-c${index}-0`, ...(index % 4 ? { has: `has-c${index}-0` } : {}), clock: index % 5 === 0 })) });
// The settings of sleep come from an environment, and the world file changes one of them itself.
const ENVIRONMENT = JSON.stringify({ dayStart: '07:00', tiredHours: 2, spentHours: 13.25 });
const world = readWorld(JSON.parse(source), JSON.parse(ENVIRONMENT));

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
  body: 'What a person has, holds and how it is placed, and the things of a place, change only by the world\'s answer to a deed done in that place; a pose is also dropped when its owner leaves.',
  unseen: 'Nobody is sent what another person carries out of sight, what is hidden in a place, or the looks, pose or holdings of a person in another place.',
  found: 'A hidden thing is found only where it lies, by a search of its finder that has lasted its minutes or by a deed the world says went straight to it, and then it is hidden for nobody.',
  weather: 'The weather changes only when and as the world file gives, and whoever is asleep or on the way perceives none of it.',
  clock: 'Nobody is sent the clock of a moment at which it had no clock at hand, its own or its place\'s.',
};
const law = (name: keyof typeof LAWS, holds: boolean, record: number) => assert.ok(holds, `Law broken at record ${record}: ${LAWS[name]}`);

// The same request always gets the same answer, so the same world always gets the same journal. The answers are of
// every kind: the oversized, a time of day in place of seconds, and the unusable for each of its reasons.
// `record` says how many records the journal held at a request, so that the largest request can be placed. While
// `seen.turns` is a list, it gains for every request who was asked, a resident or for the world the deed's place, at
// which record, whether for a turn, and the words of bodies, belongings, things and facts that the request held.
// `sky` holds the words of the weather in the whole request, and `now` those after its history, where a turn says
// the weather of the moment. `clocks` holds every time of the clock in the request, as the engine writes one.
type Asked = { record: number; who: string; turn: boolean; marks: string[]; sky: string[]; now: string[]; clocks: string[] };
const SKY = /\b(?:sky|roof)-\d+-0/g, CLOCK = /(?:day \d+ )?\d\d:\d\d:\d\d/g;
const asker = (request: Request) => /\nYou are Person \d+ \((c\d+)\)\./.exec(request.system!)![1];
const askedOf = (request: Request, record: number, who: string, turn: boolean): Asked => {
  const content = request.messages[0].content, body = `${request.system}${content}`;
  return { record, who, turn, marks: body.match(MARK) ?? [], sky: body.match(SKY) ?? [], now: content.slice(content.lastIndexOf('\nNow ') + 1).match(SKY) ?? [],
    clocks: body.match(CLOCK) ?? [] };
};
const MARK = /\b(?:looks|pose|holds|has|things|facts|hidden)-[cp]\d+-\d+/g;
function standIn(record: () => number) {
  const seen: { largest: number; record: number; turns: Asked[] | null } = { largest: 0, record: 0, turns: [] };
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
      // It changes what it likes of those here and of the place, and names people and places elsewhere and a text
      // that is nobody's to change; now and then it leaves nothing.
      const here = [...body.matchAll(/\n- Person \d+ \((c\d+)\), a/g)].map(match => match[1]), spot = /^The place: Place \d+ \((p\d+)\)/.exec(request.messages[0].content)![1];
      seen.turns?.push(askedOf(request, record(), spot, true));
      const labels = [...body.matchAll(/\nHidden here \((h\d+)\)/g)].map(match => match[1]);
      const changes = Array.from({ length: upTo(6) - 1 }, () => {
        const what = ['pose', 'holds', 'has', 'things', 'looks'][upTo(5) - 1];
        const of = what === 'things' ? (random() < 0.7 ? spot : `p${upTo(PLACES) - 1}`) : random() < 0.7 ? here[upTo(here.length) - 1] : `c${upTo(PEOPLE) - 1}`;
        return { of, what, text: random() < 0.15 ? '' : `${what}-${of}-${upTo(99_999)}` };
      });
      answer = roll < 0.1 ? 'no answer' : { result: roll < 0.4 ? null : words(upTo(90)), wakes: [...sleepers.filter(() => random() < 0.5), `c${upTo(PEOPLE) - 1}`], changes,
        // It calls about half of the deeds a search, and now and then says that a deed went straight to a hidden thing
        // of the place or to one that is not there.
        search: random() < 0.5, finds: random() < 0.15 ? [labels[upTo(labels.length + 1) - 1] ?? 'h9'] : [] };
    } else if ('memory' in (request.schema as { properties: object }).properties) {
      seen.turns?.push(askedOf(request, record(), asker(request), false));
      answer = roll < 0.08 ? { memory: '' } : roll < 0.12 ? { memory: 'x'.repeat(5000) } : { memory: words(roll < 0.3 ? 61 + upTo(100) : upTo(60)) };
    } else {
      seen.turns?.push(askedOf(request, record(), asker(request), true));
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
  const turns = seen.turns!;
  seen.turns = null;

  const place = new Map(world.characters.map(character => [character.id, character.place]));
  const away = new Map<string, string>(), asleep = new Set<string>(), held = new Map<string, number>(), folded = new Map<string, number>();
  const count = { say: 0, call: 0, waited: 0, go: 0, do: 0, sleep: 0, wake: 0, until: 0, cut: 0, memory: 0, memoryCut: 0, memoryLost: 0,
    json: 0, action: 0, text: 0, to: 0, here: 0, place: 0, time: 0, result: 0, nothing: 0, woken: 0, spent: 0, changed: 0, emptied: 0, unposed: 0, weather: 0, roofless: 0, clocked: 0, clockless: 0, found: 0, straight: 0 };
  const sleepEnds = new Map<string, number>();
  // Each one's sleep debt, counted here from the events alone: one for a second awake, two back for a second asleep.
  const debts = new Map(world.characters.map(character => [character.id, { debt: 13 * 3600, since: 0 }]));
  const debtOf = (id: string, now: number) => { const { debt, since } = debts.get(id)!; return asleep.has(id) ? Math.max(0, debt - 2 * (now - since)) : debt + now - since; };
  const limit = world.sleep.spentHours * 3600;
  // Bodies, belongings and things, counted here from the world file and the records alone.
  const bodies = new Map(world.characters.map(({ id, pose, holds, has }) => [id, { pose, holds, has }]));
  const things = new Map(world.places.map(({ id, things: lying }) => [id, lying]));
  // What is still hidden in each place, and the seconds each one has searched each place.
  const hidden = new Map(world.places.map(item => [item.id, item.hidden])), searched = new Map<string, number>();
  // Which state of the weather holds, and the words of it that each one has perceived so far.
  const open = new Set(world.places.filter(item => item.open).map(item => item.id));
  const felt = new Map(world.characters.map(character => [character.id, new Set<string>()]));
  const reaching = (state: number, spot: string) => open.has(spot) ? `sky-${state}-0` : state && !SKIES[state - 1].indoors ? null : `roof-${state}-0`;
  // The times of the clock each one could read: those of the records that came while a clock was at hand.
  const timed = new Map(world.characters.map(character => [character.id, new Set<string>()]));
  const clocks = new Set(world.places.filter(item => item.clock).map(item => item.id));
  const reads = ({ id, clock }: { id: string; clock: boolean }) => clock || (!away.has(id) && clocks.has(place.get(id)!));
  const read = (...times: string[]) => { for (const character of world.characters) if (reads(character)) for (const time of times) timed.get(character.id)!.add(time); };
  let at = 0, asked = 0, sky = 0;
  for (const { seq, record, event } of journal.all) {
    law('time', event.at >= at, seq);
    // A sleeper a deed wakes is told the moment the deed ends.
    const ends = record.kind === 'result' ? [clockAt(world, journal.all[seq - 1].event.at + journal.all[seq - 1].event.seconds)] : [];
    read(event.clock, ...ends);
    // A request made when the journal held this many records shows bodies, belongings and things as they stood then.
    // The world is sent everything of the deed's place and of those in it. A resident is sent its own looks and, for
    // a turn, its pose, holdings and what it carries, with what is seen of those in its place.
    for (; asked < turns.length && turns[asked].record === seq; asked += 1) {
      const { who, turn, marks } = turns[asked], spot = who.startsWith('p') ? who : place.get(who);
      if (who !== spot) {
        for (const time of turns[asked].clocks) law('clock', timed.get(who)!.has(time), seq);
        if (turn) count[turns[asked].clocks.includes(event.clock) ? 'clocked' : 'clockless'] += 1;
      }
      const near = turn ? world.characters.filter(({ id }) => id !== who && !away.has(id) && place.get(id) === spot) : [];
      const seen = (id: string) => [`looks-${id}-0`, bodies.get(id)!.pose, bodies.get(id)!.holds];
      const due = new Set((who === spot ? [things.get(who)!, `facts-${who}-0`, ...hidden.get(who)!.map(thing => thing.text), ...near.flatMap(({ id }) => [...seen(id), bodies.get(id)!.has, `facts-${id}-0`])]
        : [`looks-${who}-0`, ...(turn ? [...seen(who), bodies.get(who)!.has] : []), ...near.flatMap(({ id }) => seen(id))]).flatMap(text => text?.match(MARK) ?? []));
      // A word that is not due is another's secret or a text of another place, or else a text that is no longer so.
      const shown = new RegExp(`^(looks|pose|holds)-(${[who, ...near.map(({ id }) => id)].join('|')})-`);
      for (const mark of marks) law(who === spot || shown.test(mark) ? 'body' : 'unseen', due.has(mark), seq);
      law('body', due.size === new Set(marks).size, seq);
      // The world is told the weather outside and what of it gets under the roof of the deed's place. A turn says
      // the weather as its place gives it, and a resident's request holds no word of a weather it did not perceive.
      const { sky: words, now } = turns[asked], reaches = reaching(sky, spot as string);
      if (who === spot) law('weather', isDeepStrictEqual(words, [`sky-${sky}-0`, ...(open.has(spot) || reaches === null ? [] : [reaches])]), seq);
      else {
        if (turn && reaches !== null) felt.get(who)!.add(reaches);
        law('weather', isDeepStrictEqual(now, turn && reaches !== null ? [reaches] : []) && words.every(word => felt.get(who)!.has(word)), seq);
      }
    }
    const before = journal.all[seq - 1]?.event;
    if (record.kind === 'weather') {
      const given = SKIES[sky];
      law('weather', record.n === sky + 1 && record.at === given.at && event.text === given.text && event.indoors === given.indoors, seq);
      sky += 1;
      const reached = world.characters.map(character => character.id).filter(id => !away.has(id) && !asleep.has(id) && reaching(sky, place.get(id)!) !== null);
      law('weather', isDeepStrictEqual(event.heard, reached), seq);
      for (const id of reached) felt.get(id)!.add(reaching(sky, place.get(id)!)!);
      count.weather += 1;
      if (given.indoors === null) count.roofless += 1;
    } else law('weather', event.at < SKIES[sky].at, seq);
    law('deed', (before?.kind === 'do') === (record.kind === 'result') && (record.kind !== 'result' || (before.who === record.who && before.at === record.at)), seq);
    if (record.kind === 'result') {
      for (const id of record.wakes) {
        law('waking', asleep.has(id) && place.get(id) === event.place, seq);
        sleepEnds.set(id, Math.min(sleepEnds.get(id)!, before.at + before.seconds));
      }
      // A search finds what its doer's searches of the place have lasted long enough for. It lies among the things
      // from then on, unless the answer wrote the things anew.
      // So does a deed that the world says went straight to a thing still hidden in that place.
      const key = `${record.who} ${event.place}`, seconds = (searched.get(key) ?? 0) + before.seconds, lay = hidden.get(event.place)!;
      if (record.search) searched.set(key, seconds);
      law('found', record.finds.every(id => lay.some(thing => thing.id === id)), seq);
      const found = lay.filter(thing => (record.search && seconds >= thing.minutes * 60) || record.finds.includes(thing.id));
      law('found', isDeepStrictEqual(event.found, found.map(thing => thing.text)), seq);
      count.straight += found.filter(thing => !record.search || seconds < thing.minutes * 60).length;
      if (found.length) {
        hidden.set(event.place, lay.filter(thing => !found.includes(thing)));
        if (found.length && !record.changes.some(change => change.what === 'things')) {
          things.set(event.place, [things.get(event.place), ...found.map(thing => thing.text)].filter(text => text !== null).map(text => `${text}.`.replace('..', '.')).join(' '));
        }
        count.found += found.length;
      }
      for (const change of record.changes) {
        law('body', change.what === 'things' ? change.of === event.place : place.get(change.of) === event.place && !away.has(change.of), seq);
        if (change.what === 'things') things.set(change.of, change.text || null);
        else bodies.get(change.of)![change.what] = change.text || null;
        count.changed += 1;
        if (!change.text) count.emptied += 1;
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
      law('place', event.kind === 'weather' || (id !== event.who && (place.get(id) === event.place || (event.kind === 'call' && id === event.to))), seq);
    }
    if (event.kind === 'say' || event.kind === 'call') {
      law('limit', sizeOf(event.text as string) <= (record.kind === 'act' ? record.limit : 0), seq);
      for (const id of [event.who, ...event.heard]) held.set(id, Math.max(held.get(id) ?? 0, event.at + event.seconds));
      count[event.kind] += 1;
      if (event.cut) count.cut += 1;
      if (event.kind === 'call' && !event.heard.includes(event.to as string)) count.waited += 1;
    } else if (event.kind === 'go') {
      away.set(event.who, event.to as string);
      if (bodies.get(event.who)!.pose !== null) count.unposed += 1;
      bodies.get(event.who)!.pose = null;
      count.go += 1;
    } else if (event.kind === 'arrive') {
      law('arrival', away.get(event.who) === event.place, seq);
      away.delete(event.who);
      place.set(event.who, event.place);
      // The one who arrives reads the clock of the place it came to.
      read(event.clock);
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
    // Many of the runs are one call long, so that some stop between a deed and the world's answer to it. Every other
    // one is two calls long: an answer that cannot be used is asked for once more, and a run of one call stops there.
    const stops: string[] = [];
    for (const calls of [300, ...Array.from({ length: 60 }, (_, index) => 1 + index % 2), 250, 310]) {
      const state = openState(path, source, ENVIRONMENT);
      try {
        // Two runs cannot write one file, and a file does not take another world.
        assert.throws(() => openState(path, source, ENVIRONMENT), StateError);
        let last = '';
        await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls, journal: state, pause: true, onEvent: event => { last = event.kind; } });
        stops.push(last);
      } finally { state.close(); }
    }
    assert.ok(stops.includes('do'), 'no run stopped between a deed and its result');
    // A file takes neither another world file nor its own under another environment.
    assert.throws(() => openState(path, `${source} `, ENVIRONMENT), StateError);
    assert.throws(() => openState(path, source, `${ENVIRONMENT} `), StateError);
    assert.throws(() => openState(path, source), StateError);
    const state = openState(path, source, ENVIRONMENT);
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
