import { CACHE, ENDPOINT, ModelError, OTHER_ENDPOINT, untilStopped } from './chatgpt.ts';
import type { Controls, Request, Result } from './chatgpt.ts';

// A retry can cost money, so the caller must choose whether to send another request.
const DEFAULT_MAX_TOKENS = 2048;
const MAX_ANSWER = 4_000_000;
const MAX_TEXT = 100_000;
const CONNECTION_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
// Extra fields must not change the shape or number of answers we can read.
const FIXED = ['model', 'messages', 'max_tokens', 'max_completion_tokens', 'response_format', 'stream', 'stream_options', 'n'];
// Other characters could inject a header or make an error quote the key.
const KEY = /^[\x21-\x7e]+$/;
const FIELD = /^[a-z][a-z0-9_]{0,39}$/;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;
// OpenAI and vLLM name context overflow by code, llama.cpp by type, OpenRouter only in its sentence.
// The sentence must not leave this check.
const CONTEXT_CODES = ['context_length_exceeded', 'exceed_context_size_error'];
const CONTEXT_TEXT = /context (?:length|size|window)|maximum context/i;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Env = { readonly [name: string]: string | undefined };

const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
// Report setting names alone; their values may contain secrets.
const refused = (name: string) => new ModelError('invalid_request', undefined, undefined, name);

function settingsOf(env: Env) {
  const key = env.SAGENTS_API_KEY || undefined;
  let base: URL | undefined;
  try { base = new URL(env.SAGENTS_API_URL ?? ''); } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  // Keep keys and text encrypted whenever they leave this computer.
  if (!base || !(base.protocol === 'https:' || (base.protocol === 'http:' && LOOPBACK.test(base.hostname)))
    || base.username || base.password || base.search || base.hash) throw refused('SAGENTS_API_URL');
  if (key && !KEY.test(key)) throw refused('SAGENTS_API_KEY');
  const maxTokens = env.SAGENTS_API_MAX_TOKENS ? Number(env.SAGENTS_API_MAX_TOKENS) : DEFAULT_MAX_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw refused('SAGENTS_API_MAX_TOKENS');
  let extra: unknown = {};
  if (env.SAGENTS_API_EXTRA) {
    try { extra = JSON.parse(env.SAGENTS_API_EXTRA); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      extra = null;
    }
  }
  if (!isObject(extra) || FIXED.some(name => Object.hasOwn(extra, name))) throw refused('SAGENTS_API_EXTRA');
  // Servers disagree on cache-field names and may refuse an unfamiliar one.
  const cacheField = env.SAGENTS_API_CACHE_FIELD || undefined;
  if (cacheField && (!FIELD.test(cacheField) || FIXED.includes(cacheField) || Object.hasOwn(extra, cacheField))) throw refused('SAGENTS_API_CACHE_FIELD');
  if (env.SAGENTS_API_STREAM && env.SAGENTS_API_STREAM !== '1') throw refused('SAGENTS_API_STREAM');
  // Without a stream, the server may finish and charge for its answer before any response arrives.
  if (env.SAGENTS_API_AGAIN && (env.SAGENTS_API_AGAIN !== '1' || !env.SAGENTS_API_STREAM)) throw refused('SAGENTS_API_AGAIN');
  return { url: `${base.origin}${base.pathname.replace(/\/+$/, '')}/chat/completions`, key, maxTokens, extra, cacheField,
    stream: !!env.SAGENTS_API_STREAM, again: !!env.SAGENTS_API_AGAIN };
}

export function completionsBody(request: Request, env: Env = process.env) {
  const { maxTokens, extra, cacheField, stream } = settingsOf(env);
  // The @ effort syntax belongs to chatgpt.ts; servers need their own extra field.
  if (!request.model || request.model.includes('@')) throw refused('model');
  if (request.cache !== undefined && !CACHE.test(request.cache)) throw refused('cache');
  return {
    ...extra, model: request.model,
    messages: [...(request.system ? [{ role: 'system', content: request.system }] : []), ...request.messages.map(({ role, content }) => ({ role, content }))],
    max_tokens: maxTokens,
    ...(request.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.schema } } } : {}),
    ...(request.cache && cacheField ? { [cacheField]: request.cache } : {}),
    // A stream reports usage only if we ask for it.
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

async function jsonOf(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_ANSWER) return null;
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

