// The sign-in and the request against a stand-in for OpenAI's sign-in service and Responses API. No network.
// These are here because a mistake in this file loses a session or shows a token; the rest of sagents is not tested this way.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs, { chmodSync, lstatSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createChatgpt, responsesBody, signIn } from './chatgpt.ts';

const SECRETS = ['ACCESS-OLD', 'ACCESS-NEW', 'REFRESH-OLD', 'REFRESH-NEW', 'ACCESS-SIGNIN', 'REFRESH-SIGNIN'];
const leaks = (value: unknown) => SECRETS.filter(secret => JSON.stringify(value, Object.getOwnPropertyNames(value ?? {})).includes(secret) || String(value).includes(secret));
const folder = () => mkdtempSync(join(tmpdir(), 'chatgpt-check-'));
const account = (path: string, patch: object = {}) => writeFileSync(path, JSON.stringify({ hostId: 'urn:uuid:host', clientId: 'oaiapp_1', subject: 'sub-1',
  accessToken: 'ACCESS-OLD', refreshToken: 'REFRESH-OLD', expiresAt: Date.now() + 3_600_000,
  scopes: ['chatgpt.tokens.use.direct', 'offline_access', 'openid'], ...patch }), { mode: 0o600 });
// The plan's route names no content type for its stream, so the stand-in for it names none: bytes carry no type of their own.
const sse = (events: object[]) => new Response(new TextEncoder().encode(
  events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')), { status: 200 });
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (text: string, usage = { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 20 } }) => sse([
  { type: 'response.created', response: {} },
  { type: 'response.output_item.added', item: { type: 'reasoning' } },
  { type: 'response.output_item.added', item: { type: 'message' } },
  ...text.match(/.{1,3}/gs)!.map(delta => ({ type: 'response.output_text.delta', delta })),
  { type: 'response.completed', response: { usage } },
]);
const request = { model: 'gpt-6.1-sol@high', system: 'Judge the story.', messages: [{ role: 'user' as const, content: 'A story.' }],
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
const refreshed = (scope?: string) => json(200, { access_token: 'ACCESS-NEW', refresh_token: 'REFRESH-NEW', expires_in: 3600, token_type: 'Bearer', ...(scope ? { scope } : {}) });

test('a request holds only what the caller gave, and the answer comes with its usage', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path);
  const calls: { url: string; init: RequestInit }[] = [];
  const chatgpt = createChatgpt({ path, fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer('{"ok":true}'); } });
  const deltas: string[] = [];
  const result = await chatgpt.respond(request, { onText: (delta: string) => { deltas.push(delta); } });
  assert.equal(result.text, '{"ok":true}');
  assert.equal(deltas.join(''), '{"ok":true}');
  assert.deepEqual(result.usage, { inputTokens: 120, cachedInputTokens: 100, outputTokens: 30, reasoningTokens: 20 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer ACCESS-OLD');
  assert.equal(calls[0].init.redirect, 'error');
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, responsesBody(request));
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'reasoning', 'store', 'stream', 'text']);
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.equal(body.text?.format.strict, true);
  // A request with no name for its player is sent with none. One that has a name carries it as the cache key and as
  // the session of two headers, and a name that would be a second header is refused before anything is sent.
  assert.deepEqual(Object.keys(calls[0].init.headers as object).sort(), ['accept', 'authorization', 'content-type']);
  await chatgpt.respond({ ...request, cache: 'player-1' });
  assert.equal(JSON.parse(calls[1].init.body as string).prompt_cache_key, 'player-1');
  assert.deepEqual({ ...calls[1].init.headers as object, authorization: '' }, { ...calls[0].init.headers as object, authorization: '', 'session-id': 'player-1', 'x-client-request-id': 'player-1' });
  const error = await chatgpt.respond({ ...request, cache: 'player\r\nx-other: 1' }).catch((thrown: unknown) => thrown) as { code?: string; param?: string };
  assert.deepEqual([error.code, error.param, calls.length], ['invalid_request', 'cache', 2]);
});

