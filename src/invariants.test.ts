// The guard of the live world's rules: a world of thirty people is played for thousands of steps by a stand-in whose
// answer is a function of the request, and then the journal alone is checked against what must hold whatever a model
// answers: the laws below. It is here because a broken law shows one character another's life, or loses a memory,
// without any error. The laws are written here and nowhere else.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { ModelError } from './chatgpt.ts';
import type { Request } from './chatgpt.ts';
import { JournalError, memoryStore, replay, StateError } from './journal.ts';
import type { Entry } from './journal.ts';
import { requestLimit, runLive } from './live.ts';
import { openState } from './state.ts';
import { readWorld } from './laws.ts';
import { SINKS } from './things.ts';
import type { Thing } from './things.ts';
import { clockAt, speechSeconds } from './time.ts';
import { GESTURE_WORDS, MAX_SECONDS, MAX_SLEEP, SAYS_WORDS, sizeOf, wordsOf } from './world.ts';

const PLACES = 6, PEOPLE = 30;
// The weather changes every ten minutes of the story, from the fifth on; every third change does not get under a roof.
// Each text is one word that says which state it is of and whether it is the sky's or the roof's.
const SKIES = Array.from({ length: 2000 }, (_, index) => ({ at: 300 + index * 600, text: `sky-${index + 1}-0`, indoors: index % 3 ? `roof-${index + 1}-0` : null }));
const START = 20 * 3600;
// The pairs of places that are next door to each other, each listed by its first place only: one place has two such
// neighbours, and the last place has none.
const DOORS = [['p0', 'p1'], ['p2', 'p1'], ['p4', 'p3']];
const neighbours = (spot: string) => DOORS.flatMap(([one, other]) => one === spot ? [other] : other === spot ? [one] : []);
const source = JSON.stringify({ title: 'Town', about: 'A small town.', clock: '20:00', remote: 'radio', travelMinutes: 3, shortWords: 300, longWords: 60,
  // Thirteen hours awake at the start, and the limit a quarter of an hour on, so that some reach it.
  tiredHours: 13.1,
  weather: { start: { text: 'sky-0-0', indoors: 'roof-0-0' }, changes: SKIES.map(({ at, text, indoors }) => ({ text, indoors, day: Math.floor((START + at) / 86_400) + 1,
    at: [Math.floor((START + at) % 86_400 / 3600), Math.floor((START + at) / 60) % 60].map(part => String(part).padStart(2, '0')).join(':') })) },
  // Two places of the six have a clock and every fifth person carries one.
  // Every text of a body and of facts is one word that names its kind and its owner, so that a request shows whose
  // it holds, and so is the name of a thing that not everyone may be sent. The facts of a thing are one word that
  // begins `lore-` and names where the thing began: a tool and what lies in a hidden thing, a hat, and the bread and
  // the water, of which parts are taken.
  places: Array.from({ length: PLACES }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, about: 'A place.', minutesTo: index ? { p0: index } : {},
    nextDoor: DOORS.filter(([one]) => one === `p${index}`).map(([, other]) => other),
    // Every place but the last says where it lies, so some walks take the straight line and some the world's minutes.
    ...(index < PLACES - 1 ? { at: [index * 150, index % 2 * 2000] } : {}), open: index % 2 === 1, clock: index % 3 === 0,
    facts: `facts-p${index}-0`,
    // Each place has things that are counted, among them money, food and what burns, two supplies with no count,
    // things that hold others, and things with states. Some places have a permanent fire, some a stove that
    // can go out, and some no fire at all.
    things: [{ name: `rack-p${index}`, fixed: true, open: true, holds: [{ name: 'coin', n: 40, money: true }, { name: 'bread', n: 30, food: 50, facts: 'lore-bread' }, { name: 'log', n: 30, burns: true },
      { name: `cup-p${index}`, holds: [] }, { name: `tool-p${index}`, facts: `lore-p${index}-tool` }] },
    { name: `stove-p${index}`, fixed: true, states: ['lit', 'out'], state: 'lit', fire: index % 2 === 0 ? 'lit' : false }, { name: `torch-p${index}`, fixed: true, fire: index % 3 === 0 },
    { name: `gate-p${index}`, fixed: true, states: ['open', 'shut', 'ajar'] }, { name: 'wood', stock: true, burns: true }, { name: 'water', stock: true, food: 0, facts: 'lore-water' },
    // Three things are hidden in every place: one that a few minutes of searching find, one that takes half an hour,
    // and one that no search here lasts long enough for.
    { name: `hidden-p${index}-0`, holds: [{ name: `inside-p${index}-0`, facts: `lore-p${index}-inside` }], hidden: { spot: `spot-p${index}-0`, minutes: 3 } },
    { name: `hidden-p${index}-1`, hidden: { spot: `spot-p${index}-1`, minutes: 30 } }, { name: `hidden-p${index}-2`, hidden: { spot: `spot-p${index}-2`, minutes: 600 } }],
    // All places but one have someone whom nobody plays and who answers, and all but another a crowd.
    ...(index === 1 ? {} : { figures: [{ id: `f${index}`, name: `Figure ${index}`, looks: `looks-f${index}-0`, facts: `facts-f${index}-0` }] }),
    ...(index === 2 ? {} : { crowd: `crowd-p${index}-0` }) })),
  // Everyone wears a coat that is not open, with a thing in it that nobody else may be sent and some money, and
  // carries an open tray with food and with twigs to burn.
  characters: Array.from({ length: PEOPLE }, (_, index) => ({ id: `c${index}`, name: `Person ${index}`, place: `p${index % PLACES}`, sheet: `Sheet ${index}.`,
    facts: `facts-c${index}-0`, looks: `looks-c${index}-0`, pose: `pose-c${index}-0`, clock: index % 5 === 0,
    carries: [{ name: `coat-c${index}`, holds: [{ name: `secret-c${index}` }, { name: 'coin', n: 10, money: true }] }, { name: `hat-c${index}`, facts: `lore-c${index}-hat` },
      { name: `tray-c${index}`, open: true, holds: [{ name: 'apple', n: 3, food: 90 }, { name: 'twig', n: 3, burns: true }] },
      // Some carry all a person may, and some a thing in a thing four deep, so that the run meets both limits.
      ...(index % 5 === 1 ? Array.from({ length: 23 }, (_, at) => ({ name: `trinket-c${index}-${at}` })) : []),
      ...(index % 5 === 3 ? [{ name: `nest-c${index}`, holds: [{ name: `nest2-c${index}`, holds: [{ name: `nest3-c${index}`, holds: [{ name: `nest4-c${index}`, holds: [] }] }] }] }] : [])] })) });
// The settings of sleep come from an environment, and the world file changes one of them itself.
const ENVIRONMENT = JSON.stringify({ dayStart: '07:00', tiredHours: 2, spentHours: 13.25 });
const world = readWorld(JSON.parse(source), JSON.parse(ENVIRONMENT));