// OpenRouter may send its provider's failure with HTTP 200 and the status in code.
function failure(httpStatus: number | undefined, error: unknown) {
  const named = isObject(error) ? error : {};
  const status = httpStatus ?? (typeof named.code === 'number' && Number.isInteger(named.code) && named.code >= 400 && named.code <= 599 ? named.code : undefined);
  const code = typeof named.code === 'string' ? named.code : named.type;
  const tooLong = CONTEXT_CODES.includes(code as string) || ((status === 400 || status === 413) && typeof named.message === 'string' && CONTEXT_TEXT.test(named.message));
  return new ModelError(
    status === 402 || code === 'insufficient_quota' ? 'budget_exceeded'
      : tooLong ? 'context_limit'
        : status === 401 || status === 403 ? 'unauthorized' : status === 429 ? 'rate_limited'
          : status === 503 ? 'model_unavailable' : status === 400 || status === 422 ? 'invalid_request' : 'provider_failed',
    status, code, named.param);
}

// onText may see pieces before the stream is known to be complete.
async function streamOf(body: Response['body'], onText: (delta: string) => unknown, stopped: () => ModelError | null): Promise<unknown> {
  if (!body) throw new ModelError('invalid_stream');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '', finish: unknown, usage: unknown, provider: unknown;
  // Join once per line to avoid rereading a long line for every arriving piece.
  let rest: string[] = [];
  let held: string[] | null = null, pieces = 0;
  for await (const part of body) {
    // Ready pieces can starve timers; yield occasionally so cancellation and deadlines can fire.
    if ((pieces += 1) % 256 === 0) await new Promise<void>(resolve => { setImmediate(resolve); });
    const reason = stopped();
    if (reason) throw reason;
    bytes += part.byteLength;
    if (bytes > MAX_ANSWER) throw new ModelError('output_limit');
    let piece: string;
    try { piece = decoder.decode(part, { stream: true }); } catch (error) {
      if (error instanceof TypeError) throw new ModelError('invalid_stream');
      throw error;
    }
    const end = piece.lastIndexOf('\n');
    if (end === -1) { if (piece) rest.push(piece); continue; }
    const lines = `${rest.join('')}${piece.slice(0, end)}`.split('\n');
    rest = [piece.slice(end + 1)];
    for (const line of lines) {
      const ended = line === '' || line === '\r';
      let data: string;
      if (ended && held !== null) {
        data = held.join('\n');
        held = null;
      } else {
        if (!line.startsWith('data:')) continue;
        data = line.slice(5).trim();
        if (held !== null) { held.push(data); continue; }
        // An empty data line adds only a line feed to its event, which a JSON value does not need.
        if (!data) continue;
        // Returning cancels the body so an open connection cannot delay a completed answer.
        if (data === '[DONE]') return { choices: [{ finish_reason: finish, message: { content: text } }], usage, provider };
      }
      let chunk: unknown;
      try { chunk = JSON.parse(data); } catch (error) {
        if (error instanceof SyntaxError) {
          if (ended) throw new ModelError('invalid_stream');
          held = [data];
          continue;
        }
        throw error;
      }
      if (!isObject(chunk)) throw new ModelError('invalid_stream');
      if (chunk.error) throw failure(undefined, chunk.error);
      if (isObject(chunk.usage)) usage = chunk.usage;
      if (typeof chunk.provider === 'string') provider = chunk.provider;
      // The usage-only chunk has no choice.
      const choices = chunk.choices ?? [];
      if (!Array.isArray(choices) || choices.length > 1) throw new ModelError('invalid_stream');
      const choice: unknown = choices[0];
      if (!choices.length) continue;
      if (!isObject(choice)) throw new ModelError('invalid_stream');
      if (choice.error) throw failure(undefined, choice.error);
      const delta = isObject(choice.delta) ? choice.delta : {};
      if ((Array.isArray(delta.tool_calls) && delta.tool_calls.length) || delta.function_call) throw new ModelError('unexpected_tools');
      if (typeof delta.refusal === 'string' && delta.refusal.trim()) throw new ModelError('declined');
      if (typeof delta.content === 'string') {
        if (finish != null && delta.content) throw new ModelError('invalid_stream');
        text += delta.content;
        if (text.length > MAX_TEXT) throw new ModelError('output_limit');
        if (delta.content) await onText(delta.content);
      } else if (delta.content != null) throw new ModelError('invalid_stream');
      if (choice.finish_reason === 'length') throw new ModelError('output_limit');
      if (choice.finish_reason != null && finish == null) finish = choice.finish_reason;
    }
  }
  try { decoder.decode(); } catch (error) {
    if (error instanceof TypeError) throw new ModelError('invalid_stream');
    throw error;
  }
  throw new ModelError(held === null ? 'incomplete_stream' : 'invalid_stream');
}

type Options = { fetch?: Fetch; env?: Env };

