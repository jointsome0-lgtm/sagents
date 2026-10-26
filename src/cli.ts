#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createChatgpt, ModelError, signIn, SignInError } from './chatgpt.ts';
import type { Message, Request } from './chatgpt.ts';
import { JournalError, StateError } from './journal.ts';
import { linesOf, runLive, UNTAKEN_CAUSES } from './live.ts';
import type { Player } from './live.ts';
import { modelFor } from './model.ts';
import { environmentOf, isEnvironmentName, readWorld } from './laws.ts';
import { WorldError } from './world.ts';
import { EvalError, readQuestions, runEval } from './eval.ts';

const USAGE = `sagents login [--new]          sign in with ChatGPT in the browser; --new registers this tool again
sagents status [<model>]       whether this computer is signed in, and whether the plan's list of models has the model
sagents ask [--timeout <s>]    one request as JSON on stdin, one JSON line on stdout
sagents live <world.json> [--model <id>] [--cast <character>=<id>]... [--world-model <id>] [--minutes <n>] [--calls <n>] [--tokens <n>]
                  [--state <file> | --run <dir>] [--untaken-text] [--environment <name>] [--json]
                               the characters of a world file, each played by the model, under the story's clock;
                               --cast gives one character a model of its own; --world-model answers what comes of a deed;
                               with --state the world is kept in that file and continues from it;
                               with --run it is kept in that directory as an experiment the lab reads: the world file,
                               the state, and for every start a stretch of events and of rows that count its requests
sagents eval <dir> --model <id> --ask <questions.json> [--calls <n>] [--window <words>] [--out <file>]
sagents eval --state <file> --world <world.json> --model <id> --ask <questions.json> [--calls <n>] [--window <words>] [--out <file>]
                               a judge reads a finished live journal with log, show and diff, and gives a report
sagents evolve <dir> --task <task.json> --model <id> --calls <n> [--parallel <k>] [--tries <t>] [--timeout <s>]
                               a model improves one text file against the task's evaluator, keeping in the directory
                               an archive of the best valid file of every cell; a second start goes on with the same task;
                               a line for every file evaluated on stderr, and the summary as one JSON line on stdout
sagents evolve-map <dir>       the map of an evolve run as one HTML page on stdout, which loads nothing and runs no script:
                               the files by request and score with their families and parents, the cells and their elites,
                               the discoveries, and every file with its change against its parent; the directory is only read
sagents numbers <dir>... [--json] [--prices <file>]
                               the story's time, actions and requests counted from kept files, with no model
                               --prices adds dollars from the file's prices per million tokens for each model
sagents lab [<dir>...] [--port <n>] [--lang <en|ru>] [--no-open]
                               the lab in the browser: the experiments under the directories, or under those that
                               SAGENTS_LAB names (separated as in PATH), or under the current one; it prints its address,
                               http://127.0.0.1:4747/ or with another port when --port names one or 4747 is taken, and
                               asks the system opener to open it with the data key after #; with --no-open or when
                               the opener cannot start or exits unsuccessfully, the printed address holds the key;
                               --port 0 lets the system choose;
                               an experiment is at /view/<its id>; Ctrl+C stops it; the page is in the language of
                               --lang, or of SAGENTS_LAB_LANG, or else the one it remembers or the browser's;
                               the first address uses ?language=en or ?language=ru, which the page remembers and removes
sagents help                   this text

Without the command installed, \`node src/cli${import.meta.url.slice(-3)}\` takes the same arguments.

A request: {"model": "<id>", "<id>@<effort>" or "api:<id>", "system": "...", "messages": [{"role": "user", "content": "..."}], "schema": {...}, "cache": "<name>"}
An answer: {"status": "done", "text": "...", "usage": {...}}, with "endpoint" when a router named who answered, or {"status": "failed", "reason": "<code>"}
A failed answer also has "httpStatus", "providerCode" and "param" when the service gave them.
"api:<id>" is a model of the chat completions server that SAGENTS_API_URL names, with SAGENTS_API_KEY if it asks for one.`;
const DEFAULT_MODEL = 'gpt-6.1-sol';
const LIVE_MODEL = 'gpt-6.1-sol@low';
const MAX_REQUEST = 16_000_000;
// These sentences are ours, so they may be shown.
class OptionError extends Error {}

