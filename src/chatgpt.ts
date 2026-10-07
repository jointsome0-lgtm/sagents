import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// GPT on a ChatGPT plan, with no API key and no coding agent in between: OpenAI's "Sign in with ChatGPT" for
// open-source and locally run tools (developers.openai.com/siwc/token-sharing-open-source). The person signs in once
// in a browser, this tool becomes a client registered to that person, and its requests to the public Responses API
// count against the plan. A request holds the instructions, the messages and the schema it was given and nothing else.
const AUTH = 'https://auth.openai.com';
const AUTHORIZE = `${AUTH}/api/accounts/authorize`;
const TOKEN = `${AUTH}/api/accounts/oauth/token`;
const KEYS = `${AUTH}/.well-known/jwks.json`;
const API = 'https://api.openai.com/v1';
const CALLBACK = '/auth/callback';
// The first sign-in asks for a registration under this id and gets the person's own client id back.
const REGISTER = 'dynamic_agent_client';
const APP_NAME = 'sagents';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
// What the documentation names as a refresh token that will never work again.
const SPENT = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated',
  'refresh_token_reused'];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const PASSIVE_ITEMS = ['message', 'reasoning'];
// An access token lives an hour; one with less than this left is replaced before a request starts.
const MARGIN_MS = 5 * 60_000;
const GRANT_TIMEOUT_MS = 30_000;
// Longer than any holder of the lock needs: a refresh has GRANT_TIMEOUT_MS and then writes one small file.
const HOLD_MS = 60_000;
const LOCK_WAIT_MS = 90_000;
const MAX_STREAM = 16_000_000;
const MAX_TEXT = 100_000;

export const ACCOUNT_PATH = join(homedir(), '.config', 'sagents', 'chatgpt.json');

// A failure is a code and, where there was one, an HTTP status. The text of an answer is never carried: it may quote
// the request or hold a token. The service's own code and the request field it names are carried when they are plain
// identifiers, because they say which field the plan's route refused.
const PROVIDER_CODE = /^[a-z][a-z0-9_]{0,79}$/;
const PARAM = /^[A-Za-z_][\w.[\]]{0,79}$/;
export class ModelError extends Error {
  code: string;
  httpStatus: number | undefined;
  providerCode: string | undefined;
  param: string | undefined;
  constructor(code: string, httpStatus?: number, providerCode?: unknown, param?: unknown) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerCode = typeof providerCode === 'string' && PROVIDER_CODE.test(providerCode) ? providerCode : undefined;
    this.param = typeof param === 'string' && PARAM.test(param) ? param : undefined;
  }
}
// The sentences of a sign-in that went wrong; they are this file's own and may be shown.
export class SignInError extends Error {}

export type Message = { role: 'user' | 'assistant'; content: string };
// `model` is `<id>` or `<id>@<effort>`; `schema` is a JSON Schema the answer must follow, in OpenAI's strict form.
// `cache` is a name the caller made up for whoever the request is one of, so that a service which keeps the
// beginnings of requests it has read can bring one player's requests to the same place. It is `CACHE` and holds
// nothing of the text; a request that has none is sent with none, since no connection makes one up.
export type Request = { model: string; system?: string; messages: Message[]; schema?: object; cache?: string };
// A name of that kind goes into headers, so it is letters, digits, `-` and `_`, as many as the service's key takes.
export const CACHE = /^[A-Za-z0-9_-]{1,64}$/;
export type Usage = { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null };
// An answer is whole or it is a failure: one that the model's own limit cut short is `output_limit`. `endpoint` is
// the name a router gave to whoever answered, when the connection learned one: `ENDPOINT` is all a name may be, and a
// name that is anything else is `OTHER_ENDPOINT`.
export type Result = { text: string; usage: Usage | null; endpoint?: string };
export const ENDPOINT = /^[A-Za-z0-9 ./_-]{1,40}$/, OTHER_ENDPOINT = 'other';
// `onText` is handed the text as it arrives: of the plan's stream each piece at once, before the answer is known to be
// whole and to come from the model asked for, so a call that then fails may have handed over a part; of an `api:`
// server the whole text once, after its checks, or with SAGENTS_API_STREAM each piece at once like the plan's. Only
// what a call returns is an answer.
export type Controls = { signal?: AbortSignal; onText?: (delta: string) => unknown; timeoutMs?: number };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
// What a sign-in leaves on this computer, in a file only its owner can read. `hostId` names this installation to
// OpenAI and is no secret; `clientId` is the registration the person approved; `subject` is the account it belongs
// to. The ID token and the email are not kept: nothing here needs to know who the person is. `declined`: the plan
// permission was missing the last time, so the next sign-in asks for it again.
type Account = { hostId: string; clientId?: string; subject?: string; accessToken?: string; refreshToken?: string;
  expiresAt?: number; scopes?: string[]; declined?: boolean };
