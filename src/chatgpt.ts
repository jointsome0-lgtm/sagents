import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { closeSync, constants, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const AUTH = 'https://auth.openai.com';
const AUTHORIZE = `${AUTH}/api/accounts/authorize`;
const TOKEN = `${AUTH}/api/accounts/oauth/token`;
const KEYS = `${AUTH}/.well-known/jwks.json`;
const API = 'https://api.openai.com/v1';
const CALLBACK = '/auth/callback';
const REGISTER = 'dynamic_agent_client';
const APP_NAME = 'sagents';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
// These failures mean the refresh token cannot work again; another sign-in is needed.
const SPENT = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated',
  'refresh_token_reused'];
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const PASSIVE_ITEMS = ['message', 'reasoning'];
// Access tokens live an hour.
const MARGIN_MS = 5 * 60_000;
const GRANT_TIMEOUT_MS = 30_000;
const LOCK_WAIT_MS = 90_000;
const MAX_STREAM = 16_000_000;
const MAX_TEXT = 100_000;

export const ACCOUNT_PATH = join(homedir(), '.config', 'sagents', 'chatgpt.json');

// Service error text may quote the request or contain a token.
// Plain codes and field names let the caller identify a refused field without that text.
const PROVIDER_CODE = /^[a-z][a-z0-9_]{0,79}$/;
const PARAM = /^[A-Za-z_][\w.[\]]{0,79}$/;
export class ModelError extends Error {
  code: string;
  httpStatus: number | undefined;
  providerCode: string | undefined;
  param: string | undefined;
  stage?: 'connect' | 'stream';
  tries?: 2;
  refusal?: 'event' | 'filter' | 'part';
  constructor(code: string, httpStatus?: number, providerCode?: unknown, param?: unknown) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerCode = typeof providerCode === 'string' && PROVIDER_CODE.test(providerCode) ? providerCode : undefined;
    this.param = typeof param === 'string' && PARAM.test(param) ? param : undefined;
  }
}
// These sentences are ours, so cli.ts may show them.
export class SignInError extends Error {}

export type Message = { role: 'user' | 'assistant'; content: string };
export type Request = { model: string; system?: string; messages: Message[]; schema?: object; cache?: string };
// Cache names enter headers and must fit the service's key limit.
export const CACHE = /^[A-Za-z0-9_-]{1,64}$/;
export type Usage = { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null };
export type Result = { text: string; usage: Usage | null; endpoint?: string; tries?: 2 };
export const ENDPOINT = /^[A-Za-z0-9 ./_-]{1,40}$/, OTHER_ENDPOINT = 'other';
// onText may receive pieces before a later failure; only the return value is a complete answer.
export type Controls = { signal?: AbortSignal; onText?: (delta: string) => unknown; timeoutMs?: number };

// The caller's limit must also stop a text callback that never settles.
export async function untilStopped<T>(work: () => T | PromiseLike<T>, signal: AbortSignal, until = Infinity): Promise<T> {
  signal.throwIfAborted();
  if (performance.now() >= until) throw new ModelError('timeout');
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const value = await Promise.race([stopped, Promise.resolve().then(() => { signal.throwIfAborted(); return work(); })]);
    signal.throwIfAborted();
    if (performance.now() >= until) throw new ModelError('timeout');
    return value;
  } finally { signal.removeEventListener('abort', abort); }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
// `hostId` names this installation to OpenAI and is no secret, unlike the tokens kept beside it.
// The connection needs neither the ID token nor the email after verification.
type Account = { hostId: string; clientId?: string; subject?: string; accessToken?: string; refreshToken?: string;
  expiresAt?: number; scopes?: string[]; declined?: boolean };
type Failure = { code?: unknown; param?: unknown } | null;
type StreamEvent = {
  type?: unknown; delta?: unknown; output_index?: unknown; code?: unknown; param?: unknown; error?: Failure; item?: { type?: unknown; phase?: unknown } | null;
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

// Starting over on an unreadable account file would overwrite the saved account.
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

// Callers must hold withLock() through the save.
// A process killed between token rotation and rename leaves a spent refresh token and needs another sign-in.
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
  // Flush the folder too so the renamed account reaches disk.
  try {
    const folder = openSync(dirname(path), 'r');
    try { fsyncSync(folder); } finally { closeSync(folder); }
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'ENOSYS', 'EISDIR', 'EPERM'].includes(errnoOf(error) ?? '')) throw new ModelError('storage_failed');
  }
}

