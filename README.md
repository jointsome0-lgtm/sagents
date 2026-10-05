# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents sends one request to a model, through a ChatGPT plan or to a server that speaks the OpenAI
chat completions protocol, and runs a first prototype of the live mode. The agent loop and the story tools come next.
This page keeps the two apart.

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

### A live world

```sh
node src/cli.ts live examples/night-station.json [--model <id>] [--cast <character>=<id>]... \
  [--minutes <n>] [--calls <n>] [--state <file>] [--json]
```

`live` reads a world file: a description everyone in the world knows, a starting clock, named places and characters,
each with a place and a sheet. Every character is played by the model, `gpt-6.1-sol@low` unless `--model` says
otherwise; `--model api:<id>` plays them on [a server of your own](#a-server-of-your-own). One turn is one request
and one action: `say`, `call`, `go`, `do`, `wait` or `sleep`, with an optional private note.
`examples/night-station.json` is one evening; `examples/night-pass.json` is an evening, a night and a morning, where
what each one remembers after the night decides what happens.

The rules of time and hearing:

- The clock counts whole seconds of the story, and from the second day on a time names its day. The character who
  is free first plays next.
- Speech lasts as long as its words take at the world's `wordsPerMinute`, 130 by default. A `say` or a `call` holds at
  most 65 words. A longer one is cut. So are a note and the text of a `do`.
- Everyone in the speaker's place hears a `say` and is held until it ends, so people in one place take turns.
- A `call` goes through the world's `remote`, a telephone for example. The one called hears it wherever they are, and
  those next to the caller hear the caller's half. A world without `remote` has no calls.
- A `go` leads to another place of the list and takes the minutes between the two. On the way a character hears
  nothing and does not act. A call to it is delivered when it arrives.
- A `do`, a `wait` and a `sleep` last the `seconds` the character chose, or `until` a time of day like `06:30`: the
  next moment the story's clock shows it. A `do` or a `wait` is an hour at most, a `sleep` 12 hours.
- A sleeper hears and sees nothing, interrupts
  nobody and is woken by nothing. A call to it is delivered when it wakes. The others see it fall asleep and wake,
  and are told that it is asleep when they are told who is with them.
- A leaving and an arrival are seen by everyone awake in the place and end their waiting. A `do`, a falling asleep
  and a waking are seen too, and a witness learns of them at its own next turn.
- An answer that cannot be used counts as a wait of 30 seconds. The journal keeps the reason, one of seven: it was
  not a JSON object, named no action, lacked its text, called nobody who can be called, led to the place the
  character is already in or to no place of the list, or lasted no time the action allows. The character's next turn
  says which, and what to do instead.

What a character knows:

- A request is built anew at every turn: the system text, which is the same for all characters up to the character's
  own name and sheet, and one message with what the character remembers, what happened since, and where it is now.
  No earlier request or answer is sent again. A character is never sent another character's sheet, note or memory,
  or an event it did not perceive.
- The short-term memory is the lines since the last rewrite, with clock times: what the character heard and saw, its
  own actions and notes, and the calls that waited for it.
- The long-term memory is one text of at most `longWords` words, 400 unless the world file says otherwise. The
  character writes it itself, through the model, from the old text and the lines being folded into it. What it
  leaves out is forgotten. A longer answer is cut at the limit. It is asked to write in the past tense, without
  where it is at that moment, and to give a deed a result only where the lines show one.
- A character rewrites its memory when it wakes: everything before the sleep is folded, and the waking and the calls
  that waited begin the new lines. It also rewrites it at the start of a turn while the lines hold more than
  `shortWords` words, 2000 by default: the oldest lines are folded until about half of that is left.
- If the answer to a rewrite cannot be used, it is asked for once more. After that the old text stays, the lines are
  dropped all the same, and the journal and the totals say that a rewrite was lost.
- A word counts as at most ten characters for every limit, so a text without spaces cannot get around one. This is
  why a request has a largest size that depends on the world file and not on how long the world has run.

The journal and the state file:

- Everything that happens is a record in an append-only journal: an action as it was read from the answer, or the
  reason why the answer could not be used, an
  arrival or a waking, a memory rewrite. Each record is stored with the event the rules made of it. There is no
  other state: where everyone is and what each one remembers is rebuilt from the records, by the same code that
  plays the world. Any beginning of a journal is a whole world at that moment.
- Without `--state` the journal lives in memory and ends with the run. Then the run is the whole story: a turn says
  how much of it is left, and speech shortens towards the end.
- With `--state <file>` the journal is a SQLite file, written one record at a time, and `live` continues the world
  it finds there. `--minutes` then count from where the world stands, and the end of a run is a pause: nobody is
  told how much is left. When the file is opened, every record is replayed and must give the event stored with it;
  a journal that does not is refused. The file belongs to one world file, by a hash of its content, and refuses
  another, so a world file cannot be edited while its world is under way. A second run on a file that is in use is
  refused.

The laws of the world. Whatever the model answers, these hold in every journal. `npm test` plays thirty characters
for thousands of steps with answers of every kind, checks each law from the journal alone, and a failure names the
law and the record:

- Time never goes back.
- Nobody perceives what happened in another place, except the one a call was made to.
- A traveller or a sleeper perceives nothing and takes no action.
- Nobody acts before a speech they are hearing or making has ended.
- A speech never holds more words than its turn allowed.
- A traveller arrives in the place it set out for.
- A long-term memory never exceeds its limit in words.
- The record up to which a character's lines were folded never moves back.
- No request to the model exceeds the size fixed by the world file.
- Replaying the records gives every stored event again, and a journal that was changed is refused.
- A run stopped and continued from its file gives the same journal as one that never stopped.

The run ends after `--minutes` of the story, 30 by default, or after `--calls` requests, 60 by default; a memory
rewrite is a request too. It stops at the first failure of the model connection and tries nothing again. It prints
one line per event, or one JSON object per event with `--json`, and then one line of totals: the status and its
reason, the story minutes played, the requests, the unusable answers of every kind, the memory rewrites and how
many of them were lost, and the tokens. In the text output a memory rewrite is shown whole, marked as private like a
note.

A model for each resident. `--cast <character id>=<model name>`, given as many times as needed, has that character
played by a model of its own; `--model` plays everyone else. A model name is what `--model` takes. Every request
of a character, a turn or a memory rewrite, goes to its model's connection, so everything a resident perceives is
sent to the service that plays it. When a connection fails the run ends with its code: nobody is moved to another
model. Each entry of the journal keeps `by`, the name of the model whose answer it came of, or null for an arrival
or a waking; `--json` prints it with the event, and the state file keeps it. The rules never read it: the same
records give the same world whoever answered. The totals count requests, unusable answers and tokens for each model
name as well: `--json` has them as `models`, and the text output adds one line for each model when more than one
played.

`npm run bench` plays a synthetic town with a stand-in that answers at once and prints what a step costs and how
large the requests were; `node src/bench.ts 1000 100 50` is 1000 characters in 100 places with 50 calls each.

What it lacks:

- There is no author above the characters. Nothing happens in the world unless a character does it.
- Nobody judges what a `do` achieves. It is seen and takes time, and it changes nothing else.
- Nobody can wake a sleeper, and a sleeper cannot be made to hear anything. A character chooses how long it sleeps
  before it falls asleep.
- A rewrite is the model's own summary, and nothing checks that it adds no facts. What a character forgets cannot be
  looked up again: the journal keeps it, the character has no way to it.
- The calls that wait for a sleeper or a traveller are kept until it wakes or arrives, however many they are. If
  they are more than the short-term memory holds, the oldest are folded before its next turn, one rewrite after
  another, so the request stays within its size.
- The journal does not branch yet. A story that forks from a checkpoint needs a copy of the journal up to there.
- The state file does not keep the totals of earlier runs, and Node prints a warning that its SQLite is experimental.
- It has run only against a scripted stand-in for the model. No real model has played a world yet.

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
