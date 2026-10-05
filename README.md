# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents sends one request to a model, through a ChatGPT plan or to a server that speaks the OpenAI
chat completions protocol. The agent loop and the story tools
come next. This page keeps the two apart.

## Two modes

Neither is written yet. Both will run on the same model connection and the same loop, with a cap on steps. They differ
in what the agent sees and which tools it gets.

**live.** The agent lives in the story's world as one of its characters. It sees what that character sees, which is the
scenes as they arrive and its own notes. It acts by making a move. It cannot go back in time or read the story's
memory.

**eval**, or seval, short for story eval. The agent looks at a story from outside and sees all of it. It travels through
the story's checkpoints the way git travels through commits.

| Tool | What it does |
| --- | --- |
| `log` | Lists the checkpoints of a branch, newest first. |
| `show` | Shows one checkpoint: the scene, the move that led to it and the memory at that point. |
| `diff` | Shows what the memory gained and lost between two checkpoints. |
| `checkout` | Starts a branch from a checkpoint, to try something there. |
| `act` | Makes a move on that branch. The story under evaluation stays as it was. |
| `report` | Ends the run with findings, each with checkpoint ids and quotes. |

Code checks every quote of a report against the story and drops a finding whose quote is not there.

The two fit together. One agent plays a story and another checks it, so a measurement does not need its moves written
in advance.

