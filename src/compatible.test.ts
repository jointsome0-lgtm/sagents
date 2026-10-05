// The chat completions connection against a stand-in for the server. No network and no listening socket.
// These are here because a mistake in this file spends money twice or shows a key or a story.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createCompatible } from './compatible.ts';
import { modelFor } from './model.ts';

const KEY = 'sk-SECRET-KEY', STORY = 'A synthetic story.', WORDS = 'The server says in its own words';
const SECRETS = [KEY, STORY, WORDS];
const leaks = (value: unknown) => SECRETS.filter(secret => JSON.stringify(value, Object.getOwnPropertyNames(value ?? {})).includes(secret) || String(value).includes(secret));
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (content: string, finish = 'stop') => json(200, { choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 0 } } });
// What a server may put into a refusal: the key it was given and the request it read.
const refusal = (status: number, error: object = {}) => json(status, { error: { message: `${WORDS}: ${KEY} ${STORY}`, ...error } });
const env = { SAGENTS_API_URL: 'https://openrouter.ai/api/v1/', SAGENTS_API_KEY: KEY, SAGENTS_API_MAX_TOKENS: '512',
  SAGENTS_API_EXTRA: '{"reasoning":{"enabled":false}}' };
const request = { model: 'google/gemma-4-31b-it', system: 'Judge the story.', messages: [{ role: 'user' as const, content: STORY }],
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
type Thrown = { code?: string; httpStatus?: number; providerCode?: string; param?: string };
// A connection whose server gives one answer, and the requests that reached it.
function standIn(reply: () => Response, settings: object = env) {
  const calls: { url: string; init: RequestInit }[] = [];
  const { respond } = createCompatible({ env: { ...settings }, fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); } });
  return { calls, failed: (asked: object = request) => respond(asked as typeof request).then(() => assert.fail('an answer'), (thrown: unknown) => thrown as Thrown) };
}

test('an api: model goes to the server the address names, with what the caller gave, the limit and the extra fields', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer('{"ok":true}'); };
  const { respond, model } = modelFor(`api:${request.model}`, { env, fetch: fetcher });
  const parts: string[] = [];
  const result = await respond({ ...request, model }, { onText: (part: string) => { parts.push(part); } });
  assert.deepEqual(result, { text: '{"ok":true}', usage: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 30, reasoningTokens: 0 } });
  assert.deepEqual(parts, ['{"ok":true}']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    reasoning: { enabled: false }, model: 'google/gemma-4-31b-it',
    messages: [{ role: 'system', content: 'Judge the story.' }, { role: 'user', content: STORY }], max_tokens: 512,
    response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.schema } } });

  // Any other name is a model of the ChatGPT plan: nothing of it reaches the server of the address, and with no
  // account on this computer nothing is sent at all.
  const plan = modelFor('gpt-6.1-sol@low', { env, fetch: fetcher, path: join(mkdtempSync(join(tmpdir(), 'compatible-check-')), 'chatgpt.json') });
  assert.equal(plan.model, 'gpt-6.1-sol@low');
  const error = await plan.respond({ ...request, model: plan.model }).catch((thrown: unknown) => thrown) as Thrown;
  assert.equal(error.code, 'unauthorized');
  assert.equal(calls.length, 1);
});

test('settings that cannot be used are refused by name before anything is sent', async () => {
  const refusedBy = async (settings: object, asked: object = request) => {
    const server = standIn(() => answer('never'), settings);
    const error = await server.failed(asked);
    assert.equal(server.calls.length, 0);
    assert.equal(error.code, 'invalid_request');
    assert.deepEqual(leaks(error), []);
    return error.param;
  };
  assert.equal(await refusedBy({}), 'SAGENTS_API_URL');
  // The key and the text go over https or stay on this computer, with a key and without one.
  assert.equal(await refusedBy({ ...env, SAGENTS_API_URL: 'http://203.0.113.7:8000/v1' }), 'SAGENTS_API_URL');
  assert.equal(await refusedBy({ ...env, SAGENTS_API_URL: 'http://localhost.example.com/v1' }), 'SAGENTS_API_URL');
  assert.equal(await refusedBy({ SAGENTS_API_URL: 'http://203.0.113.7:8000/v1' }), 'SAGENTS_API_URL');
  assert.equal(await refusedBy({ ...env, SAGENTS_API_KEY: 'two\nlines' }), 'SAGENTS_API_KEY');
  assert.equal(await refusedBy({ ...env, SAGENTS_API_URL: `https://user:${KEY}@openrouter.ai/api/v1` }), 'SAGENTS_API_URL');
  // An extra field does not replace one that this module sets, the output limit above all.
  for (const extra of ['{"max_tokens":100000}', '{"model":"another"}', '{"messages":[]}', '{"stream":true}', '{"response_format":{}}', '[1]', '{'])
    assert.equal(await refusedBy({ ...env, SAGENTS_API_EXTRA: extra }), 'SAGENTS_API_EXTRA');
  assert.equal(await refusedBy({ ...env, SAGENTS_API_MAX_TOKENS: '2k' }), 'SAGENTS_API_MAX_TOKENS');
  assert.equal(await refusedBy(env, { ...request, model: 'google/gemma-4-31b-it@high' }), 'model');

  const sent: RequestInit[] = [];
  const local = createCompatible({ env: { SAGENTS_API_URL: 'http://127.0.0.1:8000/v1', SAGENTS_API_KEY: KEY },
    fetch: async (_url: string, init: RequestInit) => { sent.push(init); return answer('ok'); } });
  assert.equal((await local.respond(request)).text, 'ok');
  assert.equal((sent[0].headers as Record<string, string>).authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(sent[0].body as string).max_tokens, 2048);
});

