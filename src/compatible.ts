import { ModelError } from './chatgpt.ts';
import type { Controls, Request, Result } from './chatgpt.ts';

// Any server that speaks the OpenAI chat completions protocol: vLLM or llama.cpp on a rented card, OpenRouter. The
// address, the key and the output limit come from the environment. A request goes to the server the address names and
// nowhere else, and holds what the caller gave, the output limit and the fields of SAGENTS_API_EXTRA. Every call can
// cost money, so nothing is sent a second time: a failure is a code, and the caller decides what to do next.
const DEFAULT_MAX_TOKENS = 2048;
const MAX_ANSWER = 4_000_000;
const MAX_TEXT = 100_000;
// What this module sets itself, and what would change the shape or the number of the answers it reads.
const FIXED = ['model', 'messages', 'max_tokens', 'max_completion_tokens', 'response_format', 'stream', 'n'];
// A key is one header value; anything else in it would be a second header or a failure that quotes it.
const KEY = /^[\x21-\x7e]+$/;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;
// How servers name a prompt that does not fit: OpenAI and vLLM by code, llama.cpp by type, OpenRouter in its sentence
// only. The sentence is looked at for this and never carried.
const CONTEXT_CODES = ['context_length_exceeded', 'exceed_context_size_error'];
const CONTEXT_TEXT = /context (?:length|size|window)|maximum context/i;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Env = { readonly [name: string]: string | undefined };

const isObject = (value: unknown): value is { readonly [field: string]: unknown } => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
// A setting or a field that cannot be used, by its name. The name is this module's own and says nothing of the value.
const refused = (name: string) => new ModelError('invalid_request', undefined, undefined, name);

function settingsOf(env: Env) {
  const key = env.SAGENTS_API_KEY || undefined;
  let base: URL | undefined;
  try { base = new URL(env.SAGENTS_API_URL ?? ''); } catch (error) {
    // A TypeError is how URL says that this is no address.
    if (!(error instanceof TypeError)) throw error;
  }
  // The key and the text travel encrypted or do not leave this computer: plain http is for a loopback address only.
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
  return { url: `${base.origin}${base.pathname.replace(/\/+$/, '')}/chat/completions`, key, maxTokens, extra };
}

// The body of one request, whole: a caller that stores its hash can say exactly what the model saw.
export function completionsBody(request: Request, env: Env = process.env) {
  const { maxTokens, extra } = settingsOf(env);
  // A reasoning effort after `@` belongs to the ChatGPT connection; here the server's own switch goes in SAGENTS_API_EXTRA.
  if (!request.model || request.model.includes('@')) throw refused('model');
  return {
    ...extra, model: request.model,
    messages: [...(request.system ? [{ role: 'system', content: request.system }] : []), ...request.messages.map(({ role, content }) => ({ role, content }))],
    max_tokens: maxTokens,
    ...(request.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.schema } } } : {}),
  };
}

// An answer of the server, or null when it is too long or is not JSON. Only named fields of it are ever read.
async function jsonOf(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_ANSWER) {
      await response.body.cancel();
      return null;
    }
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

// A failure the server names, by the HTTP status or inside an answer that came with 200 (OpenRouter passes its
// provider's failure on that way, with the status as a number in `code`). A balance that is used up is
// `budget_exceeded`: the caller stops, and nothing here asks for more.
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

type Options = { fetch?: Fetch; env?: Env };

export function createCompatible({ fetch: fetcher = globalThis.fetch, env = process.env }: Options = {}) {
  return {
    async respond(request: Request, { onText = async () => {}, signal, timeoutMs = 180_000 }: Controls = {}): Promise<Result> {
      const { url, key } = settingsOf(env);
      const body = JSON.stringify(completionsBody(request, env));
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new ModelError('invalid_request');
      const timer = AbortSignal.timeout(Math.min(Math.floor(timeoutMs), 2 ** 31 - 1));
      const current = signal ? AbortSignal.any([signal, timer]) : timer;
      const stopped = () => signal?.aborted ? new ModelError('cancelled') : timer.aborted ? new ModelError('timeout') : null;
      if (signal?.aborted) throw new ModelError('cancelled');
      let response: Response | undefined, answer: unknown;
      try {
        // One request and no other. A redirect is a failure: it would carry the key and the text to another server.
        response = await fetcher(url, { method: 'POST', redirect: 'error', signal: current, body,
          headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json', accept: 'application/json' } });
        answer = await jsonOf(response);
      } catch (error) {
        const reason = stopped();
        if (reason) throw reason;
        // A TypeError is fetch's own: no connection, a redirect, or an answer that broke off.
        if (error instanceof TypeError) throw new ModelError('provider_failed', response?.status);
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
      // No tools are sent, so a call of one is not an answer.
      if (choice.finish_reason === 'tool_calls' || (Array.isArray(message.tool_calls) && message.tool_calls.length)) throw new ModelError('unexpected_tools');
      // An answer that stopped short is no answer, whatever was written by then.
      if (choice.finish_reason === 'length') throw new ModelError('output_limit');
      if (choice.finish_reason !== 'stop') throw new ModelError('incomplete_stream');
      // A model that spent its turn on reasoning leaves no content at all.
      const text = message.content ?? '';
      if (typeof text !== 'string') throw new ModelError('invalid_response');
      if (text.length > MAX_TEXT) throw new ModelError('output_limit');
      if (!text.trim()) throw new ModelError('empty_response');
      await onText(text);
      // prompt_tokens includes the cached part, completion_tokens the reasoning.
      const usage = isObject(answer.usage) ? answer.usage : {};
      const input = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
      const output = isObject(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
      const inputTokens = count(usage.prompt_tokens), outputTokens = count(usage.completion_tokens);
      return { text, usage: inputTokens === null && outputTokens === null ? null : { inputTokens,
        cachedInputTokens: count(input.cached_tokens), outputTokens, reasoningTokens: count(output.reasoning_tokens) } };
    },
  };
}
