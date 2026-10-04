# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents signs in with ChatGPT, sends one request to a model and runs a first prototype of the live
mode. The agent loop and the story tools come next. This page keeps the two apart.

## Two modes

Eval is not written yet. Live has a first prototype with a small world of its own in place of a story engine; it is
described under [What works today](#a-live-world). Both will run on the same model connection and the same loop, with
a cap on steps. They differ in what the agent sees and which tools it gets.

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
| `model` | A model id, or `<id>@<effort>` with `minimal`, `low`, `medium`, `high` or `xhigh`. |
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
| `unauthorized` | Not signed in, the session is over, or OpenAI refuses this account or registration. Run `login`. |
| `budget_exceeded` | The plan's limit, or the share of it given to sagents, is used up. |
| `rate_limited`, `model_unavailable`, `provider_failed` | OpenAI did not serve the request this time. |
| `invalid_request`, `context_limit` | The request cannot be served as it is. `param` names the field when OpenAI did. |
| `output_limit`, `incomplete_stream`, `invalid_stream`, `empty_response` | The answer did not arrive whole. |
| `timeout`, `cancelled` | The call's own limit, or its caller, stopped it. |
| `storage_failed` | The account file or its lock could not be read or written. An account file that cannot be read or understood is left as it is; repair or remove it by hand in `~/.config/sagents/`. |

So far this code has talked to a stand-in for OpenAI's services in its own checks and to nothing else. The first real
sign-in has not happened yet.

### A live world

```sh
node src/cli.ts live examples/night-station.json [--model <id>] [--minutes <n>] [--calls <n>] [--json]
```

`live` reads a world file: a description everyone in the world knows, a starting clock, named places and characters,
each with a place and a sheet. Every character is played by the model, `gpt-6.1-sol@low` unless `--model` says
otherwise. One turn is one request and one action: `say`, `call`, `go`, `do` or `wait`, with an optional private note.

The rules of time and hearing:

- The clock counts whole seconds of the story. The character who is free first plays next.
- Speech lasts as long as its words take at the world's `wordsPerMinute`, 130 by default. A `say` or a `call` holds at
  most 65 words, and fewer when the end of the run is near. A longer one is cut.
- Everyone in the speaker's place hears a `say` and is held until it ends, so people in one place take turns.
- A `call` goes through the world's `remote`, a telephone for example. The one called hears it wherever they are, and
  those next to the caller hear the caller's half. A world without `remote` has no calls.
- A `go` takes the minutes between the two places. On the way a character hears nothing and does not act. A call to
  it is delivered when it arrives.
- A `do`, a leaving and an arrival are seen by everyone in the place and end their waiting.
- A character is sent its own sheet, the world's description and what it heard and saw, with clock times. It is never
  sent another character's sheet or note, or an event it did not perceive.
- An answer that cannot be used counts as a wait of 30 seconds.

The run ends after `--minutes` of the story, 30 by default, or after `--calls` requests, 60 by default. It stops at
the first failure of the model connection and tries nothing again. It prints one line per event, or one JSON object
per event with `--json`, and then one line of totals: the status and its reason, the story minutes played, the
requests, the unusable answers and the tokens.

What it lacks:

- There is no author above the characters. Nothing happens in the world unless a character does it.
- Nobody judges what a `do` achieves. It is seen and takes time, and it changes nothing else.
- There is no memory beyond one run, and inside a run a character's whole history is sent at every turn.
- It has run only against a scripted stand-in for the model. No real model has played a world yet.

## The model connection

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

## Development

```sh
npm test                        # no install and no network
npm install && npm run check    # the type check
```

## License

MIT