// The old refresh token is spent, so retry saving its replacement before reporting failure.
async function keep(path: string, account: Account) {
  for (let attempt = 1; ; attempt++) {
    try { return save(path, account); } catch (error) {
      if (attempt === 3) throw error;
      await sleep(200);
    }
  }
}

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

async function* events(body: Response['body'], limit: number) {
  if (!body) throw new ModelError('invalid_stream');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (chunk?: Uint8Array) => {
    try { return decoder.decode(chunk, { stream: chunk !== undefined }); } catch (error) {
      if (error instanceof TypeError) throw new ModelError('invalid_stream');
      throw error;
    }
  };
  let buffer = '';
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new ModelError('output_limit');
    buffer += decode(chunk);
    let end: RegExpExecArray | null;
    while ((end = /\r?\n\r?\n/.exec(buffer))) {
      const event = buffer.slice(0, end.index);
      buffer = buffer.slice(end.index + end[0].length);
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (data) yield data;
    }
  }
  buffer += decode();
  if (buffer.trim()) throw new ModelError('invalid_stream');
}

// Caller cancellation must not interrupt a refresh; the service may already have rotated the token.
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

// A refresh may omit scopes without revoking the existing grant.
const withTokens = (account: Account, tokens: { readonly [field: string]: unknown }, now: number): Account => ({
  hostId: account.hostId, clientId: account.clientId, subject: account.subject,
  accessToken: tokens.access_token as string, refreshToken: tokens.refresh_token as string,
  expiresAt: now + (tokens.expires_in as number) * 1000,
  scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : account.scopes ?? [],
});