// The laws of a live world, each one sentence. A run that breaks one fails with that sentence and the record's number.
export const LAWS = {
  time: 'Time never goes back.',
  order: 'Nobody takes a turn at an instant before everyone who arrives or wakes at that instant has done so.',
  place: 'Nobody perceives what happened in another place, except the one a call was made to and those next door to a deed, who are told only what the world says is heard there.',
  absent: 'A traveller or a sleeper perceives nothing and takes no action.',
  speech: 'Nobody acts before a speech they are hearing or making has ended.',
  limit: 'A speech never holds more words than its turn allowed, the words said with a deed never more than that or than twenty, and a gesture never more than twelve; only a `say` has a gesture and only a `do` such words.',
  arrival: 'A traveller arrives in the place it set out for.',
  memory: 'A long-term memory never exceeds its limit in words.',
  folded: 'The record up to which a character\'s lines were folded never moves back.',
  request: 'No request to the model exceeds the size fixed by the world file.',
  replay: 'Replaying the records gives every stored event again, and a journal that was changed is refused.',
  resume: 'A run stopped and continued from its file gives the same journal as one that never stopped.',
  deed: 'Every deed is followed by the world\'s answer and by nothing else.',
  waking: 'A sleeper wakes only when its sleep ends or a deed\'s result wakes it, and a deed wakes nobody outside its place and the places next door to it.',
  spent: 'Nobody acts after being awake for the world\'s limit: at that turn it falls asleep instead.',
  body: 'How a person is placed changes only by the world\'s answer to a deed done in the place where it is; a pose is also dropped when its owner leaves or falls asleep.',
  kept: 'A thing is where the postings of events put it and nowhere else, and the world is told of exactly those of its place and of the people there: a record has one holder, lies no deeper than four under a person or a place, a person carries thirty records at most and a place holds sixty, and for every name what there is, what was eaten or burned and what was taken from a supply add up to what the world file gave; the sum of money never changes.',
  burning: 'Nothing burns without a fire in the place or on someone there, before the answer changes any states.',
  moved: 'An answer of the world moves only what is in its place or on the people there, to them, into that place or, for a deed, out of the world by being eaten or burned; an answer that the rules refuse changes nothing, and so does one whose moves are all to where their things already are, which is refused.',
  unseen: 'No resident is sent a label, what lies inside a thing that another person carries and that is not open, what is hidden in a place before it is found, the facts of the people of a place whom nobody plays, or the looks or pose of a person in another place.',
  reply: 'Someone of a place whom nobody plays speaks only in answer to a speech addressed to it in its place, once and right after that speech.',
  found: 'A hidden thing is found only where it lies, by a search of its finder that has lasted its minutes or by a deed the world says went straight to it, and then it is hidden for nobody.',
  weather: 'The weather changes only when and as the world file gives, and whoever is asleep or on the way perceives none of it.',
  clock: 'Nobody is sent the clock of a moment at which it had no clock at hand, its own or its place\'s.',
  felt: 'Nobody is told what another\'s body feels, the world included, and nobody asleep or away is told a feeling.',
  lore: 'The facts of a thing reach the world only in a request that lists the thing, wherever it then is, in the line of the place and each text once, and no resident is sent any.',
  door: 'What of a deed is heard next door is told only to those awake in a place next door to the deed\'s, and to a sleeper there whom the deed wakes, in one line that names the deed\'s place and holds nothing else of the deed, and it ends their waiting; the world is told who is next door to a deed by name, awake or asleep, and is never told what was heard; of a deed in a place with no place next door nothing is heard.',
  earlier: 'A place keeps for the world the latest of what came of the deeds done in it and shows it at every request there: for each deed the world\'s words and after them what the rules moved, set and found, a line also when there were no words, and no line for a deed that left neither.',
};
const law = (name: keyof typeof LAWS, holds: boolean, record: number) => assert.ok(holds, `Law broken at record ${record}: ${LAWS[name]}`);

// The same request always gets the same answer, so the same world always gets the same journal. The answers are of
// every kind: the oversized, a time of day in place of seconds, the unusable for each of its reasons, and the one
// that the model's limit cut short, for a turn, a memory and the world alike.
// `record` says how many records the journal held at a request, so that the largest request can be placed. While
// `seen.turns` is a list, it gains for every request who was asked, a resident or for the world the deed's place, at
// which record, whether for a turn, and the words of bodies, facts and guarded things that the request held; `records`
// holds every thing the request lists under a label, with its name and count, the lines a place keeps left aside, `labelled` says that it holds a label at all, and `again` counts the requests that
// asked once more after an answer the rules refused, `full` those of them that say a person would carry too much,
// `deep` those that say a thing would lie deeper than four, and `same` those that say nothing moved.
// `sky` holds the words of the weather in the whole request, and `now` those after its history, where a turn says
// the weather of the moment. `reply` marks a request to the world for a figure's answer. `clocks` holds every time of the clock in the request, as the engine writes one.
// `feels` holds the words of what bodies feel in the request: the stand-in gives each as one word that names its owner.
// `seen.feels` keeps, for the number of records the journal held, what the latest answer of the world gave of them,
// and `seen.said` what it gave as heard next door and whom it named as woken.
// `lore` holds every word of the facts of things in the request and `facts` those of them that stand in its first
// line, the place's. `doors` holds the lines of the places next door, and `sounds` every line
// that holds a word of what was heard next door, which the stand-in gives as one word that names the deed's place,
// or that tells of being woken. `earlier` holds the lines of what came of earlier deeds in the place.
type Asked = { record: number; who: string; turn: boolean; reply?: boolean; marks: string[]; labelled: boolean; records: string[]; sky: string[]; now: string[]; clocks: string[]; feels: string[];
  lore: string[]; facts: string[]; doors: string[]; sounds: string[]; earlier: string[] };