export function createCompatible({ fetch: fetcher = globalThis.fetch, env = process.env }: Options = {}) {
  return {
    async respond(request: Request, { onText = async () => {}, signal, timeoutMs = 180_000 }: Controls = {}): Promise<Result> {
      const { url, key, stream, again } = settingsOf(env);
      const body = JSON.stringify(completionsBody(request, env));
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new ModelError('invalid_request');
      const until = performance.now() + timeoutMs;
      const timer = AbortSignal.timeout(Math.min(Math.floor(timeoutMs), 2 ** 31 - 1));
      const current = signal ? AbortSignal.any([signal, timer]) : timer;
      const stopped = () => signal?.aborted ? new ModelError('cancelled') : timer.aborted || performance.now() >= until ? new ModelError('timeout') : null;
      if (signal?.aborted) throw new ModelError('cancelled');
      let response: Response | undefined, answer: unknown, streamed = false, sent = false;
      try {
        try {
          // A redirect could carry the key and request text to another server.
          response = await untilStopped(async () => {
            sent = true;
            response = await fetcher(url, { method: 'POST', redirect: 'error', signal: current, body,
              headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json' } });
            return response;
          }, current, until);
          if (response.status === 402) {
            // A broken body must not hide an exhausted balance.
            if (!response.body?.locked) void response.body?.cancel().catch(error => { if (!(error instanceof Error)) throw error; });
            throw failure(402, undefined);
          }
          // A server may return JSON even when a stream was requested.
          streamed = stream && response.ok && !response.headers.get('content-type')?.includes('application/json');
          answer = streamed ? await untilStopped(() => streamOf(response!.body, delta => untilStopped(() => onText(delta), current, until), stopped), current, until)
            : await untilStopped(() => jsonOf(response!).catch(error => {
              if (response!.ok || !(error instanceof Error)) throw error;
              return null;
            }), current, until);
        } catch (error) {
          const reason = stopped();
          if (reason) throw reason;
          if (error instanceof TypeError) {
            const failure = new ModelError('provider_failed', response?.status);
            // The server may have received the request all the same, so only its own setting marks it for another send.
            if (again && sent && !response && isObject(error.cause) && typeof error.cause.code === 'string' && CONNECTION_CODES.has(error.cause.code)) failure.again = true;
            throw failure;
          }
          throw error;
        }
        const reason = stopped();
        if (reason) throw reason;
        if (!response.ok) throw failure(response.status, isObject(answer) ? answer.error : undefined);
        if (!isObject(answer)) throw new ModelError('invalid_response');
        if (answer.error) throw failure(undefined, answer.error);
        const choice: unknown = Array.isArray(answer.choices) && answer.choices.length === 1 ? answer.choices[0] : undefined;
        if (!isObject(choice)) throw new ModelError('invalid_response');
        if (choice.error) throw failure(undefined, choice.error);
        const message = isObject(choice.message) ? choice.message : {};
        // No tools were sent, so a tool call cannot be an answer.
        if (choice.finish_reason === 'tool_calls' || (Array.isArray(message.tool_calls) && message.tool_calls.length)) throw new ModelError('unexpected_tools');
        if (choice.finish_reason === 'content_filter' || (typeof message.refusal === 'string' && message.refusal.trim())) throw new ModelError('declined');
        if (choice.finish_reason === 'length') throw new ModelError('output_limit');
        if (choice.finish_reason !== 'stop') throw new ModelError('incomplete_stream');
        // Reasoning may use the whole turn and leave no content.
        const text = message.content ?? '';
        if (typeof text !== 'string') throw new ModelError('invalid_response');
        if (text.length > MAX_TEXT) throw new ModelError('output_limit');
        if (!text.trim()) throw new ModelError('empty_response');
        if (!streamed) {
          try { await untilStopped(() => onText(text), current, until); } catch (error) { throw stopped() ?? error; }
        }
        const ended = stopped();
        if (ended) throw ended;
        // prompt_tokens includes cached and written tokens; completion_tokens includes reasoning.
        const usage = isObject(answer.usage) ? answer.usage : {};
        const input = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
        const output = isObject(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
        const inputTokens = count(usage.prompt_tokens), outputTokens = count(usage.completion_tokens);
        // A router may send two requests for one model to different providers.
        const endpoint = typeof answer.provider !== 'string' ? {} : { endpoint: ENDPOINT.test(answer.provider) ? answer.provider : OTHER_ENDPOINT };
        return { text, usage: inputTokens === null && outputTokens === null ? null : { inputTokens,
          cachedInputTokens: count(input.cached_tokens), writtenInputTokens: count(input.cache_write_tokens), outputTokens, reasoningTokens: count(output.reasoning_tokens) }, ...endpoint };
      } catch (error) {
        if (error instanceof ModelError && sent) error.stage = response ? 'stream' : 'connect';
        throw error;
      }
    },
  };
}