The first story engine behind these tools will be the agent interface of
[simple-story-chat](https://github.com/jointsome0-lgtm/simple-story-chat), a Telegram bot for branching interactive
stories. It can create a seed, start a story, make a move, fork from a checkpoint, and read scenes, checkpoints and
memory.

## What works today

sagents needs Node 24.9 or newer and nothing else. It has no dependencies, and Node runs its TypeScript as it is.

```sh
node src/cli.ts login
node src/cli.ts status
echo '{"model":"gpt-6.1-sol@low","messages":[{"role":"user","content":"Say hi"}]}' | node src/cli.ts ask
```

`login` prints an address. Open it in a browser on the same computer, sign in with ChatGPT and approve. sagents listens
on `127.0.0.1` for the browser's way back, checks the answer and saves the tokens. `login --new` registers sagents
again, for another account or when signing in with the saved registration no longer works.

`status` says whether this computer is signed in. For a signed-in account it also asks OpenAI which models the plan
offers.

`ask` reads one request as JSON from stdin and prints one JSON line. `--timeout <seconds>` limits the whole call and is
180 by default.

| Field | Meaning |
| --- | --- |
| `model` | A model id of the ChatGPT plan, or `<id>@<effort>` with `minimal`, `low`, `medium`, `high` or `xhigh`. `api:<id>` is a model of [your own server](#a-server-of-your-own). |
| `messages` | `user` and `assistant` messages with text `content`. |
| `system` | Optional instructions. |
| `schema` | Optional JSON Schema, in OpenAI's strict form, that the answer must follow. |

```json
{"status":"done","text":"Hi.","usage":{"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"reasoningTokens":0}}
{"status":"failed","reason":"invalid_request","httpStatus":400,"providerCode":"subscription_sharing_unsupported_capability","param":"reasoning.effort"}
```

The numbers and the failure above only show the shape. An answer is whole or it is a failure: one that the model's own
limit cut short comes back as `output_limit`, without the text written by then.

| `reason` | What happened |
| --- | --- |
| `unauthorized` | Not signed in, the session is over, or OpenAI refuses this account or registration. Run `login`. For `api:`, the server refused the key or asks for one (HTTP 401 or 403). |
| `budget_exceeded` | The plan's limit, or the share of it given to sagents, is used up. For `api:`, the balance behind the key is (HTTP 402). |
| `rate_limited`, `model_unavailable`, `provider_failed` | The service did not serve the request this time. `provider_failed` without `httpStatus` means it could not be reached. |
| `invalid_request`, `context_limit` | The request cannot be served as it is. `param` names the field when the service did, and for `api:` the setting or the field that sagents itself refused, before anything was sent. |
| `output_limit`, `incomplete_stream`, `invalid_stream`, `invalid_response`, `empty_response` | The answer did not arrive whole or cannot be read. |
| `timeout`, `cancelled` | The call's own limit, or its caller, stopped it. |
| `storage_failed` | The account file or its lock could not be read or written. An account file that cannot be read or understood is left as it is; repair or remove it by hand in `~/.config/sagents/`. |

So far this code has talked to stand-ins for both services in its own checks and to nothing else. The first real
sign-in and the first real request have not happened yet.

## The model connection

There are two, and the name of the model chooses between them (`src/model.ts`). Neither tries a request a second
time: a failure comes back as a code, and the caller decides.

### ChatGPT plan

sagents uses OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) for
open-source and locally run tools. At the first sign-in it registers itself as a client of your account. Its requests
go to the public Responses API and count against your ChatGPT plan, so there is no API key. OpenAI offers this to
eligible Plus and Pro accounts. In [ChatGPT's settings](https://chatgpt.com/settings/usage) you can limit the share of
the plan that sagents may use, or disconnect it.

What sagents keeps and what it sends:

- The tokens are in `~/.config/sagents/chatgpt.json`, a file only your user can read. sagents does not keep the ID token
  or your email.
- A request holds the instructions, the messages and the schema you gave it. sagents adds no text of its own.
- Every request has `store: false`. sagents writes no log of requests or answers.
- A failure is a code, with the HTTP status and OpenAI's own error code and field name when there were any. sagents
  never prints OpenAI's error text, which can quote the request.
- When the plan's limit, or the share of it given to sagents, is used up, sagents stops with `budget_exceeded` and tries
  nothing else.
- Several sagents processes may run at once. They take turns to renew the tokens through a lock next to the account
  file, because OpenAI replaces the renewing token at every use.

### A server of your own

A model written as `api:<id>` goes to any server that speaks the OpenAI chat completions protocol
(`src/compatible.ts`): vLLM or llama.cpp on a card you rent, or OpenRouter. The settings come from the environment.

| Variable | Meaning |
| --- | --- |
| `SAGENTS_API_URL` | The versioned root, such as `http://127.0.0.1:8000/v1` or `https://openrouter.ai/api/v1`. Required. |
| `SAGENTS_API_KEY` | The key, when the server asks for one. |
| `SAGENTS_API_MAX_TOKENS` | The output limit of one call, 2048 by default. |
| `SAGENTS_API_EXTRA` | One JSON object of further body fields, such as `{"reasoning":{"enabled":false}}`, which keeps a model's reasoning off on OpenRouter. |

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
  An extra field cannot replace `model`, `messages`, `max_tokens`, `max_completion_tokens`, `response_format`, `stream`
  or `n`: a setting that names one is refused.
- The key goes in the `authorization` header. sagents does not store it.
- The address is `https`, or plain `http` to this computer only (`localhost`, `127.0.0.1`, `::1`), with a key or
  without one: neither the key nor the text travels unencrypted. Any other address is refused before a request is
  made. Reach a rented card through an SSH tunnel to a local port or over `https`.
- sagents writes no log of requests or answers. What the server keeps is the server's own matter: a hosted service may
  store requests, so real stories go only to a model you run yourself.
- A failure is a code, with the HTTP status and the server's own error code and field name when they are plain
  identifiers. sagents never prints the server's error text, the key or the request.
- An answer cut by `max_tokens` is `output_limit`, without the text. An `@<effort>` after the id means nothing here
  and is refused; the server's own switch goes into `SAGENTS_API_EXTRA`.
- HTTP 402 is `budget_exceeded`: sagents stops and tries nothing else.

## Development

```sh
npm test                        # no install and no network
npm install && npm run check    # the type check
```

## License

MIT