test('an expiring token is refreshed once, both tokens are replaced together and the file stays private', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path, { expiresAt: Date.now() + 60_000 });
  let refreshes = 0;
  const seen: string[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    if (url.endsWith('/oauth/token')) {
      refreshes++;
      const form = new URLSearchParams(init.body as string);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('client_id'), 'oaiapp_1');
      assert.equal(form.get('refresh_token'), 'REFRESH-OLD');
      assert.equal(form.get('resource'), 'https://api.openai.com/v1');
      assert.equal(form.get('scope'), null);
      await new Promise(resolve => setTimeout(resolve, 150));
      return refreshed();
    }
    seen.push((init.headers as Record<string, string>).authorization);
    return answer('ok');
  };
  // Two adapters stand for two processes: they share nothing but the file and its lock.
  const first = createChatgpt({ path, fetch: fetcher }), second = createChatgpt({ path, fetch: fetcher });
  const results = await Promise.all([first.respond(request), second.respond(request), first.respond(request)]);
  assert.deepEqual(results.map(result => result.text), ['ok', 'ok', 'ok']);
  assert.equal(refreshes, 1);
  assert.deepEqual(seen, ['Bearer ACCESS-NEW', 'Bearer ACCESS-NEW', 'Bearer ACCESS-NEW']);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.accessToken, 'ACCESS-NEW');
  assert.equal(saved.refreshToken, 'REFRESH-NEW');
  assert.deepEqual(saved.scopes, ['chatgpt.tokens.use.direct', 'offline_access', 'openid']);
  assert.equal(saved.clientId, 'oaiapp_1');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(lstatSync(`${path}.lock`, { throwIfNoEntry: false }), undefined);

  // A pair that cannot be written after the old refresh token was spent is a failure said aloud, and no request goes
  // out with the old token. (An administrator may write anywhere, so there is nothing to see as one.)
  if (process.getuid?.() !== 0) {
    const dir = folder(), locked = join(dir, 'chatgpt.json');
    account(locked, { expiresAt: Date.now() + 120_000 });
    const sent: string[] = [];
    const unwritable = createChatgpt({ path: locked, fetch: async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth/token')) { chmodSync(dir, 0o500); return refreshed(); }
      sent.push((init.headers as Record<string, string>).authorization);
      return answer('ok');
    } });
    // The time limit passes while the pair is tried again, and still the failure is not said as a time limit.
    const error = await unwritable.respond(request, { timeoutMs: 50 }).catch((thrown: unknown) => thrown) as { code?: string };
    chmodSync(dir, 0o700);
    assert.equal(error.code, 'storage_failed');
    assert.deepEqual(sent, []);

    // An account that is there and cannot be read is a failure too, and a sign-in does not write a new one over it.
    const closed = join(folder(), 'chatgpt.json');
    account(closed);
    chmodSync(closed, 0o000);
    const refused = await signIn({ path: closed, fetch: async () => answer('never'), show: () => {} }).catch((thrown: unknown) => thrown) as { code?: string };
    chmodSync(closed, 0o600);
    assert.equal(refused.code, 'storage_failed');
    assert.equal(JSON.parse(readFileSync(closed, 'utf8')).refreshToken, 'REFRESH-OLD');
  }
});

test('a spent refresh token ends the session, keeps the registration and says only a code', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path, { expiresAt: Date.now() - 1000 });
  const chatgpt = createChatgpt({ path, fetch: async (url: string) => url.endsWith('/oauth/token')
    ? json(400, { error: 'refresh_token_reused', error_description: 'REFRESH-OLD was already used' }) : answer('never') });
  const error = await chatgpt.respond(request).catch((thrown: unknown) => thrown) as { code?: string };
  assert.equal(error.code, 'unauthorized');
  assert.deepEqual(leaks(error), []);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { hostId: 'urn:uuid:host', clientId: 'oaiapp_1', subject: 'sub-1' });
  assert.deepEqual(chatgpt.status(), { signedIn: false, planUse: false, minutesLeft: 0 });
  const again = await chatgpt.respond(request).catch((thrown: unknown) => thrown) as { code?: string };
  assert.equal(again.code, 'unauthorized');

  // A refused client is not a spent token: nothing is erased, and the token still in hand does not hide the refusal.
  const kept = join(folder(), 'chatgpt.json');
  account(kept, { expiresAt: Date.now() + 120_000 });
  const refusal = await createChatgpt({ path: kept, fetch: async (url: string) => url.endsWith('/oauth/token')
    ? json(401, { error: 'invalid_client' }) : answer('never') }).respond(request).catch((thrown: unknown) => thrown) as { code?: string; providerCode?: string };
  assert.deepEqual([refusal.code, refusal.providerCode], ['unauthorized', 'invalid_client']);
  assert.equal(JSON.parse(readFileSync(kept, 'utf8')).refreshToken, 'REFRESH-OLD');
});

