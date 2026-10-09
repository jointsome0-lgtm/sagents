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
  // The caller's name for the player is in this request and no setting names a field for it, so it is not sent.
  const result = await respond({ ...request, model, cache: 'player-1' }, { onText: (part: string) => { parts.push(part); } });
  assert.deepEqual(result, { text: '{"ok":true}', usage: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 30, reasoningTokens: 0 } });
  assert.deepEqual(parts, ['{"ok":true}']);
  // A router's name for the endpoint that answered is kept when it is a short plain name, any other string is one
  // fixed word, and what is no string is nothing: no word of the server's goes further by this field.
  const by = async (provider: unknown) => (await createCompatible({ env, fetch: async () => json(200, { ...await answer('{"ok":true}').json() as object, provider }) }).respond(request)).endpoint;
  assert.deepEqual([await by('Alpha/fp8'), await by(`${WORDS}: ${STORY}`), await by('Alpha\nBeta'), await by('x'.repeat(41)), await by(''), await by({ name: 'Alpha' }), await by(undefined)], ['Alpha/fp8', 'other', 'other', 'other', 'other', undefined, undefined]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    reasoning: { enabled: false }, model: 'google/gemma-4-31b-it',
    messages: [{ role: 'system', content: 'Judge the story.' }, { role: 'user', content: STORY }], max_tokens: 512,
    response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.schema } } });
  // Under the field that the setting names it is sent, in the body alone, and a request with no name has no such field.
  const named = createCompatible({ env: { ...env, SAGENTS_API_CACHE_FIELD: 'session_id' }, fetch: fetcher });
  await named.respond({ ...request, cache: 'player-1' });
  await named.respond(request);
  assert.deepEqual(calls.slice(1).map(call => JSON.parse(call.init.body as string).session_id), ['player-1', undefined]);
  assert.deepEqual(calls[1].init.headers, calls[0].init.headers);

  // Any other name is a model of the ChatGPT plan: nothing of it reaches the server of the address, and with no
  // account on this computer nothing is sent at all.
  const plan = modelFor('gpt-6.1-sol@low', { env, fetch: fetcher, path: join(mkdtempSync(join(tmpdir(), 'compatible-check-')), 'chatgpt.json') });
  assert.equal(plan.model, 'gpt-6.1-sol@low');
  const error = await plan.respond({ ...request, model: plan.model }).catch((thrown: unknown) => thrown) as Thrown;
  assert.equal(error.code, 'unauthorized');
  assert.equal(calls.length, 3);
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
  for (const extra of ['{"max_tokens":100000}', '{"model":"another"}', '{"messages":[]}', '{"stream":true}', '{"stream_options":{"include_usage":false}}', '{"response_format":{}}', '[1]', '{'])
    assert.equal(await refusedBy({ ...env, SAGENTS_API_EXTRA: extra }), 'SAGENTS_API_EXTRA');
  assert.equal(await refusedBy({ ...env, SAGENTS_API_MAX_TOKENS: '2k' }), 'SAGENTS_API_MAX_TOKENS');
  for (const stream of ['true', '0', ' 1']) assert.equal(await refusedBy({ ...env, SAGENTS_API_STREAM: stream }), 'SAGENTS_API_STREAM');
  assert.equal(await refusedBy(env, { ...request, model: 'google/gemma-4-31b-it@high' }), 'model');
  // The field for a player's name replaces no field of this module and none of the extra ones, and a name is plain.
  for (const field of ['max_tokens', 'reasoning', 'Session Id']) assert.equal(await refusedBy({ ...env, SAGENTS_API_CACHE_FIELD: field }), 'SAGENTS_API_CACHE_FIELD');
  assert.equal(await refusedBy(env, { ...request, cache: 'two\nlines' }), 'cache');

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