const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
const isMessage = (value: unknown): value is Message =>
  isObject(value) && (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string';

// Local users can read arguments in the process list.
async function requestFrom(input: NodeJS.ReadStream, limit: AbortSignal): Promise<Request> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stop = () => { input.destroy(); };
  limit.addEventListener('abort', stop, { once: true });
  try {
    for await (const chunk of input) {
      const part = Buffer.from(chunk);
      bytes += part.byteLength;
      if (bytes > MAX_REQUEST) throw new ModelError('invalid_request');
      chunks.push(part);
    }
  } catch (error) {
    throw limit.aborted ? new ModelError('timeout') : error instanceof ModelError ? error : new ModelError('invalid_request');
  } finally { limit.removeEventListener('abort', stop); }
  if (limit.aborted) throw new ModelError('timeout');
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ModelError('invalid_request'); }
  if (!isObject(value) || typeof value.model !== 'string' || !Array.isArray(value.messages) || !value.messages.length
    || !value.messages.every(isMessage) || (value.system !== undefined && typeof value.system !== 'string')
    || (value.schema !== undefined && !isObject(value.schema)) || (value.cache !== undefined && typeof value.cache !== 'string')) throw new ModelError('invalid_request');
  return { model: value.model, system: value.system, messages: value.messages, schema: value.schema, ...(value.cache === undefined ? {} : { cache: value.cache }) };
}

const detailsOf = (error: unknown) => error instanceof ModelError
  ? { reason: error.code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...(error.providerCode ? { providerCode: error.providerCode } : {}), ...(error.param ? { param: error.param } : {}) }
  : { reason: 'internal_error' };

async function report(chatgpt: ReturnType<typeof createChatgpt>, name: string) {
  const status = chatgpt.status();
  console.log(`signed in: ${status.signedIn ? 'yes' : 'no'}; plan use: ${status.planUse ? 'allowed' : 'not allowed'}; access token: ${status.minutesLeft} min left`);
  if (!status.signedIn || !status.planUse) return;
  const offered = await chatgpt.models();
  const model = name.split('@')[0];
  console.log(`models in the plan's list: ${offered.length}; ${model}: ${offered.includes(model) ? 'in the list' : 'not in the list, which does not say that a request with it fails'}`);
}

const [command, ...rest] = process.argv.slice(2);
function argumentsOf(options: { [name: string]: { type: 'boolean' | 'string'; multiple?: boolean } }, others: number) {
  try {
    const parsed = parseArgs({ args: rest, options, allowPositionals: others > 0 });
    return parsed.positionals.length <= others ? parsed : null;
  } catch { return null; }
}

