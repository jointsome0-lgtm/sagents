#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createChatgpt, ModelError, signIn, SignInError } from './chatgpt.ts';
import type { Message, Request } from './chatgpt.ts';
import { JournalError, StateError } from './journal.ts';
import { linesOf, runLive } from './live.ts';
import type { Player } from './live.ts';
import { modelFor } from './model.ts';
import { environmentOf, isEnvironmentName, readWorld } from './laws.ts';
import { WorldError } from './world.ts';
import { EvalError, readQuestions, runEval } from './eval.ts';

// The command is `sagents` once the package is linked, and `node src/cli.ts` from a checkout: the same arguments.
const USAGE = `sagents login [--new]          sign in with ChatGPT in the browser; --new registers this tool again
sagents status [<model>]       whether this computer is signed in, and whether the plan's list of models has the model
sagents ask [--timeout <s>]    one request as JSON on stdin, one JSON line on stdout
sagents live <world.json> [--model <id>] [--cast <character>=<id>]... [--world-model <id>] [--minutes <n>] [--calls <n>] [--tokens <n>]
                  [--state <file> | --run <dir>] [--environment <name>] [--json]
                               the characters of a world file, each played by the model, under the story's clock;
                               --cast gives one character a model of its own; --world-model answers what comes of a deed;
                               with --state the world is kept in that file and continues from it;
                               with --run it is kept in that directory as an experiment the lab reads: the world file,
                               the state, and for every start a stretch of events and of rows that count its requests
sagents eval <dir> --model <id> --ask <questions.json> [--calls <n>] [--window <words>] [--out <file>]
sagents eval --state <file> --world <world.json> --model <id> --ask <questions.json> [--calls <n>] [--window <words>] [--out <file>]
                               a judge reads a finished live journal with log, show and diff, and gives a report
sagents numbers <dir>... [--json]
                               the story's time, actions and requests counted from kept files, with no model
sagents lab [<dir>...] [--port <n>] [--lang <en|ru>] [--no-open]
                               the lab in the browser: the experiments under the directories, or under those that
                               SAGENTS_LAB names (separated as in PATH), or under the current one; it prints its address
                               on this computer and opens it unless --no-open is given; Ctrl+C stops it; the page is
                               in the language of --lang, or of SAGENTS_LAB_LANG, or else of the browser
sagents help                   this text

Without the command installed, \`node src/cli.ts\` takes the same arguments.

A request: {"model": "<id>", "<id>@<effort>" or "api:<id>", "system": "...", "messages": [{"role": "user", "content": "..."}], "schema": {...}, "cache": "<name>"}
An answer: {"status": "done", "text": "...", "usage": {...}}, with "endpoint" when a router named who answered, or {"status": "failed", "reason": "<code>"}
A failed answer also has "httpStatus", "providerCode" and "param" when the service gave them.
"api:<id>" is a model of the chat completions server that SAGENTS_API_URL names, with SAGENTS_API_KEY if it asks for one.`;
const DEFAULT_MODEL = 'gpt-6.1-sol';
const LIVE_MODEL = 'gpt-6.1-sol@low';
const MAX_REQUEST = 16_000_000;
// The sentences about an option of `live` that cannot be used; they are this file's own and may be shown.
class OptionError extends Error {}

