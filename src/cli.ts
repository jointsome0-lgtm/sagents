import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createChatgpt, ModelError, signIn, SignInError } from './chatgpt.ts';
import type { Message, Request } from './chatgpt.ts';
import { JournalError, StateError } from './journal.ts';
import { linesOf, runLive } from './live.ts';
import type { Player } from './live.ts';
import { modelFor } from './model.ts';
import { environmentOf, isEnvironmentName, readWorld } from './laws.ts';
import { WorldError } from './world.ts';

const USAGE = `node src/cli.ts login [--new]          sign in with ChatGPT in the browser; --new registers this tool again
node src/cli.ts status [<model>]       whether this computer is signed in, and whether the plan's list of models has the model
node src/cli.ts ask [--timeout <s>]    one request as JSON on stdin, one JSON line on stdout
node src/cli.ts live <world.json> [--model <id>] [--cast <character>=<id>]... [--world-model <id>] [--minutes <n>] [--calls <n>] [--state <file>]
                          [--environment <name>] [--json]
                                       the characters of a world file, each played by the model, under the story's clock;
                                       --cast gives one character a model of its own; --world-model answers what comes of a deed;
                                       with --state the world is kept in that file and continues from it

A request: {"model": "<id>", "<id>@<effort>" or "api:<id>", "system": "...", "messages": [{"role": "user", "content": "..."}], "schema": {...}}
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
    || (value.schema !== undefined && !isObject(value.schema))) throw new ModelError('invalid_request');
  return { model: value.model, system: value.system, messages: value.messages, schema: value.schema };
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

const chatgpt = createChatgpt();
if (command === 'ask') {
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
} else if (command === 'live') {
  try {
    const given = argumentsOf({ model: { type: 'string' }, cast: { type: 'string', multiple: true }, 'world-model': { type: 'string' }, minutes: { type: 'string' }, calls: { type: 'string' },
      state: { type: 'string' }, environment: { type: 'string' }, json: { type: 'boolean' } }, 1);
    const minutes = Number(given?.values.minutes ?? 30);
    const calls = Number(given?.values.calls ?? 60);
    if (!given || given.positionals.length !== 1 || !(minutes > 0 && minutes <= 1440) || !(Number.isInteger(calls) && calls >= 1)) {
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
      // The state file's module is loaded only for a run that keeps one. Such a run is a pause in the world's story.
      const state = typeof given.values.state === 'string' ? (await import('./state.ts')).openState(given.values.state, source, environmentSource) : undefined;
      try {
        // The model's name picks the connection, as it does for `ask`.
        // One connection for each name, however many characters it plays.
        const players = new Map<string, Player>();
        const playerOf = (name: string) => {
          if (!players.has(name)) {
            const { respond, model } = modelFor(name);
            players.set(name, { respond: request => respond(request), model, name });
          }
          return players.get(name)!;
        };
        const { seconds, ...totals } = await runLive({ world, ...playerOf((given.values.model as string | undefined) ?? LIVE_MODEL),
          cast: Object.fromEntries([...names].map(([id, name]) => [id, playerOf(name)])),
          worldPlayer: typeof given.values['world-model'] === 'string' ? playerOf(given.values['world-model']) : undefined, minutes, calls, journal: state, pause: state !== undefined,
          onEvent: (event, by) => { for (const line of json ? [JSON.stringify({ ...event, by })] : linesOf(world, event)) console.log(line); } });
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
    // These sentences are this tool's own: about the world file, the state file, the journal in it and the options.
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
      await report(chatgpt, DEFAULT_MODEL);
    } else await report(chatgpt, given.positionals[0] ?? DEFAULT_MODEL);
  } catch (error) {
    // Codes or one of this tool's own sentences; never an answer of the service.
    const { reason, ...more } = detailsOf(error);
    const details = Object.values(more).join(' ');
    console.error(`failed: ${error instanceof SignInError ? error.message : error instanceof ModelError ? `${reason}${details ? ` (${details})` : ''}` : 'unexpected'}`);
    process.exitCode = 1;
  }
}