test('a used up balance is budget_exceeded, nothing is sent again, and a failure carries no key and none of the server\'s words', async () => {
  const cases: [() => Response, Thrown][] = [
    [() => refusal(402, { code: 402 }), { code: 'budget_exceeded', httpStatus: 402 }],
    [() => refusal(429, { code: 'insufficient_quota', type: 'insufficient_quota' }), { code: 'budget_exceeded', httpStatus: 429, providerCode: 'insufficient_quota' }],
    [() => refusal(401, { code: `${KEY}` }), { code: 'unauthorized', httpStatus: 401 }],
    [() => refusal(429), { code: 'rate_limited', httpStatus: 429 }],
    [() => refusal(503), { code: 'model_unavailable', httpStatus: 503 }],
    [() => refusal(400, { code: 'invalid_value', param: 'response_format' }), { code: 'invalid_request', httpStatus: 400, providerCode: 'invalid_value', param: 'response_format' }],
    [() => refusal(400, { code: 400, type: 'exceed_context_size_error' }), { code: 'context_limit', httpStatus: 400, providerCode: 'exceed_context_size_error' }],
    [() => new Response(`${WORDS} ${KEY}`, { status: 502 }), { code: 'provider_failed', httpStatus: 502 }],
    // OpenRouter passes a failure of its provider on inside an answer that came with 200.
    [() => json(200, { error: { code: 402, message: `${WORDS} ${KEY}` } }), { code: 'budget_exceeded', httpStatus: 402 }],
    [() => new Response(`${WORDS} ${STORY}`, { status: 200 }), { code: 'invalid_response' }],
  ];
  for (const [reply, expected] of cases) {
    const server = standIn(reply);
    const error = await server.failed();
    assert.deepEqual({ code: error.code, httpStatus: error.httpStatus, providerCode: error.providerCode, param: error.param },
      { httpStatus: undefined, providerCode: undefined, param: undefined, ...expected });
    assert.deepEqual(leaks(error), []);
    assert.equal(server.calls.length, 1);
  }
  // A server that cannot be reached is a failure of its own kind, and the reason fetch gives stays behind.
  const { respond } = createCompatible({ env, fetch: async () => { throw new TypeError(`fetch failed ${KEY}`); } });
  const unreachable = await respond(request).catch((thrown: unknown) => thrown) as Thrown;
  assert.equal(unreachable.code, 'provider_failed');
  assert.deepEqual(leaks(unreachable), []);
});

test('an answer cut by the output limit, or without text, is a failure and its text is not given', async () => {
  for (const [reply, code] of [[() => answer(STORY, 'length'), 'output_limit'], [() => answer('  '), 'empty_response'],
    [() => answer(STORY, 'tool_use'), 'incomplete_stream'],
    // A server that declined to write, by its content filter or in a refusal of its own words, is `declined`.
    [() => answer(STORY, 'content_filter'), 'declined'], [() => json(200, { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: `${WORDS}: ${STORY}` } }] }), 'declined']] as [() => Response, string][]) {
    const server = standIn(reply);
    const error = await server.failed();
    assert.equal(error.code, code);
    assert.deepEqual(leaks(error), []);
    assert.equal(server.calls.length, 1);
  }
});

test('ask prints one line with codes for a refusal that quotes the key and the request', () => {
  // The command itself, with fetch replaced before it starts; the address is never asked.
  const body = JSON.stringify({ error: { code: 402, message: `${WORDS}: ${KEY} ${STORY}` } });
  const preload = `data:text/javascript,${encodeURIComponent(`globalThis.fetch = async () => new Response(${JSON.stringify(body)}, { status: 402 });`)}`;
  const run = spawnSync(process.execPath, ['--import', preload, join(import.meta.dirname, 'cli.ts'), 'ask'], { encoding: 'utf8', timeout: 30_000,
    input: JSON.stringify({ ...request, model: `api:${request.model}` }),
    env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'compatible-check-')), SAGENTS_API_URL: 'https://server.invalid/v1', SAGENTS_API_KEY: KEY } });
  assert.equal(run.stdout, '{"status":"failed","reason":"budget_exceeded","httpStatus":402}\n');
  assert.equal(run.status, 1);
  assert.deepEqual(leaks(`${run.stdout}${run.stderr}`), []);
});