test('a sign-in service that does not answer leaves a still valid token in use and the session intact', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path, { expiresAt: Date.now() + 120_000 });
  const chatgpt = createChatgpt({ path, fetch: async (url: string) => {
    if (url.endsWith('/oauth/token')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return answer('ok');
  } });
  assert.equal((await chatgpt.respond(request)).text, 'ok');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).refreshToken, 'REFRESH-OLD');
  account(path, { expiresAt: Date.now() + 5_000 });
  const error = await chatgpt.respond(request).catch((thrown: unknown) => thrown) as { code?: string };
  assert.equal(error.code, 'provider_failed');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).refreshToken, 'REFRESH-OLD');
});

test('failures of the API become codes, a used up limit is budget_exceeded, and nothing of the answer is carried', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path);
  const cases: [Response | (() => Response), string][] = [
    [json(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'ACCESS-OLD limit' } }), 'budget_exceeded'],
    [json(429, { error: { code: 'rate_limit_exceeded' } }), 'rate_limited'],
    [json(401, { detail: 'ACCESS-OLD not accepted' }), 'unauthorized'],
    [json(403, { error: { code: 'subscription_sharing_user_not_eligible' } }), 'unauthorized'],
    [json(503, { error: { code: 'subscription_sharing_usage_unavailable' } }), 'model_unavailable'],
    [json(400, { error: { code: 'subscription_sharing_unsupported_capability', param: 'text' } }), 'invalid_request'],
    [json(500, { error: { code: 'server_error' } }), 'provider_failed'],
    [sse([{ type: 'response.created' }, { type: 'response.output_text.delta', delta: 'par' },
      { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'ACCESS-OLD' } } }]), 'budget_exceeded'],
    [sse([{ type: 'error', code: 'subscription_sharing_usage_unavailable', message: 'x' }]), 'model_unavailable'],
    [sse([{ type: 'response.output_item.added', item: { type: 'function_call' } }]), 'unexpected_tools'],
    [sse([{ type: 'response.output_text.delta', delta: 'cut' }]), 'incomplete_stream'],
    [sse([{ type: 'response.output_item.added', item: { type: 'message' } }, { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 0 } } }]), 'empty_response'],
    [sse([{ type: 'response.output_text.delta', delta: 'x' }, { type: 'response.incomplete', response: { incomplete_details: { reason: 'pause' } } }]), 'incomplete_stream'],
    // The service declined to write, in each shape it may say so: by its content filter, in events of a refusal, and in a part of the closing event.
    [sse([{ type: 'response.output_text.delta', delta: 'x' }, { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }]), 'declined'],
    [sse([{ type: 'response.output_item.added', item: { type: 'message' } }, { type: 'response.refusal.delta', delta: 'ACCESS-OLD' }]), 'declined'],
    [sse([{ type: 'response.refusal.done', refusal: 'ACCESS-OLD' }]), 'declined'],
    [sse([{ type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'ACCESS-OLD' }] }], usage: { input_tokens: 5, output_tokens: 3 } } }]), 'declined'],
    [new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }), 'invalid_stream'],
    // An answer the model's own limit cut short is a failure, whatever was written by then.
    [sse([{ type: 'response.output_text.delta', delta: 'long' },
      { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 9, output_tokens: 4 } } }]), 'output_limit'],
  ];
  for (const [response, code] of cases) {
    const chatgpt = createChatgpt({ path, fetch: async () => typeof response === 'function' ? response() : response });
    const error = await chatgpt.respond(request).catch((thrown: unknown) => thrown) as { code?: string };
    assert.equal(error.code, code);
    assert.deepEqual(leaks(error), []);
  }
  // The service says which model answers. Another one than was asked for is a failure, before any of its text is
  // passed on and whatever it wrote; the same one, and a stream that names none, are an answer.
  const naming = (model?: string) => sse([{ type: 'response.created', response: model === undefined ? {} : { model } }, { type: 'response.output_text.delta', delta: 'ok' },
    { type: 'response.completed', response: { ...(model === undefined ? {} : { model }), usage: { input_tokens: 5, output_tokens: 1 } } }]);
  const passed: string[] = [];
  const moved = await createChatgpt({ path, fetch: async () => naming('gpt-6.1-luna') }).respond(request, { onText: (delta: string) => { passed.push(delta); } })
    .catch((thrown: unknown) => thrown) as { code?: string };
  assert.deepEqual([moved.code, passed], ['wrong_model', []]);
  assert.equal((await createChatgpt({ path, fetch: async () => naming('gpt-6.1-sol') }).respond(request)).text, 'ok');
  assert.equal((await createChatgpt({ path, fetch: async () => naming() }).respond(request)).text, 'ok');
  // The service's own code and the field it names are kept when they are identifiers, and dropped when they are text.
  const refused = async (body: object) => await createChatgpt({ path, fetch: async () => json(400, body) }).respond(request)
    .catch((thrown: unknown) => thrown) as { code?: string; httpStatus?: number; providerCode?: string; param?: string };
  const named = await refused({ error: { code: 'subscription_sharing_unsupported_capability', param: 'reasoning.effort', message: 'ACCESS-OLD' } });
  assert.deepEqual([named.code, named.httpStatus, named.providerCode, named.param], ['invalid_request', 400, 'subscription_sharing_unsupported_capability', 'reasoning.effort']);
  const worded = await refused({ error: { code: 'ACCESS-OLD was refused', param: 'see ACCESS-OLD' } });
  assert.deepEqual([worded.code, worded.providerCode, worded.param], ['invalid_request', undefined, undefined]);
  assert.deepEqual(leaks(worded), []);
  // The closing event ends the reading even when the service leaves the connection open after it.
  const open = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed', response: {} }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
  } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  assert.equal((await createChatgpt({ path, fetch: async () => open }).respond(request, { timeoutMs: 2000 })).text, 'ok');
  const slow = createChatgpt({ path, fetch: (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) =>
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason))) });
  assert.equal(((await slow.respond(request, { timeoutMs: 50 }).catch((thrown: unknown) => thrown)) as { code?: string }).code, 'timeout');
  const stopped = new AbortController();
  const waiting = createChatgpt({ path, fetch: (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) =>
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason))) }).respond(request, { signal: stopped.signal });
  stopped.abort();
  assert.equal(((await waiting.catch((thrown: unknown) => thrown)) as { code?: string }).code, 'cancelled');
});