const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
const isMessage = (value: unknown): value is Message =>
  isObject(value) && (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string';

// A request comes through stdin and never through arguments, which other local users can read in the process list.
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

// What may be said about a failure: this tool's code, the HTTP status, and the service's own code and field name.
const detailsOf = (error: unknown) => error instanceof ModelError
  ? { reason: error.code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...(error.providerCode ? { providerCode: error.providerCode } : {}), ...(error.param ? { param: error.param } : {}) }
  : { reason: 'internal_error' };

// Whether this computer is signed in. For a signed-in account it also asks the service which models the plan offers,
// which may refresh the tokens on the way.
async function report(chatgpt: ReturnType<typeof createChatgpt>, name: string) {
  const status = chatgpt.status();
  console.log(`signed in: ${status.signedIn ? 'yes' : 'no'}; plan use: ${status.planUse ? 'allowed' : 'not allowed'}; access token: ${status.minutesLeft} min left`);
  if (!status.signedIn || !status.planUse) return;
  const offered = await chatgpt.models();
  const model = name.split('@')[0];
  // The list is not the set of names a request takes, so a name that is not in it is not said to be refused.
  console.log(`models in the plan's list: ${offered.length}; ${model}: ${offered.includes(model) ? 'in the list' : 'not in the list, which does not say that a request with it fails'}`);
}

const [command, ...rest] = process.argv.slice(2);
// The options of one command and up to so many other arguments, or null when it was given something it does not take.
function argumentsOf(options: { [name: string]: { type: 'boolean' | 'string'; multiple?: boolean } }, others: number) {
  try {
    const parsed = parseArgs({ args: rest, options, allowPositionals: others > 0 });
    return parsed.positionals.length <= others ? parsed : null;
  } catch { return null; }
}

if (command === 'help' || command === '--help' || command === '-h') console.log(USAGE);
else if (command === 'numbers') {
  const given = argumentsOf({ json: { type: 'boolean' } }, Infinity);
  if (!given || !given.positionals.length) { console.error(USAGE); process.exitCode = 1; }
  else {
    const { NumbersError, numbersOf, numbersTable, numbersJSON } = await import('./numbers.ts');
    const runs: ReturnType<typeof numbersOf>[] = [];
    for (const dir of given.positionals) {
      try {
        const run = numbersOf(dir), name = run.name;
        for (let n = 2; runs.some(other => other.name === run.name); n += 1) run.name = `${name} (${n})`;
        runs.push(run);
      } catch (error) {
        if (!(error instanceof NumbersError)) throw error;
        console.error(`${JSON.stringify(dir)}: ${error.message}`);
        process.exitCode = 1;
      }
    }
    console.log(given.values.json === true ? JSON.stringify(numbersJSON(runs)) : numbersTable(runs));
  }
} else if (command === 'lab') {
  // The lab reads files and asks no model. Its modules are loaded only for this command.
  const given = argumentsOf({ port: { type: 'string' }, lang: { type: 'string' }, 'no-open': { type: 'boolean' } }, Infinity);
  const port = Number(given?.values.port ?? 0);
  // The page's language when it is not to be the browser's: the flag, or without it what the environment names.
  const lang = given?.values.lang ?? (process.env.SAGENTS_LAB_LANG || undefined);
  if (!given || !(Number.isInteger(port) && port >= 0 && port < 65536)) {
    console.error(USAGE);
    process.exitCode = 1;
  } else if (lang !== undefined && lang !== 'en' && lang !== 'ru') {
    console.error('failed: The lab\'s language is `en` or `ru`, by `--lang` or by SAGENTS_LAB_LANG; without either it is the browser\'s.');
    process.exitCode = 1;
  } else {
    const { LabError } = await import('../lab/data.ts');
    // The roots: the directories given, or those the environment names, or the current one.
    const named = given.positionals.length ? given.positionals : (process.env.SAGENTS_LAB ?? '').split(delimiter).filter(Boolean);
    try {
      const lab = await (await import('../lab/server.ts')).startLab({ dirs: named.length ? named : ['.'], port, log: line => console.error(line) });
      // A language that was chosen goes with the address, for the page to read: the server looks at the path alone.
      const url = lang === undefined ? lab.url : `${lab.url}?lang=${lang}`;
      console.log(url);
      // The address holds the lab's token and so goes to the browser in a file, never as an argument of a process.
      // A computer with no browser to open is no failure: the address is on the screen.
      const opened = given.values['no-open'] === true ? null : (await import('../lab/open.ts')).openInBrowser(url);
      process.on('exit', () => opened?.remove());
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void lab.stop().then(() => process.exit(0)); });
    } catch (error) {
      // A root that is no directory is said in this tool's own sentence, a port that cannot be had by its code.
      console.error(`failed: ${error instanceof LabError ? error.message : error instanceof Error && 'code' in error && typeof error.code === 'string' ? `cannot listen (${error.code})` : 'unexpected'}`);
      process.exitCode = 1;
    }
  }
} else if (command === 'ask') {
  // The caller is a program: one JSON line whatever happens, with codes and nothing of the service's own words.
  try {
    const given = argumentsOf({ timeout: { type: 'string' } }, 0);
    const seconds = Number(given?.values.timeout ?? 180);
    if (!given || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new ModelError('invalid_request');
    // The time limit covers the reading of the request too.
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
          // An environment absent from this checkout leaves only the world file to compare.
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
} else if (command === 'live') {
  try {
    const given = argumentsOf({ model: { type: 'string' }, cast: { type: 'string', multiple: true }, 'world-model': { type: 'string' }, minutes: { type: 'string' }, calls: { type: 'string' }, tokens: { type: 'string' },
      state: { type: 'string' }, run: { type: 'string' }, environment: { type: 'string' }, json: { type: 'boolean' } }, 1);
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
      // The environment is the one `--environment` names, or else the one the world file names, or none. Its file is
      // one of this program's own, `environments/<name>.json`.
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
      // Who is played by a model of its own. What is wrong with a `--cast` is said before anything is opened or sent.
      const names = new Map<string, string>();
      for (const pair of (given.values.cast ?? []) as string[]) {
        const [id, name] = [pair.slice(0, Math.max(0, pair.indexOf('='))), pair.slice(pair.indexOf('=') + 1)];
        if (!id || !name) throw new OptionError('A `--cast` must be `<character id>=<model name>`.');
        if (!world.characters.some(character => character.id === id)) throw new OptionError(`A \`--cast\` names \`${id}\`, who is no character of the world file.`);
        if (names.has(id)) throw new OptionError(`Two \`--cast\` name \`${id}\`: a character is played by one model.`);
        names.set(id, name);
      }
      if (typeof given.values.state === 'string' && typeof given.values.run === 'string') throw new OptionError('`--state` and `--run` cannot be given together: a run directory keeps its own state file.');
      // The state file's module is loaded only for a run that keeps one. Such a run is a pause in the world's story.
      // A run directory keeps the state too, and beside it what the lab reads: the events and a row for every request.
      const kept = typeof given.values.run === 'string' ? (await import('./kept.ts')).keepRun(given.values.run, source, environmentSource) : undefined;
      const state = kept?.state ?? (typeof given.values.state === 'string' ? (await import('./state.ts')).openState(given.values.state, source, environmentSource) : undefined);
      try {
        // The model's name picks the connection, as it does for `ask`.
        // One connection for each name, however many characters it plays.
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
          // The players' names for a service's cache are made of the state file's own, and of one made here for a run that keeps no file.
          cache: state?.cache ?? randomUUID(), onAsk: kept?.onAsk,
          // A kept run has the event in its file before anyone is shown it.
          onEvent: (event, by) => { kept?.onEvent(event); for (const line of json ? [JSON.stringify({ ...event, by })] : linesOf(world, event)) console.log(line); } });
        const played = Math.round(seconds / 6) / 10;
        // Tokens are a sum over the answers that reported them, and the line says when some did not.
        const unreported = (count: number) => count ? `, without ${count} answers that reported no usage` : '';
        const tokens = (tally: { inputTokens: number; cachedInputTokens: number; outputTokens: number }) => `${tally.inputTokens} input tokens, ${tally.cachedInputTokens} of them cached, ${tally.outputTokens} output tokens`;
        // What a failed run may say of its failure, as `detailsOf` says it of one request.
        const failure = { ...(totals.httpStatus ? { httpStatus: totals.httpStatus } : {}), ...(totals.providerCode ? { providerCode: totals.providerCode } : {}), ...(totals.param ? { param: totals.param } : {}) };
        console.log(json ? JSON.stringify({ status: totals.status, reason: totals.reason, ...failure, minutes: played, calls: totals.calls, invalid: totals.invalid, overlong: totals.overlong, declined: totals.declined,
          rewrites: totals.rewrites, lost: totals.lost, refused: totals.refused, void: totals.void, unreported: totals.unreported, inputTokens: totals.inputTokens, cachedInputTokens: totals.cachedInputTokens, outputTokens: totals.outputTokens, models: totals.models, kinds: totals.kinds, endpoints: totals.endpoints })
          : `${totals.status} (${[totals.reason, ...Object.values(failure)].join(' ')}): ${played} story minutes, ${totals.calls} calls, ${totals.invalid} invalid, ${totals.overlong} of them cut at the output limit, ${totals.declined} of them declined by the service, ${totals.rewrites} memory rewrites, ${
            totals.lost} lost, ${totals.refused} answers of the world refused, ${totals.void} deeds left with nothing, ${tokens(totals)}${unreported(totals.unreported)}`);
        const models = Object.entries(totals.models);
        // A model whose router said which of its endpoints answered has its line also when it played alone.
        const answeredBy = (name: string) => Object.hasOwn(totals.endpoints, name) ? `, answered by ${Object.entries(totals.endpoints[name]).map(([endpoint, count]) => `${endpoint} ${count}`).join(', ')}` : '';
        if (!json && (models.length > 1 || Object.keys(totals.endpoints).length)) {
          for (const [name, tally] of models) {
            console.log(`  ${name}: ${tally.calls} calls, ${tally.invalid} invalid, ${tally.overlong} of them cut at the output limit, ${tally.declined} of them declined by the service, ${tokens(tally)}${unreported(tally.unreported)}${answeredBy(name)}`);
          }
        }
        // What the requests were for: the turns of residents, the memories written anew and the answers of the world.
        const KINDS = { turn: 'turns', memory: 'memory rewrites', world: 'answers of the world' };
        if (!json) for (const [kind, tally] of Object.entries(totals.kinds)) console.log(`  ${KINDS[kind as keyof typeof KINDS]}: ${tally.calls} calls, ${tokens(tally)}`);
        if (totals.status === 'failed') process.exitCode = 1;
      } finally { state?.close(); }
    }
  } catch (error) {
    // These sentences are this tool's own: about the world file, the state file or the run directory that keeps one,
    // the journal in it and the options.
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
    // Codes or one of this tool's own sentences; never an answer of the service.
    const { reason, ...more } = detailsOf(error);
    const details = Object.values(more).join(' ');
    console.error(`failed: ${error instanceof SignInError ? error.message : error instanceof ModelError ? `${reason}${details ? ` (${details})` : ''}` : 'unexpected'}`);
    process.exitCode = 1;
  }
}