type Failure = { code?: unknown; param?: unknown } | null;
type StreamEvent = {
  type?: unknown; delta?: unknown; code?: unknown; param?: unknown; error?: Failure; item?: { type?: unknown } | null;
  response?: {
    model?: unknown; error?: Failure; incomplete_details?: { reason?: unknown } | null; output?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } | null;
      output_tokens_details?: { reasoning_tokens?: unknown } | null } | null;
  } | null;
};

const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object';
const filled = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const errnoOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

// The saved account, or null where there is none yet. A file that is there and cannot be read or understood is a
// failure and never a reason to start over: starting over would write a new account on top of it.
function load(path: string): Account | null {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    if (errnoOf(error) === 'ENOENT') return null;
    throw new ModelError('storage_failed');
  }
  const hostId = isObject(value) ? filled(value.hostId) : undefined;
  if (!isObject(value) || !hostId) throw new ModelError('storage_failed');
  return { hostId, clientId: filled(value.clientId), subject: filled(value.subject), accessToken: filled(value.accessToken),
    refreshToken: filled(value.refreshToken), expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : undefined,
    scopes: Array.isArray(value.scopes) ? value.scopes.filter(scope => typeof scope === 'string') : undefined,
    declined: value.declined === true ? true : undefined };
}

// Written whole, flushed and renamed into place: a refresh replaces both tokens together or not at all. Every caller
// holds the lock. What no file can cover is the moment between the service's answer to a refresh and this rename: a
// process that dies there leaves a spent refresh token behind, and the next call asks for a new sign-in.
function save(path: string, account: Account) {
  const draft = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(draft, JSON.stringify(account), { mode: 0o600, flag: 'wx', flush: true });
    renameSync(draft, path);
  } catch {
    try { rmSync(draft, { force: true }); } catch { /* nothing was written */ }
    throw new ModelError('storage_failed');
  }
  // The new name reaches the disk with its folder. Only a file system that cannot flush a folder at all is let pass.
  try {
    const folder = openSync(dirname(path), 'r');
    try { fsyncSync(folder); } finally { closeSync(folder); }
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'ENOSYS', 'EISDIR', 'EPERM'].includes(errnoOf(error) ?? '')) throw new ModelError('storage_failed');
  }
}

// For a pair that has just replaced a spent refresh token: it is tried again before the failure is said.
async function keep(path: string, account: Account) {
  for (let attempt = 1; ; attempt++) {
    try { return save(path, account); } catch (error) {
      if (attempt === 3) throw error;
      await sleep(200);
    }
  }
}

// An answer of the sign-in service, or of the API outside a stream. Only named fields of it are ever read.
async function jsonOf(response: Response, limit = 2_000_000): Promise<unknown> {
  if (!response.body) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > limit) return null;
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

const errorCodeOf = (body: unknown) => !isObject(body) ? undefined
  : typeof body.error === 'string' ? body.error : isObject(body.error) ? body.error.code : body.code;
const paramOf = (body: unknown) => isObject(body) && isObject(body.error) ? body.error.param : undefined;

// Complete server-sent events, including UTF-8 characters split across chunks.
async function* events(body: Response['body'], limit: number) {
  if (!body) throw new ModelError('invalid_stream');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new ModelError('output_limit');
    buffer += decoder.decode(chunk, { stream: true });
    let end: RegExpExecArray | null;
    while ((end = /\r?\n\r?\n/.exec(buffer))) {
      const event = buffer.slice(0, end.index);
      buffer = buffer.slice(end.index + end[0].length);
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (data) yield data;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new ModelError('invalid_stream');
}

// One call of the token endpoint: the code of a sign-in for tokens, or a refresh token for the next pair. It has a
// time limit of its own and no other way to stop: once the service has replaced a refresh token, the pair must be
// saved. The service's code goes along with a refusal, and the caller tells a spent token from a refused client by it.
async function grant(fetcher: Fetch, fields: Record<string, string>) {
  let response: Response;
  try {
    response = await fetcher(TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...fields, resource: API }).toString() });
  } catch { throw new ModelError('provider_failed'); }
  const body = await jsonOf(response).catch(() => null);
  const code = errorCodeOf(body);
  if (!response.ok) throw new ModelError(SPENT.includes(code as string) || code === 'invalid_client' ? 'unauthorized' : 'provider_failed', response.status, code);
  if (!isObject(body) || !filled(body.access_token) || !filled(body.refresh_token) || typeof body.expires_in !== 'number'
    || !(body.expires_in > 0)) throw new ModelError('invalid_response');
  return body;
}