// The stand-in for the sign-in service: signs ID tokens with its own key and publishes that key.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', use: 'sig', alg: 'RS256' };
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(claims: object, key = privateKey, alg = 'RS256') {
  const signed = `${part({ alg, kid: 'key-1', typ: 'JWT' })}.${part(claims)}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), key).toString('base64url')}`;
}
// The browser's request, on a connection of its own each time: a pooled one would outlive the listener of an earlier attempt.
const visit = (url: URL) => new Promise<number>((resolve, reject) => {
  get(url, { agent: false }, response => { response.resume(); response.on('end', () => resolve(response.statusCode ?? 0)); }).on('error', reject);
});
type Service = { claims?: (nonce: string, clientId: string) => object; scope?: string; key?: typeof privateKey; callback?: (redirect: URL, state: string) => URL; refuse?: number };
async function attempt(path: string, service: Service = {}, options: { register?: boolean } = {}) {
  let nonce = '', challenge = '', grants = 0;
  const forms: URLSearchParams[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    if (url.endsWith('/jwks.json')) return json(200, { keys: [jwk] });
    if (url.endsWith('/oauth/token')) {
      grants++;
      const form = new URLSearchParams(init.body as string);
      forms.push(form);
      if (grants <= (service.refuse ?? 0)) return json(400, { error: 'invalid_grant', error_description: 'CODE-1 was refused' });
      const clientId = form.get('client_id')!;
      const claims = service.claims?.(nonce, clientId) ?? { iss: 'https://auth.openai.com', aud: clientId, sub: 'sub-1', nonce, exp: Math.floor(Date.now() / 1000) + 600, email: 'person@example.com' };
      return json(200, { access_token: 'ACCESS-SIGNIN', refresh_token: 'REFRESH-SIGNIN', expires_in: 3600, token_type: 'Bearer',
        id_token: idToken(claims, service.key), scope: service.scope ?? 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke' });
    }
    throw new Error(`unexpected ${url}`);
  };
  let address: URL | undefined;
  const result = await signIn({ path, fetch: fetcher, timeoutMs: 3000, ...options, show: (shown: string) => {
    address = new URL(shown);
    nonce = address.searchParams.get('nonce')!;
    challenge = address.searchParams.get('code_challenge')!;
    const redirect = new URL(address.searchParams.get('redirect_uri')!), state = address.searchParams.get('state')!;
    const back = service.callback?.(redirect, state) ?? (() => {
      redirect.searchParams.set('code', 'CODE-1');
      redirect.searchParams.set('state', state);
      if (address!.searchParams.get('client_id') === 'dynamic_agent_client') redirect.searchParams.set('client_id', 'oaiapp_new');
      return redirect;
    })();
    // A stranger's request with another state must not end the attempt.
    const stranger = new URL(back);
    stranger.searchParams.set('state', 'not-this-attempt');
    void visit(stranger).then(status => { assert.equal(status, 404); return visit(back); }).catch(error => { console.log('browser stand-in failed:', error?.code ?? error?.message); });
  } }).then(value => ({ value }), (error: unknown) => ({ error }));
  return { result, address: address!, forms, grants: () => grants, challenge };
}

test('a first sign-in registers the tool, checks the ID token and keeps tokens in a private file', async () => {
  const path = join(folder(), 'nested', 'chatgpt.json');
  const { result, address, forms } = await attempt(path);
  assert.deepEqual(result, { value: { planUse: true } });
  assert.equal(address.origin + address.pathname, 'https://auth.openai.com/api/accounts/authorize');
  const sent = Object.fromEntries(address.searchParams);
  assert.equal(sent.client_id, 'dynamic_agent_client');
  assert.equal(sent.agent_name_hint, 'sagents');
  assert.match(sent.ext_agent_host_id, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(sent.response_type, 'code');
  assert.match(sent.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.equal(sent.scope, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
  assert.equal(sent.resource, 'https://api.openai.com/v1');
  assert.equal(sent.code_challenge_method, 'S256');
  assert.equal(forms.length, 1);
  assert.equal(forms[0].get('grant_type'), 'authorization_code');
  assert.equal(forms[0].get('client_id'), 'oaiapp_new');
  assert.equal(forms[0].get('code'), 'CODE-1');
  assert.equal(forms[0].get('redirect_uri'), sent.redirect_uri);
  assert.equal(forms[0].get('resource'), 'https://api.openai.com/v1');
  assert.equal(createHash('sha256').update(forms[0].get('code_verifier')!).digest('base64url'), sent.code_challenge);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['accessToken', 'clientId', 'expiresAt', 'hostId', 'refreshToken', 'scopes', 'subject']);
  assert.equal(saved.hostId, sent.ext_agent_host_id);
  assert.equal(saved.clientId, 'oaiapp_new');
  assert.equal(saved.subject, 'sub-1');
  assert.equal(JSON.stringify(saved).includes('person@example.com'), false);
  assert.equal(statSync(path).mode & 0o777, 0o600);

  // A returning sign-in uses the issued client and the same host, sends no name hint and accepts a callback without a client id.
  const again = await attempt(path);
  assert.deepEqual(again.result, { value: { planUse: true } });
  assert.equal(again.address.searchParams.get('client_id'), 'oaiapp_new');
  assert.equal(again.address.searchParams.get('agent_name_hint'), null);
  assert.equal(again.address.searchParams.get('ext_agent_host_id'), saved.hostId);
  assert.equal(again.forms[0].get('client_id'), 'oaiapp_new');

  // Another account than the registration's own is refused and the saved session stays.
  const other = await attempt(path, { claims: (nonce, clientId) => ({ iss: 'https://auth.openai.com', aud: clientId, sub: 'sub-2', nonce, exp: Math.floor(Date.now() / 1000) + 600 }) });
  assert.match(String((other.result as { error: Error }).error.message), /Another account/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).subject, 'sub-1');
  // A callback that names another client is refused before any code is exchanged.
  const swapped = await attempt(path, { callback: (redirect, state) => { redirect.searchParams.set('code', 'CODE-1'); redirect.searchParams.set('state', state); redirect.searchParams.set('client_id', 'oaiapp_other'); return redirect; } });
  assert.match(String((swapped.result as { error: Error }).error.message), /did not name its client/);
  assert.equal(swapped.grants(), 0);

  // A code the service refuses starts the authorization once more with the client just issued, not a second registration.
  const retried = await attempt(join(folder(), 'chatgpt.json'), { refuse: 1 });
  assert.deepEqual(retried.result, { value: { planUse: true } });
  assert.equal(retried.address.searchParams.get('client_id'), 'oaiapp_new');
  assert.equal(retried.address.searchParams.get('agent_name_hint'), null);
  assert.equal(retried.grants(), 2);
});

test('a sign-in that cannot be verified, was declined or lacks the plan permission leaves no tokens', async () => {
  const base = (nonce: string, clientId: string) => ({ iss: 'https://auth.openai.com', aud: clientId, sub: 'sub-1', nonce, exp: Math.floor(Date.now() / 1000) + 600 });
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const refusals: Service[] = [
    { claims: (nonce, clientId) => ({ ...base(nonce, clientId), nonce: 'another' }) },
    { claims: (nonce, clientId) => ({ ...base(nonce, clientId), iss: 'https://example.com' }) },
    { claims: nonce => ({ ...base(nonce, 'oaiapp_someone_else') }) },
    { claims: (nonce, clientId) => ({ ...base(nonce, clientId), exp: Math.floor(Date.now() / 1000) - 600 }) },
    { key: stranger },
  ];
  for (const service of refusals) {
    const path = join(folder(), 'chatgpt.json');
    const { result } = await attempt(path, service);
    const error = (result as { error: Error }).error;
    assert.equal(error.message, 'The sign-in could not be verified');
    assert.deepEqual(leaks(error), []);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))), ['hostId']);
  }
  const declinedPath = join(folder(), 'chatgpt.json');
  const declined = await attempt(declinedPath, { callback: (redirect, state) => { redirect.searchParams.set('error', 'access_denied'); redirect.searchParams.set('state', state); return redirect; } });
  assert.equal((declined.result as { error: Error }).error.message, 'The sign-in was declined');
  assert.equal(declined.grants(), 0);
  const unregistered = await attempt(join(folder(), 'chatgpt.json'), { callback: (redirect, state) => { redirect.searchParams.set('code', 'CODE-1'); redirect.searchParams.set('state', state); return redirect; } });
  assert.match((unregistered.result as { error: Error }).error.message, /did not name its client/);
  assert.equal(unregistered.grants(), 0);

  const path = join(folder(), 'chatgpt.json');
  const { result } = await attempt(path, { scope: 'email offline_access openid profile' });
  assert.deepEqual(result, { value: { planUse: false } });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort(), ['clientId', 'declined', 'hostId', 'subject']);
  const chatgpt = createChatgpt({ path, fetch: async () => answer('never') });
  assert.equal(((await chatgpt.respond(request).catch((thrown: unknown) => thrown)) as { code?: string }).code, 'unauthorized');
  // The sign-in after a refusal asks for the permission again; the one after that does not.
  const asked = await attempt(path);
  assert.equal(asked.address.searchParams.get('prompt'), 'consent');
  assert.deepEqual(asked.result, { value: { planUse: true } });
  assert.equal((await attempt(path)).address.searchParams.get('prompt'), null);
});

