// How much of a step of the live mode is this program's own work, and does a request stop growing?
//   node src/bench.ts [characters] [places] [turns] [--memory]
// A synthetic town is played by a stand-in that answers at once, so every millisecond here is the harness's and the
// disk's. `turns` is the number of model calls for each character, the memory rewrites and the world's answers to
// deeds among them. The journal goes
// to a state file in the temporary directory, as a long run's would, or stays in memory with `--memory`. One JSON
// line comes out: the requests in characters over the first quarter, the first half and the whole run, and the
// process memory at the end of each.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Request } from './chatgpt.ts';
import { memoryStore } from './journal.ts';
import { requestLimit, runLive } from './live.ts';
import { openState } from './state.ts';
import { readWorld } from './laws.ts';

const inMemory = process.argv.includes('--memory');
const [people = 1000, places = 100, turns = 50] = process.argv.slice(2).filter(argument => argument !== '--memory').map(Number);
const calls = people * turns;
const source = JSON.stringify({ title: 'Town', about: 'A town of many places. '.repeat(10), clock: '08:00', remote: 'telephone', travelMinutes: 5,
  // A seeded series, and every other place under the open sky.
  weather: { seed: 7, minutes: [5, 20], states: ['Clear and still.', 'It is raining.', 'A strong wind.'].map(text => ({ text, indoors: `Outside the window: ${text}` })) },
  places: Array.from({ length: places }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, about: 'An ordinary place in the town.',
    things: [{ name: 'table', fixed: true, open: true, holds: [{ name: 'toolbox', holds: [{ name: 'hammer' }] }] }, { name: 'bench', fixed: true }, { name: 'bench', fixed: true }], open: index % 2 === 1 })),
  characters: Array.from({ length: people }, (_, index) => ({ id: `c${index}`, name: `Resident ${index}`, place: `p${index % places}`, sheet: 'You are a resident of the town. '.repeat(20),
    looks: 'A middle-aged person in a grey jacket.', pose: 'Stands by the wall.',
    carries: [{ name: 'bag', holds: [{ name: 'wallet', holds: [{ name: 'rubles', n: 500, money: true }] }, { name: 'keys' }] }] })) });
const world = readWorld(JSON.parse(source));

let seed = 42;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const speech = Array.from({ length: 20 }, (_, index) => `word${index}`).join(' ');
const memory = JSON.stringify({ memory: Array.from({ length: Math.ceil(world.longWords * 0.8) }, (_, index) => `memory${index}`).join(' ') });
const none = { text: null, to: null, place: null, seconds: null, until: null, note: null };
// The marks at a quarter, a half and the whole of the calls: the requests up to each, and the memory then.
const marks = [calls / 4, calls / 2, calls].map(until => ({ until, characters: 0, largest: 0, rssMB: 0 }));
let count = 0, rewrites = 0, results = 0;
const respond = async (request: Request) => {
  // What the transport would do with it: build the body of the request.
  const size = JSON.stringify(request).length;
  count += 1;
  for (const mark of marks) {
    if (count > mark.until) continue;
    mark.characters += size;
    mark.largest = Math.max(mark.largest, size);
    if (count === Math.floor(mark.until)) mark.rssMB = Math.round(process.memoryUsage().rss / 1e6);
  }
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  if ('result' in (request.schema as { properties: object }).properties) {
    results += 1;
    return { text: JSON.stringify({ search: false, finds: [], moves: [], sets: [], poses: [], wakes: [], feels: [], beyond: null, result: speech }), usage };
  }
  if ('memory' in (request.schema as { properties: object }).properties) {
    rewrites += 1;
    return { text: memory, usage };
  }
  const roll = random();
  const answer = roll < 0.55 ? { ...none, action: 'say', text: speech, note: 'a note to self' }
    : roll < 0.6 ? { ...none, action: 'call', to: `c${Math.floor(random() * people)}`, text: speech }
      : roll < 0.7 ? { ...none, action: 'do', text: speech, seconds: 30 }
        : roll < 0.78 ? { ...none, action: 'wait', seconds: 30 }
        : roll < 0.8 ? { ...none, action: 'sleep', seconds: 1 + Math.floor(random() * 28_800) } : { ...none, action: 'go', place: `p${Math.floor(random() * places)}` };
  return { text: JSON.stringify(answer), usage };
};

const directory = inMemory ? null : mkdtempSync(join(tmpdir(), 'sagents-bench-'));
const state = directory ? openState(join(directory, 'world.sqlite'), source) : null;
let records = 0;
try {
  const started = performance.now();
  const outcome = await runLive({ world, respond, model: 'stand-in', minutes: 100_000_000, calls, journal: state ?? memoryStore(), pause: true,
    onEvent: () => { records += 1; } });
  const ms = performance.now() - started;
  const [quarter, half, whole] = marks.map(mark => ({ mean: Math.round(mark.characters / Math.floor(mark.until)), largest: mark.largest, rssMB: mark.rssMB }));
  console.log(JSON.stringify({ characters: people, places, journal: state ? 'file' : 'memory', reason: outcome.reason, calls: outcome.calls, turns: outcome.calls - rewrites - results, results,
    rewrites: outcome.rewrites, lost: outcome.lost, invalid: outcome.invalid, records, storyMinutes: Math.round(outcome.seconds / 60),
    seconds: +(ms / 1000).toFixed(1), msPerStep: +(ms / outcome.calls).toFixed(3), requestLimit: requestLimit(world), quarter, half, whole }));
} finally {
  state?.close();
  if (directory) rmSync(directory, { recursive: true });
}