// A second refresh with a spent token ends the session, so processes must lock and reread the account.
// The kernel releases the SQLite lock on death; a stopped process keeps it.
// Version 0.1.0 used a link and does not share this lock.
const sqliteCode = (error: unknown) => error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : null;
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.renew.sqlite`;
  let database: DatabaseSync;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const mode = ((statSync(path, { throwIfNoEntry: false })?.mode ?? 0o600) & 0o777) | 0o200;
    // Closing any descriptor drops this process's locks on the file; create it only while no connection can hold one.
    try {
      const file = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, mode);
      try { fchmodSync(file, mode); } finally { closeSync(file); }
    } catch (error) { if (errnoOf(error) !== 'EEXIST') throw error; }
    database = new DatabaseSync(lock, { timeout: 0 });
  } catch (error) {
    if (!errnoOf(error) && sqliteCode(error) === null) throw error;
    throw new ModelError('storage_failed');
  }
  const started = performance.now();
  let held = false;
  try {
    for (;;) {
      if (performance.now() - started > LOCK_WAIT_MS) throw new ModelError('timeout');
      try { database.exec('BEGIN EXCLUSIVE'); held = true; break; } catch (error) {
        if (sqliteCode(error) !== 5) {
          if (sqliteCode(error) === null) throw error;
          throw new ModelError('storage_failed');
        }
      }
      await sleep(100);
    }
    return await fn();
  } finally {
    try { if (held) database.exec('ROLLBACK'); } catch (error) {
      if (sqliteCode(error) === null) throw error;
      throw new ModelError('storage_failed');
    } finally { database.close(); }
  }
}

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

const failure = (code: unknown, httpStatus?: number, param?: unknown) => new ModelError(
  httpStatus === 402 || code === 'subscription_sharing_usage_limit_exceeded' ? 'budget_exceeded'
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
        if (refusal && SPENT.includes(refusal)) save(path, registration);
        // A temporary service failure leaves the held token usable; an invalid client must not be hidden that way.
        else if (refusal !== 'invalid_client') {
          const held = usable(account, 30_000);
          if (held) return held;
        }
        throw error;
      }
      // After rotation the old token is spent; persist the new pair before using it.
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
      const until = performance.now() + timeoutMs;
      const timer = AbortSignal.timeout(Math.min(Math.floor(timeoutMs), 2 ** 31 - 1));
      const current = signal ? AbortSignal.any([signal, timer]) : timer;
      if (signal?.aborted) throw new ModelError('cancelled');
      // A failure to save rotated tokens must not be hidden by a caller timeout.
      const token = await accessToken().catch(error => { throw error instanceof ModelError ? error : new ModelError('internal_error'); });
      let status: number | undefined, tries: 2 | undefined;
      try {
        return await untilStopped(async () => {
          current.throwIfAborted();
          // The plan route refuses max_output_tokens.
          // With the cache key in the body and both headers, cache hits occurred in 8 or 9 of 20 requests, versus 1 to 3 without them.
          const send = () => fetcher(`${API}/responses`, { method: 'POST', redirect: 'error', signal: current, body,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream',
              ...(request.cache ? { 'session-id': request.cache, 'x-client-request-id': request.cache } : {}) } });
          let response: Response;
          try { response = await send(); } catch (error) {
            if (current.aborted || performance.now() >= until) throw error;
            await sleep(2000, undefined, { signal: current });
            current.throwIfAborted();
            if (performance.now() >= until) throw new ModelError('timeout');
            tries = 2;
            response = await send();
          }
          status = response.status;
          if (response.status === 402) {
            if (!response.body?.locked) void response.body?.cancel().catch(error => { if (!(error instanceof Error)) throw error; });
            throw failure(undefined, 402);
          }
          if (!response.ok) {
            const refusal = await jsonOf(response).catch(() => null);
            throw failure(errorCodeOf(refusal), response.status, paramOf(refusal));
          }
          // The plan route may omit the stream's content type.
          const type = response.headers.get('content-type');
          if (type !== null && !type.includes('text/event-stream')) {
            if (!response.body?.locked) await response.body?.cancel();
            throw new ModelError('invalid_stream');
          }
          const pieces: { index: number | undefined; text: string }[] = [];
          let length = 0;
          const commentary = new Set<number>();
          const interim = (index: number) => {
            if (commentary.has(index)) return;
            commentary.add(index);
            length -= pieces.filter(piece => piece.index === index).reduce((sum, piece) => sum + piece.text.length, 0);
          };
          let completed: StreamEvent | undefined;
          // Each delta has cost about 300 bytes, and the closing event repeats the whole answer.
          for await (const data of events(response.body, MAX_STREAM)) {
            if (data === '[DONE]') break;
            let event: StreamEvent;
            try { event = JSON.parse(data); } catch (error) {
              if (error instanceof SyntaxError) throw new ModelError('invalid_stream');
              throw error;
            }
            if (!isObject(event)) throw new ModelError('invalid_stream');
            if (event.type === 'error') throw failure(event.code ?? event.error?.code, undefined, event.param ?? event.error?.param);
            // A service must not silently substitute a different model.
            const answering = isObject(event.response) ? event.response.model : undefined;
            if (typeof answering === 'string' && answering && answering !== sent.model) throw new ModelError('wrong_model');
            if (event.type === 'response.failed') throw failure(event.response?.error?.code, undefined, event.response?.error?.param);
            if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') throw Object.assign(new ModelError('declined'), { refusal: 'event' as const });
            const stopped = event.response?.incomplete_details?.reason;
            if (event.type === 'response.incomplete') throw Object.assign(new ModelError(stopped === 'max_output_tokens' ? 'output_limit' : stopped === 'content_filter' ? 'declined' : 'incomplete_stream'),
              stopped === 'content_filter' ? { refusal: 'filter' as const } : {});
            // No tools were sent, so other item kinds cannot be an answer.
            if (event.type === 'response.output_item.added' && !PASSIVE_ITEMS.includes(event.item?.type as string)) throw new ModelError('unexpected_tools');
            if (['response.output_item.added', 'response.output_item.done'].includes(event.type as string)
              && event.item?.type === 'message' && event.item.phase === 'commentary' && typeof event.output_index === 'number') interim(event.output_index);
            if (event.type === 'response.output_text.delta') {
              if (typeof event.delta !== 'string') throw new ModelError('invalid_stream');
              if (typeof event.output_index === 'number' && commentary.has(event.output_index)) continue;
              pieces.push({ index: typeof event.output_index === 'number' ? event.output_index : undefined, text: event.delta });
              length += event.delta.length;
              if (length > MAX_TEXT) throw new ModelError('output_limit');
              await untilStopped(() => onText(event.delta as string), current, until);
            }
            // Stop at completion so an open connection cannot delay the answer.
            if (event.type === 'response.completed') { completed = event; break; }
          }
          current.throwIfAborted();
          if (!completed) throw new ModelError('incomplete_stream');
          if (!isObject(completed.response) || Array.isArray(completed.response)) throw new ModelError('invalid_stream');
          const output = completed.response.output;
          if (output !== undefined && !Array.isArray(output)) throw new ModelError('invalid_stream');
          if (Array.isArray(output) && output.some(item => !isObject(item) || !PASSIVE_ITEMS.includes(item.type as string))) throw new ModelError('unexpected_tools');
          if (Array.isArray(output) && output.some(item => isObject(item) && Array.isArray(item.content) && item.content.some(part => isObject(part) && part.type === 'refusal'))) throw Object.assign(new ModelError('declined'), { refusal: 'part' as const });
          if (Array.isArray(output)) output.forEach((item, index) => { if (item.type === 'message' && item.phase === 'commentary') interim(index); });
          const text = pieces.filter(piece => piece.index === undefined || !commentary.has(piece.index)).map(piece => piece.text).join('');
          if (Array.isArray(output)) {
            const parts = output.flatMap((item, index) => isObject(item) && !commentary.has(index)
              && Array.isArray(item.content) ? item.content : []);
            const closing = parts.filter(part => isObject(part) && part.type === 'output_text');
            if (closing.some(part => typeof part.text !== 'string') || (closing.length && closing.map(part => part.text).join('') !== text)) throw new ModelError('invalid_stream');
          }
          if (!text.trim()) throw new ModelError('empty_response');
          // input_tokens includes cached tokens; output_tokens includes reasoning.
          const usage = completed.response?.usage;
          const inputTokens = count(usage?.input_tokens), outputTokens = count(usage?.output_tokens);
          return { text, usage: inputTokens === null && outputTokens === null ? null : { inputTokens,
            cachedInputTokens: count(usage?.input_tokens_details?.cached_tokens), outputTokens,
            reasoningTokens: count(usage?.output_tokens_details?.reasoning_tokens) }, ...(tries ? { tries } : {}) };
        }, current, until);
      } catch (error) {
        const failed = signal?.aborted ? new ModelError('cancelled') : timer.aborted || performance.now() >= until ? new ModelError('timeout')
          : error instanceof ModelError ? error : new ModelError('provider_failed');
        failed.stage = status === undefined ? 'connect' : 'stream';
        if (tries) failed.tries = tries;
        throw failed;
      }
    },

    // The offered list is not exhaustive; an absent name may still be served.
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

    status() {
      const account = load(path);
      return { signedIn: !!account?.refreshToken, planUse: !!account?.scopes?.includes(PLAN_SCOPE),
        minutesLeft: Math.max(0, Math.floor(((account?.accessToken ? account.expiresAt ?? 0 : 0) - now()) / 60_000)) };
    },
  };
}

const decoded = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

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

export async function signIn({ path = ACCOUNT_PATH, fetch: fetcher = globalThis.fetch, register = false, timeoutMs = 600_000,
  show = (address: string) => console.log(`Open this address in your browser and approve:\n${address}`) }: {
  path?: string; fetch?: Fetch; register?: boolean; timeoutMs?: number; show?: (address: string) => void } = {}) {
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
    // Registration requires the same loopback host and callback path across visits; only the port may change.
    const redirect = `http://127.0.0.1:${await listening(1455).catch(() => listening(0))}${CALLBACK}`;

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
        // Returning sign-ins skip consent, so a missing grant needs an explicit consent request.
        const parameters = { client_id: clientId ?? REGISTER, ...(clientId ? {} : { agent_name_hint: APP_NAME }),
          ...(clientId && saved.declined ? { prompt: 'consent' } : {}), ext_agent_host_id: hostId,
          response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: API, state, nonce, code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url') };
        for (const [name, value] of Object.entries(parameters)) address.searchParams.set(name, value);
        show(address.href);
        const answer = await answered;
        // A returning sign-in may omit the client id, but may not change it.
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
      // Reuse the just-issued client so retrying an authorization code does not register twice.
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
      // Another sign-in may finish while the browser waits; do not replace its registration.
      if (load(path)?.clientId !== saved.clientId) throw new SignInError('Another sign-in changed the registration meanwhile; run this one again');
      // Without plan permission the tokens cannot be used here.
      save(path, planUse ? account : { hostId, clientId: issued, subject, declined: true });
    });
    return { planUse };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