test('a closing event must hold a response, no tool call, and the same text as its pieces', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path);
  const closing = (response: unknown) => sse([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed', response }]);
  for (const [response, code] of [[null, 'invalid_stream'], [undefined, 'invalid_stream'],
    [{ output: [{ type: 'function_call', name: 'look' }] }, 'unexpected_tools'],
    [{ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok missing tail' }] }] }, 'invalid_stream']] as const) {
    await assert.rejects(createChatgpt({ path, fetch: async () => closing(response) }).respond(request), { code });
  }
  assert.equal((await createChatgpt({ path, fetch: async () => closing({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) }).respond(request)).text, 'ok');
});

test('a limit or an abort ends a text callback even when it never settles', async () => {
  const path = join(folder(), 'chatgpt.json');
  account(path);
  const { respond } = createChatgpt({ path, fetch: async () => answer('ok') });
  const held = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(respond(request, { timeoutMs: 20, onText: () => new Promise(() => {}) }), { code: 'timeout' });
    await assert.rejects(respond(request, { timeoutMs: 20, onText: () => { const until = performance.now() + 30; while (performance.now() < until) {} } }), { code: 'timeout' });
    const stopped = new AbortController();
    await assert.rejects(respond(request, { signal: stopped.signal, onText: () => { stopped.abort(); return new Promise(() => {}); } }), { code: 'cancelled' });
  } finally { clearTimeout(held); }
});

test('waiting renewals keep a live holder and reuse the saved tokens, ignoring the old lock link', async context => {
  const path = join(folder(), 'chatgpt.json'), lock = `${path}.renew.sqlite`;
  account(path, { expiresAt: Date.now() - 1000 });
  fs.symlinkSync('dead', `${path}.lock`);
  let clock = 0, refreshes = 0;
  let ready: () => void = () => {}, finish: () => void = () => {};
  const began = new Promise<void>(resolve => { ready = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  const fetcher = async (url: string) => {
    if (!url.endsWith('/oauth/token')) return answer('ok');
    refreshes += 1;
    ready();
    await held;
    return refreshed();
  };
  const first = createChatgpt({ path, fetch: fetcher }), second = createChatgpt({ path, fetch: fetcher });
  context.mock.method(performance, 'now', () => clock);
  try {
    const waiting = first.respond(request);
    await began;
    const other = second.respond(request);
    clock = 61_000;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(refreshes, 1);
    finish();
    assert.deepEqual((await Promise.all([waiting, other])).map(result => result.text), ['ok', 'ok']);
    assert.equal(refreshes, 1);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).refreshToken, 'REFRESH-NEW');
    assert.equal(statSync(lock).mode & 0o777, statSync(path).mode & 0o777);
    assert.equal(fs.readlinkSync(`${path}.lock`), 'dead');
    assert.equal(lstatSync(`${path}.lock.guard`, { throwIfNoEntry: false }), undefined);
    const holder = new DatabaseSync(lock, { timeout: 0 });
    try {
      holder.exec('BEGIN EXCLUSIVE');
      account(path, { expiresAt: Date.now() - 1000 });
      const timed = second.respond(request);
      clock += 90_001;
      await assert.rejects(timed, { code: 'timeout' });
      assert.equal(refreshes, 1);
      const stopped = new AbortController(), cancelled = first.respond(request, { signal: stopped.signal });
      stopped.abort();
      holder.exec('ROLLBACK');
      await assert.rejects(cancelled, { code: 'cancelled' });
      assert.equal(refreshes, 2);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).refreshToken, 'REFRESH-NEW');
    } finally { holder.close(); }
  } finally { finish(); }
});