test('a stream is an answer only when it came whole: its text and usage, and a failure without the text when it broke off, held an error or was cut', async () => {
  const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } } })}\n\n`;
  // The events arrive cut at every third byte, so a line and a character are split between two readings.
  const stream = (events: string) => () => {
    const bytes = new TextEncoder().encode(events);
    return new Response(new ReadableStream({ start(controller) {
      for (let at = 0; at < bytes.length; at += 3) controller.enqueue(bytes.slice(at, at + 3));
      controller.close();
    } }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  };
  const streaming = { ...env, SAGENTS_API_STREAM: '1' };
  const calls: { url: string; init: RequestInit }[] = [];
  const whole = `: a comment\r\n\r\n${chunk({ role: 'assistant', content: '' })}${chunk({ reasoning_content: WORDS })}${chunk({ reasoning: WORDS })}${chunk({ content: '{"ok":' }).replaceAll('\n', '\r\n')}${chunk({ content: 'true}  \u2014' })}${chunk({}, 'stop')}${usage}data: [DONE]\n\n`;
  const { respond } = createCompatible({ env: streaming, fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return stream(whole)(); } });
  const parts: string[] = [];
  assert.deepEqual(await respond(request, { onText: (part: string) => { parts.push(part); } }),
    { text: '{"ok":true}  \u2014', usage: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 30, reasoningTokens: null } });
  assert.deepEqual(parts, ['{"ok":', 'true}  \u2014']);
  const multiline = createCompatible({ env: streaming, fetch: async () => stream('data: {"choices":\r\n: a comment\r\nevent: message\r\ndata: [{"delta":{"content":"ok"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\n')() });
  assert.equal((await multiline.respond(request)).text, 'ok');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].init.headers, { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'text/event-stream' });
  // The body is the one of a request without the setting, and the two fields of a stream after it.
  const unset = createCompatible({ env: { ...env, SAGENTS_API_STREAM: '' }, fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer('{"ok":true}'); } });
  await unset.respond(request);
  assert.equal(calls[1].init.body, JSON.stringify({ reasoning: { enabled: false }, model: request.model,
    messages: [{ role: 'system', content: 'Judge the story.' }, { role: 'user', content: STORY }], max_tokens: 512,
    response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.schema } } }));
  assert.equal(calls[0].init.body, `${(calls[1].init.body as string).slice(0, -1)},"stream":true,"stream_options":{"include_usage":true}}`);

  const said = chunk({ content: STORY });
  for (const [events, expected] of [
    // No `[DONE]`: the server or the connection gave up, also after a finish and the usage.
    [`${said}${chunk({}, 'stop')}${usage}`, { code: 'incomplete_stream' }],
    [`${said}data: {"error":{"code":"engine_unavailable","message":${JSON.stringify(`${WORDS}: ${KEY} ${STORY}`)}}}\n\n`, { code: 'provider_failed', providerCode: 'engine_unavailable' }],
    [`${said}data: {"error":{"code":402,"message":"${WORDS}"}}\n\ndata: [DONE]\n\n`, { code: 'budget_exceeded', httpStatus: 402 }],
    [`${said}${chunk({}, 'length')}${usage}data: [DONE]\n\n`, { code: 'output_limit' }],
    [`${said}${chunk({}, 'content_filter')}data: [DONE]\n\n`, { code: 'declined' }],
    [`${said}${chunk({ tool_calls: [{ index: 0, function: { name: 'look', arguments: WORDS } }] })}`, { code: 'unexpected_tools' }],
    [`${said}data: ${WORDS} ${KEY}\n\ndata: [DONE]\n\n`, { code: 'invalid_stream' }],
    [`${chunk({ content: ' ' }, 'stop')}data: [DONE]\n\n`, { code: 'empty_response' }],
  ] as [string, Thrown][]) {
    const server = standIn(stream(events), streaming);
    const error = await server.failed();
    assert.deepEqual({ code: error.code, httpStatus: error.httpStatus, providerCode: error.providerCode, param: error.param },
      { httpStatus: undefined, providerCode: undefined, param: undefined, ...expected });
    assert.deepEqual(leaks(error), []);
    assert.equal(server.calls.length, 1);
  }
  // A refusal by the status is read as without the setting.
  const refused = await standIn(() => refusal(400, { code: 'limit_exceeded' }), streaming).failed();
  assert.deepEqual([refused.code, refused.httpStatus, refused.providerCode, leaks(refused)], ['invalid_request', 400, 'limit_exceeded', []]);
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
  // A run that ends at such a failure says in its closing line which it was, by the status and the server's own code.
  const broken = JSON.stringify({ error: { code: 'bad_gateway', message: `${WORDS}: ${KEY} ${STORY}` } });
  const live = spawnSync(process.execPath, ['--import', preload.replace(encodeURIComponent(JSON.stringify(body)), encodeURIComponent(JSON.stringify(broken))).replace('402', '502'),
    join(import.meta.dirname, 'cli.ts'), 'live', join(import.meta.dirname, '../examples/night-station.json'), '--model', `api:${request.model}`], { encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'compatible-check-')), SAGENTS_API_URL: 'https://server.invalid/v1', SAGENTS_API_KEY: KEY } });
  assert.match(live.stdout, /^failed \(provider_failed 502 bad_gateway\): 0 story minutes, 0 calls, /m);
  assert.equal(live.status, 1);
  assert.deepEqual(leaks(`${live.stdout}${live.stderr}`), []);
  // A run whose answers came from two endpoints of one model counts them in the model's line.
  const wait = { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ action: 'wait', text: null, to: null, place: null, seconds: 600, until: null, note: null }) } }] };
  const routed = `data:text/javascript,${encodeURIComponent(`let n = 0; globalThis.fetch = async () => new Response(JSON.stringify({ ...${JSON.stringify(wait)}, provider: n++ % 3 ? 'Alpha' : 'Beta/fp8' }), { status: 200 });`)}`;
  const two = spawnSync(process.execPath, ['--import', routed, join(import.meta.dirname, 'cli.ts'), 'live', join(import.meta.dirname, '../examples/night-station.json'), '--model', `api:${request.model}`, '--calls', '3'],
    { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'compatible-check-')), SAGENTS_API_URL: 'https://server.invalid/v1', SAGENTS_API_KEY: KEY } });
  assert.match(two.stdout, /\n  api:google\/gemma-4-31b-it: 3 calls, [^\n]* output tokens, without 3 answers that reported no usage, answered by Beta\/fp8 1, Alpha 2\n/);
});

test('HTTP failures keep their status when the body breaks or is too large, and an oversized body is not cancelled with a held reader', async () => {
  for (const [status, code] of [[402, 'budget_exceeded'], [401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [503, 'model_unavailable'], [400, 'invalid_request'], [422, 'invalid_request']] as const) {
    for (const broken of [true, false]) {
      const response = new Response(new ReadableStream({ start(controller) {
        if (broken) controller.error(new TypeError('broken body'));
        else { controller.enqueue(new Uint8Array(4_000_001)); controller.close(); }
      } }), { status });
      const error = await standIn(() => response).failed();
      assert.deepEqual([error.code, error.httpStatus, leaks(error)], [code, status, []]);
    }
  }
  let cancelled = false;
  const waiting = new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }), { status: 402 });
  assert.equal((await standIn(() => waiting).failed()).code, 'budget_exceeded');
  assert.ok(cancelled);
  const locked = new Response('unused', { status: 402 }), reader = locked.body!.getReader();
  let touched = false;
  locked.body!.cancel = async () => { touched = true; };
  assert.equal((await standIn(() => locked).failed()).code, 'budget_exceeded');
  assert.ok(!touched);
  reader.releaseLock();
  const error = await standIn(() => new Response(new Uint8Array(4_000_001))).failed();
  assert.equal(error.code, 'invalid_response');
});

test('a limit or an abort ends a text callback, for a stream and for an answer given whole', async () => {
  for (const streaming of [false, true]) {
    const reply = () => streaming ? new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') : answer('ok');
    const { respond } = createCompatible({ env: { ...env, ...(streaming ? { SAGENTS_API_STREAM: '1' } : {}) }, fetch: async () => reply() });
    const held = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(respond(request, { timeoutMs: 20, onText: () => new Promise(() => {}) }), { code: 'timeout' });
      await assert.rejects(respond(request, { timeoutMs: 20, onText: () => { const until = performance.now() + 30; while (performance.now() < until) {} } }), { code: 'timeout' });
      const stopped = new AbortController();
      await assert.rejects(respond(request, { signal: stopped.signal, onText: () => { stopped.abort(); return new Promise(() => {}); } }), { code: 'cancelled' });
      const aborted = new AbortController();
      await assert.rejects(respond(request, { signal: aborted.signal, onText: () => aborted.abort() }), { code: 'cancelled' });
      await assert.rejects(respond(request, { timeoutMs: 20, onText: () => new Promise(resolve => setTimeout(resolve, 40)) }), { code: 'timeout' });
    } finally { clearTimeout(held); }
  }
});

test('a stream keeps an output limit and rejects text after its end, while an empty final piece is ignored', async () => {
  const chunk = (content: string, finish: string | null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;
  const failed = (events: string) => standIn(() => new Response(`${events}data: [DONE]\n\n`), { ...env, SAGENTS_API_STREAM: '1' }).failed();
  assert.equal((await failed(chunk('partial', 'length') + chunk('', 'stop'))).code, 'output_limit');
  assert.equal((await failed(chunk('whole', 'stop') + chunk(' extra', null))).code, 'invalid_stream');
  const { respond } = createCompatible({ env: { ...env, SAGENTS_API_STREAM: '1' }, fetch: async () => new Response(`${chunk('whole', 'stop')}${chunk('', null)}data: [DONE]\n\n`) });
  assert.equal((await respond(request)).text, 'whole');
});