type Feeling = { of: string; text: string };
const SKY = /\b(?:sky|roof)-\d+-0/g, CLOCK = /(?:day \d+ )?\d\d:\d\d:\d\d/g, FEELS = /\bfeels-c\d+-\d+/g, LORE = /\blore-[\w-]+/g;
const asker = (request: Request) => /\nYou are Person \d+ \((c\d+)\)\./.exec(request.system!)![1];
const askedOf = (request: Request, record: number, who: string, turn: boolean): Asked => {
  const content = request.messages[0].content, body = `${request.system}${content}`;
  return { record, who, turn, marks: body.match(MARK) ?? [], labelled: /\bt\d+\b/.test(content), records: (content.replace(/\n[^\n]* Person \d+ did \([^\n]*/g, '').match(/\bt\d+ [^,;[\]\n]*/g) ?? []).map(found => found.replace(/\..*$/, '').trim()), sky: body.match(SKY) ?? [], now: content.slice(content.lastIndexOf('\nNow ') + 1).match(SKY) ?? [],
    clocks: body.match(CLOCK) ?? [], feels: body.match(FEELS) ?? [], lore: body.match(LORE) ?? [], facts: content.slice(0, content.indexOf('\n')).match(LORE) ?? [],
    doors: [...content.matchAll(/\n- Place \d+ \((p\d+)\): ([^\n]*)/g)].map(found => `${found[1]} ${found[2]}`), sounds: body.split('\n').filter(line => /\bbeyond-|woke you/.test(line)),
    earlier: (/\nWhat came of earlier deeds here:\n((?:[^\n]* Person \d+ did \([^\n]*\n)*)/.exec(content)?.[1] ?? '').split('\n').filter(Boolean) };
};
const MARK = /\b(?:looks|pose|facts|crowd|hidden|inside|secret)-[cpf]\d+(?:-\d+)?/g;
function standIn(record: () => number) {
  const seen: { largest: number; record: number; again: number; full: number; deep: number; same: number; turns: Asked[] | null; feels: Map<number, Feeling[]>;
    said: Map<number, { beyond: string | null; wakes: string[] }> } = { largest: 0, record: 0, again: 0, full: 0, deep: 0, same: 0, turns: [], feels: new Map(), said: new Map() };
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
    const asks = (request.schema as { properties: object }).properties;
    if ('result' in asks || 'reply' in asks) {
      // The world: sometimes no answer, sometimes nothing to notice, and it wakes some of the sleepers and names others.
      const sleepers = [...body.matchAll(/\((c\d+)\), asleep/g)].map(match => match[1]);
      const here = [...body.matchAll(/\n- Person \d+ \((c\d+)\), a/g)].map(match => match[1]), spot = /^The place: Place \d+ \((p\d+)\)/.exec(request.messages[0].content)![1];
      seen.turns?.push({ ...askedOf(request, record(), spot, true), reply: 'reply' in asks });
      const content = request.messages[0].content, labels = [...content.matchAll(/\nHidden here \((t\d+)\)/g)].map(match => match[1]);
      if (content.includes('was not taken')) seen.again += 1;
      if (content.includes('was not taken') && content.includes('a person carries 30 things at most')) seen.full += 1;
      if (content.includes('was not taken') && content.includes('is where the thing already is')) seen.same += 1;
      // What it moves it mostly takes from what the schema lets it name, as a model held to the schema would, and it
      // reads the marks of a thing so that most entries can be taken: a part of a count or all of it, some from a
      // supply, food eaten and wood burned. It leaves alone what is still hidden, the things that only their carrier
      // may be sent, and the trinkets and the inner things of a nest, which so stay where the world file put them.
      // Now and then an entry is wild: a label that is nowhere, a fixed thing, a place elsewhere.
      type Named = { enum?: string[] };
      const lists = asks as unknown as { moves: { items: { properties: { what: Named; to: Named } } }; sets?: { items: { properties: { what: Named; state: Named } } } };
      const names = lists.moves.items.properties;
      const told = (label: string) => new RegExp(`\\b${label} [^;[\\]\\n]*`).exec(content)?.[0] ?? '';
      const unfound = new Set([...content.matchAll(/\nHidden here[^\n]*/g)].flatMap(match => match[0].match(/\bt\d+\b/g) ?? []));
      const pick = <Item>(list: Item[]) => list[upTo(list.length) - 1];
      // A thing sent into the innermost of four nested things is refused for its depth and for nothing else.
      const sent = /because of the entry (\{[^}]*\}): [^\n]*four things deep/.exec(content);
      if (sent && told(JSON.parse(sent[1]).to).includes(' nest4-') && JSON.parse(sent[1]).what !== JSON.parse(sent[1]).to) seen.deep += 1;
      const free = (names.what.enum ?? []).filter(label => !/ (?:secret|trinket|nest[234])-/.test(told(label))), careful = free.filter(label => !unfound.has(label));
      const fixed = [...content.matchAll(/\b(t\d+) [^;[\]\n]*, fixed/g)].map(match => match[1]), tos = names.to.enum ?? [];
      // Now and then an entry is aimed where the rules stop it: into the innermost of four nested things, or at one
      // who carries trinkets and with them all that a person may or nearly all.
      const hard = [...tos.filter(to => told(to).includes(' nest4-')), ...[...content.matchAll(/\n- Person \d+ \((c\d+)\)[^\n]* trinket-/g)].map(match => match[1])];
      // And now and then all that it lists puts a thing into the very thing it lies in, so that nothing moves.
      const still = random() < 0.06 ? careful.flatMap(what => { const lies = new RegExp(`\\b(t\\d+) [^;[\\]\\n]*\\[${what} `).exec(content); return lies ? [{ what, n: 1, to: lies[1] }] : []; }) : [];
      const moves = Array.from({ length: upTo(4) - 1 }, () => {
        if (still.length) return pick(still);
        if (random() < 0.12 || !careful.length) {
          const what = pick([...free, ...fixed, 't99999']);
          return { what, n: upTo(3) - 1, to: pick([...tos, what, `p${upTo(PLACES) - 1}`, `c${upTo(PEOPLE) - 1}`]) };
        }
        const what = pick(careful), has = / ×(\d+)/.exec(told(what));
        const sink = SINKS.find(to => tos.includes(to) && told(what).includes(to === 'eaten' ? ', food' : ', burns') && random() < 0.5);
        return { what, n: told(what).includes(', stock') ? upTo(5) : has ? random() < 0.3 ? Number(has[1]) : upTo(Number(has[1])) : 1,
          to: sink ?? pick(hard.length && random() < 0.15 ? hard : tos.filter(to => to !== what && !unfound.has(to) && !SINKS.includes(to))) };
      });
      const stated = lists.sets?.items.properties;
      const sets = Array.from({ length: stated?.what.enum ? upTo(3) - 1 : 0 }, () => {
        const what = pick(stated!.what.enum!);
        return { what, state: pick(random() < 0.9 ? /\(([^)]*)\)/.exec(told(what))![1].split('/') : stated!.state.enum!) };
      });
      // It poses those here and now and then someone elsewhere, and now and then leaves no pose.
      const poses = Array.from({ length: upTo(3) - 1 }, () => {
        const of = random() < 0.8 ? pick(here) : `c${upTo(PEOPLE) - 1}`;
        return { of, text: random() < 0.15 ? '' : `pose-${of}-${upTo(99_999)}` };
      });
      // It says what the bodies of those awake here feel, and now and then that of a sleeper here or of someone who
      // may be elsewhere, and now and then an entry has no words.
      const awake = here.filter(id => !sleepers.includes(id));
      const feels = 'reply' in asks ? [] : Array.from({ length: upTo(4) - 1 }, () => {
        const of = random() < 0.6 ? pick(awake) : sleepers.length && random() < 0.6 ? pick(sleepers) : `c${upTo(PEOPLE) - 1}`;
        return { of, text: random() < 0.2 ? '' : `feels-${of}-${upTo(99_999)}` };
      });
      if (seen.turns) seen.feels.set(record(), feels);
      // About half of the deeds are heard next door, whether or not the place has such a neighbour, now and then with
      // no words. The sleepers it wakes are of the place and of the places next door alike, since the request names
      // both, and it wakes them whether or not anything was heard; the one more it names may sleep far away.
      const beyond = random() < 0.5 ? null : random() < 0.1 ? ' ' : `beyond-${spot}-${upTo(99_999)}`;
      const wakes = [...sleepers.filter(() => random() < 0.5), `c${upTo(PEOPLE) - 1}`];
      if (seen.turns && !('reply' in asks)) seen.said.set(record(), { beyond, wakes });
      // For a figure it gives words, too many now and then, or none.
      answer = roll < 0.1 ? 'no answer' : 'reply' in asks ? { reply: roll < 0.35 ? null : words(upTo(90)), moves }
        // It calls about half of the deeds a search, and now and then says that a deed went straight to a hidden thing
        // of the place or to one that is not there.
        : { search: random() < 0.5, finds: random() < 0.15 ? [labels[upTo(labels.length + 1) - 1] ?? 't0'] : [], moves, sets, poses,
          wakes, feels, beyond, result: roll < 0.4 ? null : words(upTo(90)) };
    } else if ('memory' in (request.schema as { properties: object }).properties) {
      seen.turns?.push(askedOf(request, record(), asker(request), false));
      answer = roll < 0.08 ? { memory: '' } : roll < 0.12 ? { memory: 'x'.repeat(5000) } : { memory: words(roll < 0.3 ? 61 + upTo(100) : upTo(60)) };
    } else {
      seen.turns?.push(askedOf(request, record(), asker(request), true));
      // A gesture and words for a deed come with any action, too long now and then: only a `say` keeps the one and a `do` the other.
      const none = { text: null, to: null, place: null, seconds: null, until: null, gesture: roll * 100 % 1 < 0.4 ? words(upTo(20)) : null, says: roll * 10_000 % 1 < 0.4 ? words(upTo(30)) : null,
        note: roll * 1000 % 1 < 0.3 ? words(upTo(90)) : null };
      // A time of day at random: for a wait it is mostly out of reach, for a sleep about half the time, and such a span
      // is cut to the longest one; now and then a wait names no time of day at all, which is refused.
      const figures = [...request.messages[0].content.matchAll(/\n- Figure \d+ \((f\d+)\)\./g)].map(match => match[1]);
      const until = `${String(upTo(24) - 1).padStart(2, '0')}:${String(upTo(60) - 1).padStart(2, '0')}`;
      answer = roll < 0.02 ? 'not an action' : roll < 0.03 ? { ...none, action: 'fly' } : roll < 0.04 ? { ...none, action: 'say' }
        : roll < 0.05 ? { ...none, action: 'call', to: 'all', text: 'anyone' } : roll < 0.06 ? { ...none, action: 'go', place: 'gates' }
        // A speech is often addressed: to the figure of the place, to one of another place, to a character or to nobody of the kind.
        : roll < 0.4 ? { ...none, action: 'say', text: roll < 0.08 ? 'y'.repeat(3000) : words(upTo(90)), to: [figures[0] ?? 'f1', figures[0] ?? null, `f${upTo(PLACES) - 1}`, 'c1', null][upTo(5) - 1] }
          : roll < 0.55 ? { ...none, action: 'call', to: `c${upTo(PEOPLE) - 1}`, text: words(upTo(40)) }
            : roll < 0.7 ? { ...none, action: 'go', place: `p${upTo(PLACES) - 1}` }
              : roll < 0.8 ? { ...none, action: 'do', text: words(upTo(120)), seconds: upTo(600) }
                : roll < 0.86 ? { ...none, action: 'wait', seconds: upTo(300) }
                  : roll < 0.9 ? { ...none, action: 'wait', until: roll < 0.87 ? 'noon' : until, seconds: 5 }
                    : roll < 0.95 ? { ...none, action: 'sleep', until } : { ...none, action: 'sleep', seconds: upTo(roll < 0.96 ? 43_200 : 1800) };
    }
    // Now and then the model writes on to its limit, whatever it was asked: the connection then fails with this code.
    // The same request is cut again when it is asked again, so the runs here do not end at three in a row.
    if (random() < 0.02) throw new ModelError('output_limit');
    // Now and then the service declines to write. The runs here do not end at the third either.
    if (random() < 0.01) throw new ModelError('declined');
    return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: null };
  };
  return { seen, respond };
}

