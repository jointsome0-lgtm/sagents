# Model connection reference

The server settings and the ChatGPT plan connection are here.
[One request](ask.md) gives the request fields; [the live commands](live.md) use the same connections.

## The model connection

There are two; `modelFor` in `src/model.ts` chooses by the model name. A failure comes back as a code, and the
caller decides. The connection to a server never sends twice; with `SAGENTS_API_AGAIN`
[a play](live.md#the-commands-and-a-run) may send once more after a connection fails before any response. The plan's
connection sends once more only when the connection rejects before a response, as [One request](ask.md) says.

### A server of your own

A model written as `api:<id>` goes to any server that speaks the OpenAI chat completions protocol
through `createCompatible` in `src/compatible.ts`: vLLM or llama.cpp on a card you rent, or OpenRouter. The settings come from the environment.

| Variable | Meaning |
| --- | --- |
| `SAGENTS_API_URL` | The versioned root, such as `http://127.0.0.1:8000/v1` or `https://openrouter.ai/api/v1`. Required. |
| `SAGENTS_API_KEY` | The key, when the server asks for one; nonempty keys must be printable ASCII with no spaces. |
| `SAGENTS_API_MAX_TOKENS` | A positive safe whole number, the output limit of one call, 2048 by default. |
| `SAGENTS_API_EXTRA` | One JSON object of further body fields, such as `{"reasoning":{"enabled":false}}`, which keeps a model's reasoning off on OpenRouter. |
| `SAGENTS_API_CACHE_FIELD` | The name of the body field that a request's `cache` name is sent under, such as `session_id` or `prompt_cache_key`. It is 1 to 40 lower-case letters, digits and `_`, starting with a letter. Not set, the name is not sent. |
| `SAGENTS_API_STREAM` | `1` asks for the answer as a stream, for a server that gives no other. Empty or not set gives one JSON body; any other nonempty value is refused. |
| `SAGENTS_API_AGAIN` | `1` lets [a play](live.md#the-commands-and-a-run) send a request once more when its connection fails before any response. The server may have received the first one all the same and may charge for both, so set it only where that is acceptable, such as a card of your own. It needs `SAGENTS_API_STREAM=1`: without a stream a server may finish its answer before any response arrives. Empty or not set, nothing is sent twice; any other nonempty value, or `1` without the stream, is refused. |

```sh
export SAGENTS_API_URL=https://openrouter.ai/api/v1 SAGENTS_API_EXTRA='{"reasoning":{"enabled":false}}'
read -rs SAGENTS_API_KEY && export SAGENTS_API_KEY    # typed or pasted, not shown and not in the shell's history
echo '{"model":"api:google/gemma-4-31b-it","messages":[{"role":"user","content":"Say hi"}]}' | node src/cli.ts ask
```

What sagents sends and to whom:

- One `POST` to `<SAGENTS_API_URL>/chat/completions`, the server the address names, and nothing to anyone else. A
  redirect is a failure and is not followed.
- The body holds the model id, the messages (the instructions first, as a `system` message), `max_tokens`, the schema
  as a strict `json_schema` `response_format`, and the fields of `SAGENTS_API_EXTRA`. sagents adds no text of its own.
  An extra field cannot replace `model`, `messages`, `max_tokens`, `max_completion_tokens`, `response_format`, `stream`,
  `stream_options` or `n`: a setting that names one is refused.
- With `SAGENTS_API_STREAM=1` the body also holds `"stream": true` and `"stream_options": {"include_usage": true}`,
  and the request asks for `text/event-stream`. The text is the `delta.content` of the chunks, and reasoning in a
  delta is never read. With nothing held, a `data:` line that is JSON is read at once and an empty one counts for
  nothing; any other is held and
  joined with line feeds to the next data lines of that event. The held event is read once, at its blank line,
  which may end in a carriage return; comments and other fields are skipped and end nothing. A held event that
  is not JSON at its blank line, or a stream that ends with an event held, is `invalid_stream`. Only `data: [DONE]`
  with nothing held ends an answer, at once; with something held it is one more data line of that event. A last
  line broken off before its line feed is not read at all: with nothing held the stream is `incomplete_stream`,
  like any stream that ends before `data: [DONE]`, or `invalid_stream` when it breaks off inside a character. One
  that holds an `error` event is a failure by that event's code,
  and no failure returns the text that came by then. The limits on the answer's size, the time limit and the
  `finish_reason` are read as without it.
- The `cache` name of a request goes out only when `SAGENTS_API_CACHE_FIELD` names the field for it, and then in the
  body under that field and nowhere else: servers call such a field by different names, and one that checks its
  fields refuses a name it does not know. The field cannot be one of those above or one of `SAGENTS_API_EXTRA`.
- The key goes in the `authorization` header. sagents does not store it.
- A router that serves one model from several endpoints may say in a top-level `provider` of its answer which one
  answered. When that is a string, `ask` gives it as `endpoint` and a `live` run counts the answers of each for the
  model: `, answered by Alpha 12, Beta/fp8 3` in the model's line of the totals, which is then printed also when
  one model played, and `endpoints` with `--json`. A name is kept when it is 40 characters at most of letters,
  digits, space, `.`, `/`, `-` and `_`; any other string, and any name after the sixteenth of a model in one run,
  is counted as `other`. A server that sends no such field changes nothing. The journal and the state file do not
  hold it, and an answer that failed is counted under no endpoint.
- [Naming one router endpoint can help its cache](measured.md#router-cache).
- The address is `https`, or plain `http` to this computer only (`localhost`, `127.0.0.1`, `::1`, or another address in `127.*.*.*`), with a key or
  without one: neither the key nor the text travels unencrypted. Credentials in the URL, a query or a fragment are refused too, before a request is
  made. Reach a rented card through an SSH tunnel to a local port or over `https`.
- sagents writes no log of requests or answers. What the server keeps is the server's own matter: a hosted service may
  store requests, so real stories go only to a model you run yourself.
- A failure is a code, with the HTTP status and the server's own error code and field name when they are plain
  identifiers. sagents never prints the server's error text, the key or the request.
- An answer cut by `max_tokens` is `output_limit`, without the text. An `@<effort>` after the id means nothing here
  and is refused; the server's own switch goes into `SAGENTS_API_EXTRA`.
- HTTP 402 is `budget_exceeded`: sagents stops and tries nothing else.

### ChatGPT plan

`createChatgpt` and `signIn` in `src/chatgpt.ts` hold this connection and its sign-in.

sagents uses OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) for
open-source and locally run tools. At the first sign-in it registers itself as a client of your account. Its requests
go to the public Responses API and count against your ChatGPT plan, so there is no API key. The earlier README reports eligibility for Plus and Pro accounts, and says that
[ChatGPT's settings](https://chatgpt.com/settings/usage) let you limit the share of the plan sagents may use or
disconnect it. Those service claims are unconfirmed by this checkout.

What sagents keeps and what it sends:

- The tokens are in `~/.config/sagents/chatgpt.json`, a file only your user can read. sagents does not keep the ID token
  or your email.
- A request holds the instructions, the messages and the schema you gave it. sagents adds no text of its own.
- A message the service marks as interim (`commentary`) is left out where the service gives the pieces of text
  with the place of their message in the answer; a piece without that place is kept as text of the answer.
  One marked as interim from its start is not passed on to `onText` when the piece has that place;
  without it the piece still reaches `onText`.
  Text counts toward the limit of 100,000 characters as it arrives: a draft that grows past it before the
  service marks it as interim ends the request as `output_limit`. This limit ends a runaway answer early.
- A request that has a `cache` name carries it three times: as `prompt_cache_key` in the body and as the headers
  `session-id` and `x-client-request-id`. [The cache check](measured.md#plan-cache) compared requests with and without these names. A request with no name has none of the three.
- Every request has `store: false`. sagents writes no log of requests or answers.
- A failure is a code, with the HTTP status and OpenAI's own error code and field name when there were any. sagents
  never prints OpenAI's error text, which can quote the request.
- When the plan's limit, or the share of it given to sagents, is used up, sagents stops with `budget_exceeded` and tries
  nothing else.
- Several sagents processes may run at once. They take turns to renew the tokens through a lock next to the account
  file, because the connection assumes OpenAI replaces the renewing token at every use. An exclusive SQLite transaction in
  `chatgpt.json.renew.sqlite`, made with the account file's permissions plus the owner's write bit and never removed,
  holds the lock through renewal and saving. A process that dies gives it up; a stopped process keeps it, and waiters
  time out after 90 seconds. The earlier README warns that version 0.1.0 and this version do not shut each other out, so do not use them on one
  account at the same moment; the old lock's behaviour is unconfirmed here.