// A refresh that names no scopes keeps the ones the person granted.
const withTokens = (account: Account, tokens: { readonly [field: string]: unknown }, now: number): Account => ({
  hostId: account.hostId, clientId: account.clientId, subject: account.subject,
  accessToken: tokens.access_token as string, refreshToken: tokens.refresh_token as string,
  expiresAt: now + (tokens.expires_in as number) * 1000,
  scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : account.scopes ?? [],
});

// Refresh tokens rotate: a second refresh with a spent one ends the session. So the processes of this computer take
// turns through a lock, and read the account again once they hold it. The lock is a symbolic link: it can be made only
// where there is none, and its target names its holder. A holder that died leaves its lock behind, and neither the
// lock's age nor a process number shows that reliably: the computer may have slept, and a sandbox numbers its
// processes anew. So a waiter takes a lock over only after it has seen the same one for longer than any holder needs,
// by a clock that stands still while the computer sleeps.
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`, mine = randomUUID();
  try { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); } catch { throw new ModelError('storage_failed'); }
  const started = performance.now();
  let seen: string | undefined, since = started;
  for (;;) {
    try { symlinkSync(mine, lock); break; } catch (error) {
      if (errnoOf(error) !== 'EEXIST') throw new ModelError('storage_failed');
    }
    const now = performance.now();
    if (now - started > LOCK_WAIT_MS) throw new ModelError('timeout');
    // '' stands for something that is no link at all, watched like a holder without a name; undefined for a lock that
    // vanished between the two looks.
    let holder: string | undefined;
    try { holder = readlinkSync(lock); } catch (error) {
      if (errnoOf(error) === 'EINVAL') holder = '';
      else if (errnoOf(error) !== 'ENOENT') throw new ModelError('storage_failed');
    }
    if (holder === undefined || holder !== seen) { seen = holder; since = now; }
    else if (now - since > HOLD_MS) { takeOver(lock, holder, mine); seen = undefined; continue; }
    await sleep(holder === undefined ? 10 : 100);
  }
  let result: T;
  try { result = await fn(); } catch (error) {
    release(lock, mine, false);
    throw error;
  }
  release(lock, mine, true);
  return result;
}

// Takes away the lock of a holder that is gone. Renaming moves it out from under every waiter at once, and only a
// link that names the watched holder is then removed. A lock made in between belongs to a live holder and gets its
// name back, unless another lock stands there by now. Anything that is no link, or cannot be read, is never deleted:
// it goes back under a second name or stays under the new one. One case stays open: a third process making its own
// lock in the microseconds before a lock is put back.
function takeOver(lock: string, holder: string, mine: string) {
  const taken = `${lock}.${mine}`;
  try { renameSync(lock, taken); } catch (error) {
    // The holder let it go, or another waiter was first.
    if (errnoOf(error) === 'ENOENT') return;
    throw new ModelError('storage_failed');
  }
  let moved: string | undefined;
  try { moved = readlinkSync(taken); } catch (error) {
    if (errnoOf(error) === 'EINVAL') moved = '';
  }
  try {
    if (moved) {
      if (moved !== holder) {
        try { symlinkSync(moved, lock); } catch (error) {
          if (errnoOf(error) !== 'EEXIST') throw error;
        }
      }
      unlinkSync(taken);
      return;
    }
    // What was watched as no link stays under its new name, out of the way.
    if (moved === holder) return;
    // No link where one was watched, or an entry that cannot be read: put back, and a failure either way.
    linkSync(taken, lock);
    unlinkSync(taken);
  } catch { /* what could not be put back stays under the new name */ }
  throw new ModelError('storage_failed');
}

// A holder removes only its own lock: one that was taken over is someone else's by now. A lock that cannot be removed
// is a failure when the work itself went well, and stays behind the work's own failure otherwise.
function release(lock: string, mine: string, strict: boolean) {
  try { if (readlinkSync(lock) === mine) unlinkSync(lock); } catch (error) {
    if (strict && errnoOf(error) !== 'ENOENT' && errnoOf(error) !== 'EINVAL') throw new ModelError('storage_failed');
  }
}

// The body of one request, whole: a caller that stores its hash can say exactly what the model saw.
export function responsesBody(request: Request) {
  const [model, effort, ...more] = request.model.split('@');
  if (!model || more.length || (effort !== undefined && !EFFORTS.includes(effort))) throw new ModelError('invalid_request');
  if (request.cache !== undefined && !CACHE.test(request.cache)) throw new ModelError('invalid_request', undefined, undefined, 'cache');
  return {
    model, store: false, stream: true,
    ...(request.system ? { instructions: request.system } : {}),
    input: request.messages.map(({ role, content }) => ({ role, content })),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(request.schema ? { text: { format: { type: 'json_schema', name: 'reply', strict: true, schema: request.schema } } } : {}),
    ...(request.cache ? { prompt_cache_key: request.cache } : {}),
  };
}

// A failure the API names, before a stream or inside one. A plan or an app limit that is used up is `budget_exceeded`:
// the caller stops, and nothing here asks for more.
const failure = (code: unknown, httpStatus?: number, param?: unknown) => new ModelError(
  code === 'subscription_sharing_usage_limit_exceeded' ? 'budget_exceeded'
    : code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable' ? 'model_unavailable'
      : code === 'subscription_sharing_unsupported_capability' ? 'invalid_request'
        : code === 'context_length_exceeded' ? 'context_limit'
          : typeof code === 'string' && /^(?:subscription_sharing_|chatpass_)/.test(code) ? 'unauthorized'
            : httpStatus === 401 || httpStatus === 403 ? 'unauthorized' : httpStatus === 429 ? 'rate_limited'
              : httpStatus === 503 ? 'model_unavailable' : httpStatus === 400 ? 'invalid_request' : 'provider_failed',
  httpStatus, code, param);

type Options = { fetch?: Fetch; path?: string; now?: () => number };

export function createChatgpt({ fetch: fetcher = globalThis.fetch, path = ACCOUNT_PATH, now = Date.now }: Options = {}) {
  const usable = (account: Account | null, margin: number) =>
    account?.accessToken && account.scopes?.includes(PLAN_SCOPE) && (account.expiresAt ?? 0) - now() > margin ? account.accessToken : null;

  // The caller's cancellation does not reach a refresh: the service may already have replaced the refresh token, and
  // a pair that is not saved is a session lost.
  async function accessToken(): Promise<string> {
    const ready = usable(load(path), MARGIN_MS);
    if (ready) return ready;
    return withLock(path, async () => {
      const account = load(path);
      const refreshed = usable(account, MARGIN_MS);
      if (refreshed) return refreshed;
      if (!account?.clientId || !account.refreshToken) throw new ModelError('unauthorized');
      const registration = { hostId: account.hostId, clientId: account.clientId, subject: account.subject };
      let tokens: { readonly [field: string]: unknown };
      try {
        tokens = await grant(fetcher, { grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken });
      } catch (error) {
        const refusal = error instanceof ModelError ? error.providerCode : undefined;
        // A session that is over is forgotten, so that the next call says so at once; the registration stays for the
        // next sign-in.
        if (refusal && SPENT.includes(refusal)) save(path, registration);
        // The sign-in service did not answer, or failed for now: the token in hand still works until it expires. A
        // refused client is neither case: nothing is erased, and the old token does not hide the refusal.
        else if (refusal !== 'invalid_client') {
          const held = usable(account, 30_000);
          if (held) return held;
        }
        throw error;
      }
      // From here on the old refresh token is spent. The new pair is on disk before anything else is done with it, and
      // a pair that cannot be written is a failure said aloud, not a request quietly sent with the old token.
      const next = withTokens(account, tokens, now());
      await keep(path, next.scopes?.includes(PLAN_SCOPE) ? next : { ...registration, declined: true });
      const token = usable(next, 0);
      if (!token) throw new ModelError('unauthorized');
      return token;
    });
  }

  return {
    async respond(request: Request, { onText = async () => {}, signal, timeoutMs = 180_000 }: Controls = {}): Promise<Result> {
      const sent = responsesBody(request), body = JSON.stringify(sent);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new ModelError('invalid_request');
      const timer = AbortSignal.timeout(Math.min(Math.floor(timeoutMs), 2 ** 31 - 1));
      const current = signal ? AbortSignal.any([signal, timer]) : timer;
      if (signal?.aborted) throw new ModelError('cancelled');
      // A failure of the sign-in or of the account file is said as it is, even when the caller has given up
      // meanwhile: a new pair that could not be written must not look like a time limit.
      const token = await accessToken().catch(error => { throw error instanceof ModelError ? error : new ModelError('internal_error'); });
      try {
        current.throwIfAborted();
        // The plan's route takes no output limit (`max_output_tokens` is refused); the length of the text is checked here.
        // The caller's name for the player goes as the cache key of the body and as the session of the two headers:
        // with the three the route read from its cache in 8 or 9 requests of 20, and with none in 1 to 3.
        const response = await fetcher(`${API}/responses`, { method: 'POST', redirect: 'error', signal: current, body,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream',
            ...(request.cache ? { 'session-id': request.cache, 'x-client-request-id': request.cache } : {}) } });
        if (!response.ok) {
          const refusal = await jsonOf(response).catch(() => null);
          throw failure(errorCodeOf(refusal), response.status, paramOf(refusal));
        }
        // The plan's route names no content type for its stream. A type that is named must be a stream's, and only
        // the closing event below makes an answer of what is read.
        const type = response.headers.get('content-type');
        if (type !== null && !type.includes('text/event-stream')) {
          await response.body?.cancel();
          throw new ModelError('invalid_stream');
        }
        let text = '';
        let completed: StreamEvent | undefined;
        // Every delta is an event of some 300 bytes, and the closing event repeats the whole answer.
        for await (const data of events(response.body, MAX_STREAM)) {
          if (data === '[DONE]') break;
          let event: StreamEvent;
          try { event = JSON.parse(data); } catch { throw new ModelError('invalid_stream'); }
          if (!isObject(event)) throw new ModelError('invalid_stream');
          if (event.type === 'error') throw failure(event.code ?? event.error?.code, undefined, event.param ?? event.error?.param);
          // Nobody is moved to another model unnoticed: an event that names the model that answers must name the one
          // asked for. An event that names none leaves nothing to compare.
          const answering = isObject(event.response) ? event.response.model : undefined;
          if (typeof answering === 'string' && answering && answering !== sent.model) throw new ModelError('wrong_model');
          if (event.type === 'response.failed') throw failure(event.response?.error?.code, undefined, event.response?.error?.param);
          // The service declined to write: it says so in events of its own, by an answer its content filter stopped,
          // or in a part of the closing event. Its words are never kept, like the text of any failure.
          if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') throw new ModelError('declined');
          // An answer that stopped short is no answer, whatever was written by then.
          const stopped = event.response?.incomplete_details?.reason;
          if (event.type === 'response.incomplete') throw new ModelError(stopped === 'max_output_tokens' ? 'output_limit' : stopped === 'content_filter' ? 'declined' : 'incomplete_stream');
          // No tools are sent, so an item of any other kind than these is not an answer.
          if (event.type === 'response.output_item.added' && !PASSIVE_ITEMS.includes(event.item?.type as string)) throw new ModelError('unexpected_tools');
          if (event.type === 'response.output_text.delta') {
            if (typeof event.delta !== 'string') throw new ModelError('invalid_stream');
            text += event.delta;
            if (text.length > MAX_TEXT) throw new ModelError('output_limit');
            await onText(event.delta);
          }
          // The closing event ends the reading at once: a connection left open after it is not waited for.
          if (event.type === 'response.completed') { completed = event; break; }
        }
        current.throwIfAborted();
        // Only the closing event makes an answer: a limit can end a stream that has already begun.
        if (!completed) throw new ModelError('incomplete_stream');
        const output = completed.response?.output;
        if (Array.isArray(output) && output.some(item => isObject(item) && Array.isArray(item.content) && item.content.some(part => isObject(part) && part.type === 'refusal'))) throw new ModelError('declined');
        if (!text.trim()) throw new ModelError('empty_response');
        // input_tokens includes the cached part, output_tokens the reasoning.
        const usage = completed.response?.usage;
        const inputTokens = count(usage?.input_tokens), outputTokens = count(usage?.output_tokens);
        return { text, usage: inputTokens === null && outputTokens === null ? null : { inputTokens,
          cachedInputTokens: count(usage?.input_tokens_details?.cached_tokens), outputTokens,
          reasoningTokens: count(usage?.output_tokens_details?.reasoning_tokens) } };
      } catch (error) {
        if (signal?.aborted) throw new ModelError('cancelled');
        if (timer.aborted) throw new ModelError('timeout');
        throw error instanceof ModelError ? error : new ModelError('provider_failed');
      }
    },

    // The names the plan's list of models shows for the signed-in account. It is not the set of names a request
    // takes: a name that is not in it may be served all the same, so its absence says nothing about a request.
    async models(): Promise<string[]> {
      let response: Response;
      const token = await accessToken();
      try {
        response = await fetcher(`${API}/models`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      } catch { throw new ModelError('provider_failed'); }
      const body = await jsonOf(response).catch(() => null);
      if (!response.ok) throw failure(errorCodeOf(body), response.status, paramOf(body));
      if (!isObject(body) || !Array.isArray(body.models)) throw new ModelError('invalid_response');
      return body.models.filter(entry => isObject(entry) && entry.visibility === 'list' && typeof entry.slug === 'string').map(entry => entry.slug as string);
    },

    // Booleans and a count for a person or a session to look at; no part of the account itself.
    status() {
      const account = load(path);
      return { signedIn: !!account?.refreshToken, planUse: !!account?.scopes?.includes(PLAN_SCOPE),
        minutesLeft: Math.max(0, Math.floor(((account?.accessToken ? account.expiresAt ?? 0 : 0) - now()) / 60_000)) };
    },
  };
}

const decoded = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

// Whose account the tokens belong to, by the ID token: its signature against OpenAI's published keys, then its issuer,
// its audience (the client just issued or used), its expiry and the nonce of this attempt.
async function subjectOf(fetcher: Fetch, idToken: unknown, clientId: string, nonce: string, now: number): Promise<string> {
  const refused = new SignInError('The sign-in could not be verified');
  const [head, body, signature, ...more] = typeof idToken === 'string' ? idToken.split('.') : [];
  if (!head || !body || !signature || more.length) throw refused;
  let header: unknown, claims: unknown;
  try { header = decoded(head); claims = decoded(body); } catch { throw refused; }
  if (!isObject(header) || header.alg !== 'RS256' || typeof header.kid !== 'string' || !isObject(claims)) throw refused;
  const kid = header.kid;
  let keys: unknown;
  try { keys = await jsonOf(await fetcher(KEYS, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(GRANT_TIMEOUT_MS) })); }
  catch { throw new ModelError('provider_failed'); }
  const key: unknown = isObject(keys) && Array.isArray(keys.keys)
    ? keys.keys.find(entry => isObject(entry) && entry.kid === kid && entry.kty === 'RSA' && (entry.use ?? 'sig') === 'sig') : undefined;
  if (!key) throw refused;
  let signed = false;
  try { signed = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), createPublicKey({ key: key as JsonWebKey, format: 'jwk' }), Buffer.from(signature, 'base64url')); }
  catch { throw refused; }
  const audience: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!signed || claims.iss !== AUTH || !audience.includes(clientId) || typeof claims.exp !== 'number' || claims.exp * 1000 + 60_000 < now
    || claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub) throw refused;
  return claims.sub;
}

// The sign-in itself: an address for the person's browser, and a listener on this computer for the browser's way
// back. Nothing of the person's password passes through here. `register` asks for a new registration even when one is
// saved, for another account or after the app was disconnected in ChatGPT's settings.
export async function signIn({ path = ACCOUNT_PATH, fetch: fetcher = globalThis.fetch, register = false, timeoutMs = 600_000,
  show = (address: string) => console.log(`Open this address in your browser and approve:\n${address}`) }: {
  path?: string; fetch?: Fetch; register?: boolean; timeoutMs?: number; show?: (address: string) => void } = {}) {
  // The host id is chosen and kept before the first sign-in.
  const saved = await withLock(path, async () => {
    const current = load(path);
    if (current) return current;
    const first: Account = { hostId: `urn:uuid:${randomUUID()}` };
    save(path, first);
    return first;
  });
  const { hostId } = saved;
  const returning = register ? undefined : saved.clientId;

  type Answer = { code: string; clientId: string | null };
  let waiting: { state: string; resolve: (answer: Answer) => void; reject: (error: Error) => void } | undefined;
  const server = createServer((request, response) => {
    let url: URL | undefined;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); } catch { /* no address at all */ }
    // Only an answer to the visit that is waiting counts, and only once; anything else leaves it waiting.
    if (!url || !waiting || request.method !== 'GET' || url.pathname !== CALLBACK || url.searchParams.get('state') !== waiting.state) {
      response.writeHead(404).end();
      return;
    }
    const { resolve, reject } = waiting;
    waiting = undefined;
    const code = url.searchParams.get('code'), error = url.searchParams.get('error');
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      .end(code && !error ? 'Back at sagents. You can close this tab; the terminal says how it went.' : 'The sign-in was not completed. You can close this tab.');
    if (code && !error) resolve({ code, clientId: url.searchParams.get('client_id') });
    else reject(new SignInError(error === 'access_denied' ? 'The sign-in was declined' : 'The sign-in failed'));
  });
  const listening = (port: number) => new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as AddressInfo).port); });
  });
  try {
    // 127.0.0.1 and this path stay the same from the registration on; only the port may differ.
    const redirect = `http://127.0.0.1:${await listening(1455).catch(() => listening(0))}${CALLBACK}`;

    // One visit of the browser: an address out and a code back, with a state, a nonce and a verifier of its own.
    const visit = async (clientId: string | undefined) => {
      const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
      let timer: NodeJS.Timeout | undefined;
      const answered = new Promise<Answer>((resolve, reject) => {
        waiting = { state, resolve, reject };
        timer = setTimeout(() => reject(new SignInError('No answer from the browser in time')), timeoutMs);
      });
      answered.catch(() => {});
      try {
        const address = new URL(AUTHORIZE);
        // A returning sign-in shows no consent screen, so one that follows a refusal has to ask for it.
        const parameters = { client_id: clientId ?? REGISTER, ...(clientId ? {} : { agent_name_hint: APP_NAME }),
          ...(clientId && saved.declined ? { prompt: 'consent' } : {}), ext_agent_host_id: hostId,
          response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: API, state, nonce, code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url') };
        for (const [name, value] of Object.entries(parameters)) address.searchParams.set(name, value);
        show(address.href);
        const answer = await answered;
        // A new registration names the client it issued; a returning sign-in may name none, and never another.
        const issued = clientId ?? answer.clientId;
        if (!issued || issued === REGISTER || (clientId && answer.clientId && answer.clientId !== clientId)) throw new SignInError('The sign-in did not name its client');
        return { issued, nonce, exchange: () => grant(fetcher, { grant_type: 'authorization_code', client_id: issued, code: answer.code,
          code_verifier: verifier, redirect_uri: redirect }) };
      } finally {
        clearTimeout(timer);
        waiting = undefined;
      }
    };

    let visited = await visit(returning);
    let tokens: { readonly [field: string]: unknown };
    try { tokens = await visited.exchange(); } catch (error) {
      // A code the service refuses is thrown away, and the authorization starts once more with the client that was
      // just issued, so that a first sign-in does not register twice.
      if (!(error instanceof ModelError) || error.providerCode !== 'invalid_grant') throw error;
      visited = await visit(visited.issued);
      tokens = await visited.exchange();
    }
    const { issued, nonce } = visited;
    const subject = await subjectOf(fetcher, tokens.id_token, issued, nonce, Date.now());
    if (returning && saved.subject && saved.subject !== subject) throw new SignInError('Another account answered than the one this registration belongs to');
    const account = withTokens({ hostId, clientId: issued, subject }, tokens, Date.now());
    const planUse = !!account.scopes?.includes(PLAN_SCOPE);
    await withLock(path, async () => {
      // The browser took its time, and another sign-in may have finished meanwhile. Its registration is not replaced.
      if (load(path)?.clientId !== saved.clientId) throw new SignInError('Another sign-in changed the registration meanwhile; run this one again');
      // Without the permission to use the plan the registration is kept and the tokens are not: they could do nothing here.
      save(path, planUse ? account : { hostId, clientId: issued, subject, declined: true });
    });
    return { planUse };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