test('thousands of steps of any answers leave a journal in which every law of the world holds', async () => {
  const journal = memoryStore();
  const { seen, respond } = standIn(() => journal.all.length);
  const whole = await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls: 6000, journal, pause: true, cutRun: Infinity, declinedRun: Infinity, invalidRun: Infinity });
  assert.deepEqual([whole.status, whole.reason, whole.calls], ['done', 'calls', 6000]);
  const turns = seen.turns!;
  seen.turns = null;

  const place = new Map(world.characters.map(character => [character.id, character.place]));
  const away = new Map<string, string>(), asleep = new Set<string>(), held = new Map<string, number>(), folded = new Map<string, number>();
  const count = { say: 0, call: 0, gestured: 0, spoken: 0, waited: 0, go: 0, do: 0, sleep: 0, wake: 0, until: 0, capped: 0, cut: 0, memory: 0, memoryCut: 0, memoryLost: 0,
    json: 0, action: 0, text: 0, to: 0, here: 0, place: 0, time: 0, long: 0, declined: 0, result: 0, nothing: 0, woken: 0, spent: 0, posed: 0, unposed: 0, weather: 0, roofless: 0, clocked: 0, clockless: 0, found: 0, straight: 0, reply: 0, silent: 0,
    moved: 0, parted: 0, joined: 0, taken: 0, eaten: 0, burned: 0, set: 0, handed: 0, carried: 0, lent: 0, told: 0, felt: 0, feltAsleep: 0, feltAway: 0, feltEmpty: 0,
    lore: 0, loreMoved: 0, loreParted: 0, loreHidden: 0, beyond: 0, wokenBeyond: 0, wokenMute: 0, unwoken: 0, wokenFar: 0, hush: 0,
    keptWords: 0, keptBoth: 0, keptLists: 0, keptNone: 0, met: 0 };
  const sleepEnds = new Map<string, number>();
  // The instant of the latest turn, an action or a falling asleep at the limit, and the latest arrival or waking.
  let turned = -1, came = { at: -1, who: '' };
  // Each one's sleep debt, counted here from the events alone: one for a second awake, two back for a second asleep.
  const debts = new Map(world.characters.map(character => [character.id, { debt: 13 * 3600, since: 0 }]));
  const debtOf = (id: string, now: number) => { const { debt, since } = debts.get(id)!; return asleep.has(id) ? Math.max(0, debt - 2 * (now - since)) : debt + now - since; };
  const limit = world.sleep.spentHours * 3600;
  // How everyone is placed, counted here from the world file and the records alone.
  const poses = new Map(world.characters.map(({ id, pose }) => [id, pose]));
  // Where every thing is and how many there are of it, counted here from the world file and then from the postings
  // of the events alone: under each label its name, its count, its holder, and whether it is a supply or money.
  // `given` is how many there were of each name at the start, `sunk` what was eaten or burned and `taken` what came
  // from a supply.
  const ledger = new Map<string, { name: string; n: number | null; holder: string; stock: boolean; money: boolean; facts: string | null }>();
  const fires = new Map<string, { fire: Thing['fire']; state: string | null }>();
  const given = new Map<string, number>(), sunk = new Map<string, number>(), taken = new Map<string, number>();
  const more = (sums: Map<string, number>, name: string, n: number) => sums.set(name, (sums.get(name) ?? 0) + n);
  const enter = (things: Thing[], holder: string) => {
    for (const thing of things) {
      if (thing.fire) fires.set(thing.label, { fire: thing.fire, state: thing.state });
      ledger.set(thing.label, { name: thing.name, n: thing.n, holder, stock: thing.stock, money: thing.money, facts: thing.facts });
      if (!thing.stock) more(given, thing.name, thing.n ?? 1);
      enter(thing.holds ?? [], thing.label);
    }
  };
  for (const item of world.places) enter(item.things, item.id);
  for (const character of world.characters) enter(character.carries, character.id);
  const sums = () => { const now = new Map<string, number>(); for (const { name, n, stock } of ledger.values()) if (!stock) more(now, name, n ?? 1); return now; };
  const money = () => [...ledger.values()].reduce((sum, thing) => sum + (thing.money ? thing.n! : 0), 0), purse = money();
  const rootOf = (key: string): string => ledger.has(key) ? rootOf(ledger.get(key)!.holder) : key;
  const topOf = (label: string): string => ledger.has(ledger.get(label)!.holder) ? topOf(ledger.get(label)!.holder) : label;
  const depthOf = (key: string): number => ledger.has(key) ? 1 + depthOf(ledger.get(key)!.holder) : 0;
  const labelOf = new Map([...ledger].map(([label, thing]) => [thing.name, label])), first = new Set(ledger.keys());
  // What is still hidden in each place, the names of what was found, and the seconds each one has searched each place.
  const hidden = new Map(world.places.map(item => [item.id, item.things.filter(thing => thing.hidden)])), searched = new Map<string, number>();
  const known = new Set<string>();
  // Which state of the weather holds, and the words of it that each one has perceived so far.
  const open = new Set(world.places.filter(item => item.open).map(item => item.id));
  const felt = new Map(world.characters.map(character => [character.id, new Set<string>()]));
  const reaching = (state: number, spot: string) => open.has(spot) ? `sky-${state}-0` : state && !SKIES[state - 1].indoors ? null : `roof-${state}-0`;
  // The times of the clock each one could read: those of the records that came while a clock was at hand.
  const timed = new Map(world.characters.map(character => [character.id, new Set<string>()]));
  const clocks = new Set(world.places.filter(item => item.clock).map(item => item.id));
  const reads = ({ id, clock }: { id: string; clock: boolean }) => clock || (!away.has(id) && clocks.has(place.get(id)!));
  const read = (...times: string[]) => { for (const character of world.characters) if (reads(character)) for (const time of times) timed.get(character.id)!.add(time); };
  // The words of what bodies feel that a result has given so far, and those of them that a request has shown since.
  const bodily = new Set<string>(), met = new Set<string>();
  // What each place keeps of the deeds done in it, written here from the events alone.
  const kept = new Map(world.places.map(item => [item.id, [] as string[]]));
  // Who may be told each word of what was heard next door; who was woken by whom in the deed's own place, and who
  // from which place next door with which word or with none; and from when each one who heard such a word is free.
  const sounded = new Map<string, Set<string>>(), shaken = new Set<string>(), knocked = new Set<string>(), roused = new Map<string, number>();
  const WHEN = String.raw`(?:\[[^\]\n]+\]|(?:day \d+ )?\d\d:\d\d:\d\d)`;
  const HEARD = new RegExp(`^${WHEN} From Place (\\d+), next door: (beyond-p\\d+-\\d+)$`), WOKEN = new RegExp(`^${WHEN} Something from Place (\\d+), next door, woke you(?:\\.|: (beyond-p\\d+-\\d+))$`),
    SHAKEN = new RegExp(`^${WHEN} Person (\\d+) woke you by this: [^\\n]*$`);
  let at = 0, asked = 0, sky = 0;
  for (const { seq, record, event } of journal.all) {
    law('time', event.at >= at, seq);
    // A sleeper a deed wakes is told the moment the deed ends, and an answer is heard from the moment its speech ends.
    const ends = record.kind === 'result' || record.kind === 'reply' ? [clockAt(world, journal.all[seq - 1].event.at + journal.all[seq - 1].event.seconds)] : [];
    read(event.clock, ...ends);
    // A request made when the journal held this many records shows bodies, belongings and things as they stood then.
    // The world is sent everything of the deed's place and of those in it. A resident is sent its own looks and, for
    // a turn, its pose, holdings and what it carries, with what is seen of those in its place.
    for (; asked < turns.length && turns[asked].record === seq; asked += 1) {
      const { who, turn, marks } = turns[asked], spot = who.startsWith('p') ? who : place.get(who);
      // A word of what a body feels is in a request of its owner alone, and only after the result that gave it.
      for (const word of turns[asked].feels) {
        law('felt', who !== spot && word.startsWith(`feels-${who}-`) && bodily.has(word), seq);
        if (!met.has(word)) count.felt += 1;
        met.add(word);
      }
      // A line of what was heard next door is its hearer's, of a deed's place next door, and has no other form; a
      // sleeper woken from next door reads the place and the sound or the place alone, and never who did what.
      for (const line of turns[asked].sounds) {
        const heard = HEARD.exec(line), woken = WOKEN.exec(line), shook = !/\bbeyond-/.test(line) && SHAKEN.exec(line);
        law('door', who !== spot && (heard ? heard[2].startsWith(`beyond-p${heard[1]}-`) && sounded.get(heard[2])!.has(who)
          : woken ? knocked.has(`${who} p${woken[1]} ${woken[2] ?? ''}`) : !!shook && shaken.has(`${who} c${shook[1]}`)), seq);
        if (met.has(`${who} ${line}`)) continue;
        met.add(`${who} ${line}`);
        if (!shook) count[heard ? 'beyond' : woken![2] ? 'wokenBeyond' : 'wokenMute'] += 1;
      }
      law('lore', who === spot ? turns[asked].lore.length === turns[asked].facts.length : !turns[asked].lore.length, seq);
      if (who !== spot) {
        for (const time of turns[asked].clocks) law('clock', timed.get(who)!.has(time), seq);
        if (turn) count[turns[asked].clocks.includes(event.clock) ? 'clocked' : 'clockless'] += 1;
      }
      const near = turn ? world.characters.filter(({ id }) => id !== who && !away.has(id) && place.get(id) === spot) : [];
      const seen = (id: string) => [`looks-${id}-0`, poses.get(id)!];
      // The people of the place whom nobody plays: the world is sent their looks and facts, a resident's turn their looks.
      const local = world.places.find(item => item.id === spot)!;
      const due = new Set((who === spot ? [`facts-${who}-0`, local.crowd,
        ...local.figures.flatMap(figure => [figure.looks, figure.facts]), ...near.flatMap(({ id }) => [...seen(id), `facts-${id}-0`])]
        : [`looks-${who}-0`, ...(turn ? [...seen(who), local.crowd, ...local.figures.map(figure => figure.looks)] : []),
          ...near.flatMap(({ id }) => seen(id))]).flatMap(text => text?.match(MARK) ?? []));
      // A word that is not due is another's secret or a text of another place, or else a text that is no longer so.
      const shown = new RegExp(`^(?:(looks|pose)-(${[who, ...near.map(({ id }) => id), ...local.figures.map(({ id }) => id)].join('|')})|crowd-${spot})-`);
      const guarded = marks.filter(mark => /^(?:hidden|inside|secret)-/.test(mark)), plain = marks.filter(mark => !guarded.includes(mark));
      for (const mark of plain) law(who === spot || shown.test(mark) ? 'body' : 'unseen', due.has(mark), seq);
      law('body', due.size === new Set(plain).size, seq);
      if (who === spot) {
        // The world is told of every thing of the place and of the people there as the postings left it, each once
        // with its count, and for a figure's answer of nothing that is still hidden.
        const roots = new Set([spot, ...near.map(({ id }) => id)]), still = new Set(hidden.get(spot)!.map(thing => thing.label));
        const lies = [...ledger].filter(([label]) => roots.has(rootOf(label)) && !(turns[asked].reply && still.has(topOf(label))))
          .map(([label, { name, n }]) => `${label} ${name}${n === null ? '' : ` ×${n}`}`);
        law('kept', isDeepStrictEqual([...turns[asked].records].sort(), lies.sort()), seq);
        // And of the facts of exactly those things, each under its label, wherever the thing began and whatever it
        // was parted from.
        const lore = [...ledger].filter(([label, { facts }]) => facts !== null && roots.has(rootOf(label)) && !(turns[asked].reply && still.has(topOf(label))));
        law('lore', isDeepStrictEqual([...turns[asked].facts].sort(), [...new Set(lore.map(([, { facts }]) => facts!))].sort()), seq);
        count.lore += lore.length;
        count.loreMoved += lore.filter(([, { facts }]) => /^lore-p\d+-/.test(facts!) && !facts!.startsWith(`lore-${spot}-`)).length;
        count.loreParted += lore.filter(([label]) => !first.has(label)).length;
        count.loreHidden += lore.filter(([label]) => still.has(topOf(label))).length;
        // And of what the place keeps of its earlier deeds, for a deed and for a figure's answer alike.
        law('earlier', isDeepStrictEqual(turns[asked].earlier, kept.get(spot)), seq);
        for (const line of turns[asked].earlier.filter(line => !met.has(`${spot} ${line}`))) {
          met.add(`${spot} ${line}`);
          count[!line.includes(' In the lists: ') ? 'keptWords' : line.includes(' Result: ') ? 'keptBoth' : 'keptLists'] += 1;
        }
        // A deed's request says who is in each place next door, awake or asleep, and a figure's says nothing of them.
        law('door', isDeepStrictEqual(turns[asked].doors, turns[asked].reply ? [] : world.places.filter(item => neighbours(spot).includes(item.id)).map(item => `${item.id} ${
          world.characters.filter(({ id }) => !away.has(id) && place.get(id) === item.id).map(({ id, name }) => `${name} (${id}), ${asleep.has(id) ? 'asleep' : 'awake'}`).join('; ') || 'nobody'}.`)), seq);
      } else {
        // A resident is sent no label. A guarded thing is named to it only when it carries the thing, three deep at
        // most, and a hidden one only when it was found.
        law('unseen', !turns[asked].labelled, seq);
        for (const mark of guarded) {
          const label = labelOf.get(mark)!;
          law('unseen', mark.startsWith('secret-') ? rootOf(label) === who && depthOf(label) <= 3 && turn : known.has(mark), seq);
          if (mark.startsWith('secret-')) count[mark === `secret-${who}` ? 'carried' : 'lent'] += 1;
          else count.told += 1;
        }
      }
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
    // A figure answers the speech addressed to it just before, where it lives, and nothing else.
    const addressed = before?.kind === 'say' && before.to !== null;
    law('reply', addressed === (record.kind === 'reply'), seq);
    if (event.kind === 'say' && event.to !== null) law('reply', world.places.find(item => item.id === event.place)!.figures.some(figure => figure.id === event.to), seq);
    if (record.kind === 'reply') {
      law('reply', before.who === record.who && before.at === record.at && before.to === record.figure && event.who === record.figure && event.place === before.place, seq);
      law('limit', record.text === null || sizeOf(record.text) <= 65, seq);
      // Those who heard the speech hear the answer out, the speaker with them.
      law('reply', isDeepStrictEqual(event.heard, record.text === null && !event.moved!.length ? [] : world.characters.map(({ id }) => id).filter(id => id === before.who || before.heard.includes(id))), seq);
      for (const id of event.heard) held.set(id, Math.max(held.get(id) ?? 0, before.at + before.seconds + event.seconds));
      count.handed += event.moved!.length;
      count[record.text === null ? 'silent' : 'reply'] += 1;
    }
    if (record.kind === 'result') {
      const beside = (id: string) => !away.has(id) && neighbours(event.place).includes(place.get(id)!), said = seen.said.get(seq);
      law('waking', isDeepStrictEqual(event.wakes, record.wakes), seq);
      for (const id of record.wakes) {
        law('waking', asleep.has(id) && (place.get(id) === event.place || beside(id)), seq);
        sleepEnds.set(id, Math.min(sleepEnds.get(id)!, before.at + before.seconds));
        if (beside(id)) knocked.add(`${id} ${event.place} ${record.beyond ?? ''}`);
        else shaken.add(`${id} ${record.who}`);
      }
      // What is heard next door is what the world gave, for everyone awake in a place next door and nobody else. A
      // sleeper there who is not woken is told nothing, and one who sleeps farther off is not woken.
      const hearers = record.beyond === null ? [] : world.characters.map(({ id }) => id).filter(id => beside(id) && !asleep.has(id));
      law('door', isDeepStrictEqual(event.nearby, hearers) && event.beyond === record.beyond && (record.beyond === null || record.beyond === said?.beyond), seq);
      if (record.beyond !== null) {
        if (!sounded.has(record.beyond)) sounded.set(record.beyond, new Set());
        for (const id of [...hearers, ...record.wakes.filter(beside)]) sounded.get(record.beyond)!.add(id);
        count.unwoken += world.characters.filter(({ id }) => beside(id) && asleep.has(id) && !record.wakes.includes(id)).length;
      }
      // Of a deed in a place with no place next door nothing is heard, whatever the world gave.
      law('door', record.beyond === null || neighbours(event.place).length > 0, seq);
      const taken = event.heard.length || record.feels.length || record.poses.length || record.wakes.length || record.finds.length || record.search;
      if (taken && !neighbours(event.place).length && said?.beyond?.trim()) count.hush += 1;
      // The place keeps the world's words and what the rules told of the lists, the latest 400 words of them and
      // the newest line whatever its size, and nothing of a deed that left neither.
      const doer = world.characters.find(({ id }) => id === record.who)!.name, lines = kept.get(event.place)!;
      // The lists are in it under labels, every posting, with the holder as the answer named it and a request writes it.
      const holder = (id: string) => { const one = [...world.characters, ...world.places].find(item => item.id === id); return one ? `${one.name} (${id})` : `${id} ${ledger.get(id)!.name}`; };
      const lists = [...event.moved!.map(({ what, name, n, to, as }) => `${as ?? what} ${name}${n === null ? '' : ` ×${n}`} ${
        to === 'eaten' ? `was eaten or drunk up by ${doer}` : to === 'burned' ? 'burned up' : `went to ${holder(to)}`}.`),
      ...event.set!.map(({ what, name, state }) => `${what} ${name} is now ${state}.`), ...event.found!.map(({ what, name, spot }) => `${what} ${name} was found: ${spot}.`)].join(' ');
      const shut = (text: string) => /[.!?…]$/.test(text) ? text : `${text}.`;
      if (record.text === null && !lists) count.keptNone += 1;
      else lines.push(`${event.clock} ${doer} did (${before.seconds} s): ${record.text === null ? shut(before.text!) : `${before.text} Result: ${lists ? shut(record.text) : record.text}`}${lists ? ` In the lists: ${lists}` : ''}`);
      while (lines.length > 1 && lines.reduce((sum, line) => sum + sizeOf(line), 0) > 400) lines.shift();
      for (const id of hearers) roused.set(id, event.at);
      count.wokenFar += record.wakes.length || record.beyond !== null ? said!.wakes.filter(id => asleep.has(id) && place.get(id) !== event.place && !beside(id)).length : 0;
      // A search finds what its doer's searches of the place have lasted long enough for, and so does a deed that the
      // world says went straight to a thing still hidden in that place. It is hidden no longer.
      const key = `${record.who} ${event.place}`, seconds = (searched.get(key) ?? 0) + before.seconds, lay = hidden.get(event.place)!;
      if (record.search) searched.set(key, seconds);
      law('found', record.finds.every(label => lay.some(thing => thing.label === label)), seq);
      const found = lay.filter(thing => (record.search && seconds >= thing.hidden!.minutes * 60) || record.finds.includes(thing.label));
      law('found', isDeepStrictEqual(event.found, found.map(thing => ({ what: thing.label, name: thing.name, spot: thing.hidden!.spot }))), seq);
      count.straight += found.filter(thing => !record.search || seconds < thing.hidden!.minutes * 60).length;
      hidden.set(event.place, lay.filter(thing => !found.includes(thing)));
      for (const thing of found) for (const name of [thing.name, ...(thing.holds ?? []).map(held => held.name)]) known.add(name);
      count.found += found.length;
      for (const pose of record.poses) {
        law('body', place.get(pose.of) === event.place && !away.has(pose.of), seq);
        poses.set(pose.of, pose.text || null);
        count.posed += 1;
      }
      // What a body feels goes to one awake in the place of the deed. Of an answer that was taken, which shows by
      // anything else it left, every such entry is kept, the later of two for one person, and the others are dropped.
      const gave = seen.feels.get(seq) ?? [], owned = (of: string) => place.get(of) === event.place && !away.has(of), due = new Map<string, string>();
      for (const { of, text } of record.feels) {
        law('felt', owned(of) && !asleep.has(of) && text !== '', seq);
        bodily.add(text);
      }
      if (event.heard.length || record.feels.length || record.poses.length || record.wakes.length || record.finds.length || record.search) {
        for (const { of, text } of gave) {
          if (text && owned(of) && !asleep.has(of)) { due.delete(of); due.set(of, text); } else count[!text ? 'feltEmpty' : owned(of) ? 'feltAsleep' : 'feltAway'] += 1;
        }
        law('felt', isDeepStrictEqual(record.feels, [...due].map(([of, text]) => ({ of, text }))) && isDeepStrictEqual(event.feels, record.feels), seq);
      }
      count.set += event.set!.length;
      count.result += 1;
      count.woken += record.wakes.length;
      if (record.text === null) count.nothing += 1;
    }
    // Every posting takes from the holder the ledger has the thing at, in the place of the answer, and gives to a
    // holder there or to a sink; then the ledger is as the posting says.
    const here = (key: string) => { const root = rootOf(key); return root === event.place || (place.get(root) === event.place && !away.has(root)); };
    for (const posting of event.moved ?? []) {
      const thing = ledger.get(posting.what)!, amount = posting.n ?? 1, gone = SINKS.includes(posting.to);
      law('kept', thing?.holder === posting.from && thing.name === posting.name && thing.stock === posting.stock, seq);
      law('kept', posting.n === null ? thing.n === null && !thing.stock : thing.stock || (posting.n >= 1 && posting.n <= thing.n!), seq);
      law('moved', here(posting.from) && (gone ? record.kind === 'result' && posting.as === null && !thing.money : here(posting.to)), seq);
      if (posting.to === 'burned') law('burning', [...fires].some(([label, thing]) => here(label) && (thing.fire === true || thing.fire === thing.state)), seq);
      if (thing.stock) more(taken, thing.name, amount);
      else if (thing.n !== null && thing.n > amount) thing.n -= amount;
      else ledger.delete(posting.what);
      const twin = posting.as === null ? undefined : ledger.get(posting.as);
      if (gone) more(sunk, thing.name, amount);
      else if (twin) {
        law('kept', twin.holder === posting.to && twin.name === thing.name && twin.n !== null && twin.facts === thing.facts, seq);
        twin.n! += amount;
      } else ledger.set(posting.as!, { name: thing.name, n: posting.n, holder: posting.to, stock: false, money: thing.money, facts: thing.facts });
      count[gone ? posting.to as 'eaten' | 'burned' : thing.stock ? 'taken' : twin ? 'joined' : posting.as !== posting.what ? 'parted' : 'moved'] += 1;
    }
    for (const entry of event.set ?? []) if (fires.has(entry.what)) fires.get(entry.what)!.state = entry.state;
    if (event.moved?.length) {
      const held = new Map<string, number>();
      for (const label of ledger.keys()) {
        law('kept', depthOf(label) <= 4, seq);
        more(held, rootOf(label), 1);
      }
      for (const [root, records] of held) law('kept', records <= (root.startsWith('p') ? 60 : 30), seq);
      const now = sums();
      for (const [name, n] of given) law('kept', (now.get(name) ?? 0) + (sunk.get(name) ?? 0) - (taken.get(name) ?? 0) === n, seq);
      law('kept', money() === purse, seq);
    }
    at = event.at;
    if (record.kind === 'spent') count.spent += 1;
    if (record.kind === 'act' || record.kind === 'spent') law('spent', (debtOf(record.who, record.at) >= limit) === (record.kind === 'spent'), seq);
    if (event.kind === 'sleep' || event.kind === 'wake') debts.set(event.who, { debt: debtOf(event.who, event.at), since: event.at });
    // Whoever heard something from next door is free then, or when a speech that holds it has ended.
    if ((record.kind === 'act' || record.kind === 'spent' || record.kind === 'memory') && roused.has(record.who)) {
      law('door', record.at === Math.max(roused.get(record.who)!, held.get(record.who) ?? 0), seq);
      roused.delete(record.who);
    }
    if (record.kind === 'act' || record.kind === 'spent') {
      // A turn of someone else at the instant at which someone came or woke: that one was there to be seen.
      if (record.at === came.at && record.who !== came.who) count.met += 1;
      turned = record.at;
    }
    if (record.kind === 'arrive' || record.kind === 'wake') {
      law('order', record.at > turned, seq);
      came = { at: record.at, who: record.who };
    }
    if (record.kind === 'act') {
      law('absent', !away.has(record.who) && !asleep.has(record.who), seq);
      law('speech', record.at >= (held.get(record.who) ?? 0), seq);
      if (typeof record.action === 'string') count[record.action] += 1;
      else if (record.action.until !== null) count.until += 1;
      else if (record.action.capped) {
        // A span that was cut lasts the longest one.
        law('limit', event.seconds === (event.kind === 'sleep' ? MAX_SLEEP : MAX_SECONDS), seq);
        count.capped += 1;
      }
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
      if (poses.get(event.who) !== null) count.unposed += 1;
      poses.set(event.who, null);
      count.go += 1;
    } else if (event.kind === 'arrive') {
      law('arrival', away.get(event.who) === event.place, seq);
      away.delete(event.who);
      place.set(event.who, event.place);
      // The one who arrives reads the clock of the place it came to.
      read(event.clock);
    } else if (event.kind === 'sleep') {
      // Nobody asleep has a pose it took before the sleep began.
      if (poses.get(event.who) !== null) count.unposed += 1;
      poses.set(event.who, null);
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
    } else if (event.kind === 'do') {
      count.do += 1;
      if (event.says !== undefined) {
        // The words said with a deed hold the doer and those who hear them as a speech does, and the deed lasts as long at least.
        const ends = event.at + speechSeconds(world, wordsOf(event.says).length);
        law('limit', sizeOf(event.says) <= Math.min(SAYS_WORDS, record.kind === 'act' ? record.limit : 0) && event.at + event.seconds >= ends, seq);
        for (const id of [event.who, ...event.heard]) held.set(id, Math.max(held.get(id) ?? 0, ends));
        count.spoken += 1;
      }
    }
    law('limit', (event.gesture === undefined || (event.kind === 'say' && sizeOf(event.gesture) <= GESTURE_WORDS)) && (event.says === undefined || event.kind === 'do'), seq);
    if (event.gesture !== undefined) count.gestured += 1;
  }
  // The run had all of it in it, or the laws above were tried on little. The stand-in's answer comes from the text of
  // the request, so any change of a request's wording plays another run: a kind that then falls short is too rare in
  // the stand-in, and the cure is to make it less rare there, not to ask for fewer.
  for (const [kind, times] of Object.entries(count)) assert.ok(times >= 5, `${kind} happened ${times} times`);
  assert.deepEqual([whole.rewrites, whole.lost], [count.memory, count.memoryLost]);
  // Answers were refused and each was asked again with the reason, and some deeds were left with nothing.
  for (const [kind, times] of Object.entries({ refused: whole.refused, void: whole.void, full: seen.full, deep: seen.deep, same: seen.same })) assert.ok(times >= 5, `${kind} happened ${times} times`);
  assert.ok(seen.again >= whole.refused - whole.void && seen.again >= 5, 'an answer was refused and not asked again');
  // The things the journal amounts to are the ledger's, each under one holder.
  const final = replay(world, journal.all).things, lying: string[] = [];
  const walk = (things: Thing[], holder: string) => { for (const thing of things) { lying.push(`${thing.label} ${thing.name} ${thing.n} ${holder}`); walk(thing.holds ?? [], thing.label); } };
  for (const [id, things] of [...final.places, ...final.people]) walk(things, id);
  law('kept', isDeepStrictEqual(lying.sort(), [...ledger].map(([label, { name, n, holder }]) => `${label} ${name} ${n} ${holder}`).sort()), journal.all.length);
  assert.ok(whole.overlong > count.long, 'no answer of the world or memory was cut short');
  assert.ok(whole.declined > count.declined, 'no answer of the world or memory was declined');
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
    const stops: string[] = [], caches = new Set<string>();
    for (const calls of [300, ...Array.from({ length: 60 }, (_, index) => 1 + index % 2), 250, 310]) {
      const state = openState(path, source, ENVIRONMENT);
      try {
        // Two runs cannot write one file, and a file does not take another world.
        assert.throws(() => openState(path, source, ENVIRONMENT), StateError);
        caches.add(state.cache);
        let last = '';
        await runLive({ world, respond, model: 'stand-in', minutes: 10_000_000, calls, journal: state, pause: true, cutRun: Infinity, declinedRun: Infinity, invalidRun: Infinity, onEvent: event => { last = event.kind; } });
        stops.push(last);
      } finally { state.close(); }
    }
    assert.ok(stops.includes('do'), 'no run stopped between a deed and its result');
    // The file's name for a service's cache is the same at every opening, and a journal begun in another file has another.
    const fresh = openState(join(directory, 'fork.sqlite'), source, ENVIRONMENT);
    fresh.close();
    assert.ok(caches.size === 1 && !caches.has(fresh.cache));
    // A file takes neither another world file nor its own under another environment.
    assert.throws(() => openState(path, `${source} `, ENVIRONMENT), StateError);
    assert.throws(() => openState(path, source, `${ENVIRONMENT} `), StateError);
    assert.throws(() => openState(path, source), StateError);
    // A database of something else is refused as it was found: not one byte of it is changed.
    const foreign = join(directory, 'other.sqlite'), other = new DatabaseSync(foreign);
    other.exec('CREATE TABLE notes (body TEXT)');
    other.close();
    const before = readFileSync(foreign);
    assert.throws(() => openState(foreign, source, ENVIRONMENT), StateError);
    assert.deepEqual(readFileSync(foreign), before);
    const state = openState(path, source, ENVIRONMENT);
    try {
      const continued = [...state.entries()];
      const differs = continued.findIndex((entry, index) => !isDeepStrictEqual(entry, journal.all[index]));
      law('resume', differs === -1, differs);
      assert.ok(continued.length > 800);
    } finally { state.close(); }
  } finally { rmSync(directory, { recursive: true }); }
});