if (command === 'help' || command === '--help' || command === '-h') console.log(USAGE);
else if (command === 'numbers') {
  const given = argumentsOf({ json: { type: 'boolean' }, prices: { type: 'string' } }, Infinity);
  if (!given || !given.positionals.length) { console.error(USAGE); process.exitCode = 1; }
  else {
    const { NumbersError, readPrices, numbersOf, numbersTable, numbersJSON } = await import('./numbers.ts');
    try {
      const prices = given.values.prices === undefined ? undefined : readPrices(given.values.prices as string);
      const runs: ReturnType<typeof numbersOf>[] = [];
      for (const dir of given.positionals) {
        try {
          const run = numbersOf(dir, prices), name = run.name;
          for (let n = 2; runs.some(other => other.name === run.name); n += 1) run.name = `${name} (${n})`;
          runs.push(run);
        } catch (error) {
          if (!(error instanceof NumbersError)) throw error;
          console.error(`${JSON.stringify(dir)}: ${error.message}`);
          process.exitCode = 1;
        }
      }
      console.log(given.values.json === true ? JSON.stringify(numbersJSON(runs)) : numbersTable(runs));
    } catch (error) {
      if (!(error instanceof NumbersError)) throw error;
      console.error(error.message);
      process.exitCode = 1;
    }
  }
} else if (command === 'lab') {
  const given = argumentsOf({ port: { type: 'string' }, lang: { type: 'string' }, 'no-open': { type: 'boolean' } }, Infinity);
  // Without `--port` the lab takes its usual port, or a free one when that is taken.
  const port = given?.values.port === undefined ? undefined : Number(given.values.port || NaN);
  // The page's language when it is not to be the browser's: the flag, or without it what the environment names.
  const lang = given?.values.lang ?? (process.env.SAGENTS_LAB_LANG || undefined);
  if (!given || !(port === undefined || (Number.isInteger(port) && port >= 0 && port < 65536))) {
    console.error(USAGE);
    process.exitCode = 1;
  } else if (lang !== undefined && lang !== 'en' && lang !== 'ru') {
    console.error('failed: The lab\'s language is `en` or `ru`, by `--lang` or by SAGENTS_LAB_LANG; without either it is the remembered language, or else the browser\'s.');
    process.exitCode = 1;
  } else {
    const { LabError } = await import('../lab/data.ts');
    const named = given.positionals.length ? given.positionals : (process.env.SAGENTS_LAB ?? '').split(delimiter).filter(Boolean);
    try {
      const lab = await (await import('../lab/server.ts')).startLab({ dirs: named.length ? named : ['.'], port, log: line => console.error(line) });
      if (lab.moved) console.error(`port 4747 is taken: the lab is on port ${lab.port}`);
      // The first address: with the key after `#`, which the page keeps and takes out of the address, and with a
      // language that was chosen, which the page remembers too.
      const first = `${lab.url}${lang === undefined ? '' : `?language=${lang}`}#key=${lab.key}`;
      // The key must stay out of process arguments, which other local users can read.
      const opened = given.values['no-open'] === true ? null : (await import('../lab/open.ts')).openInBrowser(first);
      process.on('exit', () => opened?.remove());
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void lab.stop().then(() => process.exit(0)); });
      const handed = opened !== null && await opened.handed;
      if (!handed) opened?.remove();
      console.log(handed ? lab.url : first);
    } catch (error) {
      console.error(`failed: ${error instanceof LabError ? error.message : error instanceof Error && 'code' in error && typeof error.code === 'string' ? `cannot listen (${error.code})` : 'unexpected'}`);
      process.exitCode = 1;
    }
  }
} else if (command === 'ask') {
  // Programs depend on one JSON line even on failure; service words must not escape.
  try {
    const given = argumentsOf({ timeout: { type: 'string' } }, 0);
    const seconds = Number(given?.values.timeout ?? 180);
    if (!given || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new ModelError('invalid_request');
    const started = performance.now();
    const request = await requestFrom(process.stdin, AbortSignal.timeout(Math.floor(seconds * 1000)));
    const { respond, model } = modelFor(request.model);
    const result = await respond({ ...request, model }, { timeoutMs: Math.max(1, seconds * 1000 - (performance.now() - started)) });
    console.log(JSON.stringify({ status: 'done', ...result }));
  } catch (error) {
    console.log(JSON.stringify({ status: 'failed', ...detailsOf(error) }));
    process.exitCode = 1;
  }
} else if (command === 'eval') {
  let output: number | undefined, outputPath = '', written = false;
  try {
    const given = argumentsOf({ state: { type: 'string' }, world: { type: 'string' }, model: { type: 'string' }, ask: { type: 'string' },
      calls: { type: 'string' }, window: { type: 'string' }, out: { type: 'string' } }, 1);
    const calls = Number(given?.values.calls ?? 60), window = Number(given?.values.window ?? 6000);
    if (!given || !given.values.model || !given.values.ask || !Number.isSafeInteger(calls) || calls < 1 || !Number.isSafeInteger(window) || window < 1
      || !(given.positionals.length === 1 ? given.values.state === undefined && given.values.world === undefined : given.values.state && given.values.world)) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      const dir = given.positionals[0], worldPath = dir === undefined ? given.values.world as string : join(dir, 'world.json');
      const statePath = dir === undefined ? given.values.state as string : join(dir, 'state.sqlite');
      const jsonFile = (path: string, sentence: string) => {
        try { const text = readFileSync(path, 'utf8'); return { text, value: JSON.parse(text) as unknown }; } catch (error) {
          if (!(error instanceof SyntaxError) && !(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
          throw new EvalError(sentence);
        }
      };
      const world = jsonFile(worldPath, 'The world file cannot be read as JSON.');
      const questions = readQuestions(jsonFile(given.values.ask as string, 'The questions file cannot be read as JSON.').value);
      let environment = '';
      const name = isObject(world.value) && typeof world.value.environment === 'string' ? world.value.environment : null;
      if (name !== null && isEnvironmentName(name)) {
        try { environment = readFileSync(new URL(`../environments/${name}.json`, import.meta.url), 'utf8'); } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          // An absent environment leaves only the world file to compare; no state is changed here.
        }
      }
      const state = (await import('./state.ts')).readState(statePath, world.text, environment);
      if (typeof given.values.out === 'string') {
        try { output = openSync(outputPath = given.values.out, 'wx'); } catch (error) {
          if (!(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
          throw new EvalError('The report file cannot be made: it must be a new file in a directory that can be written.');
        }
      }
      const nameOfModel = given.values.model as string, player = modelFor(nameOfModel);
      const result = await runEval({ entries: state.entries, world: world.value, questions, ...player, name: nameOfModel, calls, window, cache: randomUUID(), worldCheck: state.world });
      const text = `${JSON.stringify(result)}\n`;
      if (output === undefined) process.stdout.write(text); else { writeFileSync(output, text); written = true; }
      const total = (field: 'input' | 'cached' | 'output') => result.usage.reduce((sum, row) => sum + (row[field] ?? 0), 0);
      const unreported = result.usage.filter(row => row.input === null && !row.error).length;
      const dropped = result.usage.reduce((sum, row) => sum + row.kept, 0) - result.findings.length;
      console.error(`${result.status}${result.reason ? ` (${result.reason})` : ''}: ${result.records} records, ${result.shown} shown, ${result.findings.length} findings, ${dropped} taken back, ${Object.values(result.refused).reduce((a, b) => a + b, 0)} refused, ${result.calls} calls, ${result.invalid} invalid, ${total('input')} input tokens, ${total('cached')} of them cached, ${total('output')} output tokens${unreported ? `, without ${unreported} answers that reported no usage` : ''}`);
      if (result.status === 'failed') process.exitCode = 1;
    }
  } catch (error) {
    console.error(`failed: ${error instanceof EvalError || error instanceof StateError ? error.message : 'unexpected'}`);
    process.exitCode = 1;
  } finally {
    if (output !== undefined) {
      try {
        const empty = !written && fstatSync(output).size === 0;
        closeSync(output);
        if (empty) unlinkSync(outputPath);
      } catch {
        // Cleanup can leave an empty file, but cannot lose a report or replace the run's failure.
      }
    }
  }
} else if (command === 'evolve') {
  let close = () => {};
  try {
    const given = argumentsOf({ task: { type: 'string' }, model: { type: 'string' }, calls: { type: 'string' }, parallel: { type: 'string' }, tries: { type: 'string' },
      timeout: { type: 'string' } }, 1);
    const calls = Number(given?.values.calls), parallel = Number(given?.values.parallel ?? 1), tries = Number(given?.values.tries ?? 2);
    const timeout = Number(given?.values.timeout ?? 180);
    if (!given || given.positionals.length !== 1 || !given.values.task || !given.values.model || !Number.isSafeInteger(calls) || calls < 1
      || !Number.isSafeInteger(parallel) || parallel < 1 || parallel > 16 || !Number.isSafeInteger(tries) || tries < 0 || tries > 10
      || !(timeout >= 1 && timeout <= 3600)) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      const { EvolveError, readTask, runEvolve } = await import('./evolve.ts'), { keepEvolve, runEvaluator } = await import('./evolve-kept.ts');
      // An evaluator is stopped with its process group, which Windows does not have.
      if (process.platform === 'win32') throw new EvolveError('evolve runs on Linux and macOS, where an evaluator is stopped with its process group.');
      const taskPath = given.values.task as string, base = dirname(resolve(taskPath));
      let taskText: string, value: unknown;
      try { taskText = readFileSync(taskPath, 'utf8'); value = JSON.parse(taskText); } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
        throw new EvolveError('The task file cannot be read as JSON.');
      }
      const task = readTask(value);
      const kept = keepEvolve(given.positionals[0], taskText, base);
      close = kept.close;
      // The seed is read only for a run that has nothing yet, so that a kept run goes on without it.
      let seed: string | undefined;
      if (task.file !== null && !kept.store.candidates.length) {
        try { seed = readFileSync(resolve(base, task.file), 'utf8'); } catch (error) {
          if (!(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
          throw new EvolveError('The task\'s `file` cannot be read; it is a path from the task file\'s directory.');
        }
      }
      if (kept.unreadable) console.error(`${kept.unreadable} cut or unreadable lines in the kept files were skipped`);
      const stop = new AbortController();
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
      const result = await runEvolve({ task, store: kept.store, ...modelFor(given.values.model as string), calls, parallel, tries, timeoutMs: timeout * 1000, cache: kept.cache, seed, signal: stop.signal,
        // The evaluator's command runs from the task file's directory, as its paths are written there.
        evaluate: (sha, signal) => runEvaluator(task, kept.path(sha), base, signal),
        // A family is shown by its number: its name is the model's words, which go only into the archive.
        onCandidate: candidate => console.error(`#${candidate.id} ${candidate.kind} ${candidate.family}${candidate.parent === null ? '' : ` from #${candidate.parent}`}: ${
          candidate.valid ? `score ${candidate.score}, cell ${candidate.cell}` : 'not valid'}${candidate.same === null ? '' : `, as #${candidate.same}`}`) });
      console.log(JSON.stringify(result));
      if (result.status === 'failed') process.exitCode = 1;
    }
  } catch (error) {
    const { EvolveError } = await import('./evolve.ts');
    console.error(`failed: ${error instanceof EvolveError ? error.message : 'unexpected'}`);
    process.exitCode = 1;
  } finally { close(); }
} else if (command === 'evolve-map') {
  try {
    const given = argumentsOf({}, 1);
    if (!given || given.positionals.length !== 1) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      const { evolveMap, readEvolveRun } = await import('./evolve-map.ts');
      process.stdout.write(evolveMap(readEvolveRun(given.positionals[0])));
    }
  } catch (error) {
    const { EvolveError } = await import('./evolve.ts');
    console.error(`failed: ${error instanceof EvolveError ? error.message : 'unexpected'}`);
    process.exitCode = 1;
  }
} else if (command === 'live') {
  try {
    const given = argumentsOf({ model: { type: 'string' }, cast: { type: 'string', multiple: true }, 'world-model': { type: 'string' }, minutes: { type: 'string' }, calls: { type: 'string' }, tokens: { type: 'string' },
      state: { type: 'string' }, run: { type: 'string' }, 'untaken-text': { type: 'boolean' }, environment: { type: 'string' }, json: { type: 'boolean' } }, 1);
    const minutes = Number(given?.values.minutes ?? 30);
    const calls = Number(given?.values.calls ?? 60);
    const ceiling = given?.values.tokens === undefined ? undefined : Number(given.values.tokens);
    if (!given || given.positionals.length !== 1 || !(minutes > 0 && minutes <= 1440) || !(Number.isInteger(calls) && calls >= 1)
      || (ceiling !== undefined && !(Number.isSafeInteger(ceiling) && ceiling >= 1))) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      let source: string, parsed: unknown;
      try {
        source = readFileSync(given.positionals[0], 'utf8');
        parsed = JSON.parse(source);
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
        throw new WorldError('The world file cannot be read as JSON.');
      }
      const chosen = given.values.environment as string | undefined;
      if (chosen !== undefined && !isEnvironmentName(chosen)) throw new OptionError('`--environment` must be a name of lower-case letters, digits and `-`.');
      const name = chosen ?? environmentOf(parsed);
      let environmentSource: string | undefined, environment: unknown;
      if (name !== null) {
        try {
          environmentSource = readFileSync(new URL(`../environments/${name}.json`, import.meta.url), 'utf8');
          environment = JSON.parse(environmentSource);
        } catch (error) {
          if (!(error instanceof SyntaxError) && !(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
          const sentence = `The environment \`${name}\` cannot be read as JSON from \`environments/${name}.json\`.`;
          throw chosen === undefined ? new WorldError(sentence) : new OptionError(sentence);
        }
      }
      const world = readWorld(parsed, environment);
      const json = given.values.json === true;
      // Reject a bad cast before opening a state file or sending a request.
      const names = new Map<string, string>();
      for (const pair of (given.values.cast ?? []) as string[]) {
        const [id, name] = [pair.slice(0, Math.max(0, pair.indexOf('='))), pair.slice(pair.indexOf('=') + 1)];
        if (!id || !name) throw new OptionError('A `--cast` must be `<character id>=<model name>`.');
        if (!world.characters.some(character => character.id === id)) throw new OptionError(`A \`--cast\` names \`${id}\`, who is no character of the world file.`);
        if (names.has(id)) throw new OptionError(`Two \`--cast\` name \`${id}\`: a character is played by one model.`);
        names.set(id, name);
      }
      if (typeof given.values.state === 'string' && typeof given.values.run === 'string') throw new OptionError('`--state` and `--run` cannot be given together: a run directory keeps its own state file.');
      if (given.values['untaken-text'] === true && typeof given.values.run !== 'string') throw new OptionError('`--untaken-text` needs `--run`: the answer text is kept in the run directory.');
      const kept = typeof given.values.run === 'string' ? (await import('./kept.ts')).keepRun(given.values.run, source, environmentSource, given.values['untaken-text'] === true) : undefined;
      const state = kept?.state ?? (typeof given.values.state === 'string' ? (await import('./state.ts')).openState(given.values.state, source, environmentSource) : undefined);
      try {
        const players = new Map<string, Player>();
        const playerOf = (name: string) => {
          if (!players.has(name)) {
            const { respond, model } = modelFor(name), asks: Player['respond'] = request => respond(request);
            players.set(name, { respond: kept ? kept.count(asks) : asks, model, name });
          }
          return players.get(name)!;
        };
        const { seconds, ...totals } = await runLive({ world, ...playerOf((given.values.model as string | undefined) ?? LIVE_MODEL),
          cast: Object.fromEntries([...names].map(([id, name]) => [id, playerOf(name)])),
          worldPlayer: typeof given.values['world-model'] === 'string' ? playerOf(given.values['world-model']) : undefined, minutes, calls, tokens: ceiling, journal: state, pause: state !== undefined,
          // state.ts keeps the cache name across starts; an unsaved run needs its own.
          cache: state?.cache ?? randomUUID(), onAsk: kept?.onAsk, onUntaken: kept?.onUntaken,
          // Save the event before showing it so visible progress is already kept.
          onEvent: (event, by) => { kept?.onEvent(event); for (const line of json ? [JSON.stringify({ ...event, by })] : linesOf(world, event)) console.log(line); } });
        const played = Math.round(seconds / 6) / 10;
        const unreported = (count: number) => count ? `, without ${count} answers that reported no usage` : '';
        const tokens = (tally: { inputTokens: number; cachedInputTokens: number; outputTokens: number }) => `${tally.inputTokens} input tokens, ${tally.cachedInputTokens} of them cached, ${tally.outputTokens} output tokens`;
        const failure = { ...(totals.httpStatus ? { httpStatus: totals.httpStatus } : {}), ...(totals.providerCode ? { providerCode: totals.providerCode } : {}), ...(totals.param ? { param: totals.param } : {}) };
        console.log(json ? JSON.stringify({ status: totals.status, reason: totals.reason, ...failure, minutes: played, calls: totals.calls, invalid: totals.invalid, overlong: totals.overlong, declined: totals.declined,
          rewrites: totals.rewrites, lost: totals.lost, dropped: totals.dropped, again: totals.again, refused: totals.refused, unmoved: totals.unmoved, void: totals.void, causes: totals.causes, unreported: totals.unreported, inputTokens: totals.inputTokens, cachedInputTokens: totals.cachedInputTokens, outputTokens: totals.outputTokens, models: totals.models, kinds: totals.kinds, endpoints: totals.endpoints })
          : `${totals.status} (${[totals.reason, ...Object.values(failure)].join(' ')}): ${played} story minutes, ${totals.calls} calls, ${totals.invalid} invalid, ${totals.overlong} of them cut at the output limit, ${totals.declined} of them declined by the service, ${totals.rewrites} memory rewrites, ${
            totals.lost} lost, ${totals.refused} answers of the world refused, ${totals.void} deeds left with nothing, ${tokens(totals)}${unreported(totals.unreported)}`);
        if (!json) {
          const causes = (['turn', 'world', 'reply'] as const).map(kind => {
            const counts = UNTAKEN_CAUSES.filter(cause => totals.causes[kind][cause]).map(cause => `${cause} ${totals.causes[kind][cause]}`);
            return counts.length ? `${kind} ${counts.join(', ')}` : '';
          }).filter(Boolean);
          if (causes.length) console.log(`not taken: ${causes.join('; ')}`);
          if (totals.dropped) console.log(`memory dropped in ${totals.dropped} ${totals.dropped === 1 ? 'turn' : 'turns'}`);
          if (totals.again) console.log(`sent again after a connection that failed before any response: ${totals.again}`);
          if (totals.unmoved) console.log(`answers of the world taken without moves that moved nothing: ${totals.unmoved}`);
        }
        const models = Object.entries(totals.models);
        const answeredBy = (name: string) => Object.hasOwn(totals.endpoints, name) ? `, answered by ${Object.entries(totals.endpoints[name]).map(([endpoint, count]) => `${endpoint} ${count}`).join(', ')}` : '';
        if (!json && (models.length > 1 || Object.keys(totals.endpoints).length)) {
          for (const [name, tally] of models) {
            console.log(`  ${name}: ${tally.calls} calls, ${tally.invalid} invalid, ${tally.overlong} of them cut at the output limit, ${tally.declined} of them declined by the service, ${tokens(tally)}${unreported(tally.unreported)}${answeredBy(name)}`);
          }
        }
        const KINDS = { turn: 'turns', memory: 'memory rewrites', world: 'answers of the world' };
        if (!json) for (const [kind, tally] of Object.entries(totals.kinds)) console.log(`  ${KINDS[kind as keyof typeof KINDS]}: ${tally.calls} calls, ${tokens(tally)}`);
        if (totals.status === 'failed') process.exitCode = 1;
      } finally { state?.close(); }
    }
  } catch (error) {
    // Only our own error sentences may be shown; other messages could contain private text.
    const own = error instanceof WorldError || error instanceof JournalError || error instanceof StateError || error instanceof OptionError;
    console.error(`failed: ${own ? error.message : 'unexpected'}`);
    process.exitCode = 1;
  }
} else {
  try {
    const given = command === 'login' ? argumentsOf({ new: { type: 'boolean' } }, 0) : command === 'status' ? argumentsOf({}, 1) : null;
    if (!given) {
      console.error(USAGE);
      process.exitCode = 1;
    } else if (command === 'login') {
      const { planUse } = await signIn({ register: given.values.new === true });
      if (!planUse) console.log('Signed in, but without the permission to use the ChatGPT plan: run the command again and allow it.');
      await report(createChatgpt(), DEFAULT_MODEL);
    } else await report(createChatgpt(), given.positionals[0] ?? DEFAULT_MODEL);
  } catch (error) {
    const { reason, ...more } = detailsOf(error);
    const details = Object.values(more).join(' ');
    console.error(`failed: ${error instanceof SignInError ? error.message : error instanceof ModelError ? `${reason}${details ? ` (${details})` : ''}` : 'unexpected'}`);
    process.exitCode = 1;
  }
}
