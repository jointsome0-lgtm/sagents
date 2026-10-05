# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents sends one request to a model, through a ChatGPT plan or to a server that speaks the OpenAI
chat completions protocol, and runs a first prototype of the live mode. The agent loop and the story tools come next;
for the live world, [what comes next](#what-comes-next-for-the-live-world) is listed below. This page keeps what works
and what is planned apart.

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

`status` says whether this computer is signed in. For a signed-in account it also asks OpenAI for the plan's list of
models and says whether the name is in it. The list is not the set of names a request takes: a name that is not in it
may be served all the same.

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
| `wrong_model` | The plan's service said that another model answers than the one asked for. Nothing of that answer is passed on. Checked only for the ChatGPT plan, and only when the stream names a model: a stream that names none is taken as it is, and an `api:` server's answer is not checked. |
| `timeout`, `cancelled` | The call's own limit, or its caller, stopped it. |
| `storage_failed` | The account file or its lock could not be read or written. An account file that cannot be read or understood is left as it is; repair or remove it by hand in `~/.config/sagents/`. |

So far this code has talked to stand-ins for both services in its own checks and to nothing else. The first real
sign-in and the first real request have not happened yet.

### A live world

```sh
node src/cli.ts live examples/night-station.json [--model <id>] [--cast <character>=<id>]... [--world-model <id>] \
  [--minutes <n>] [--calls <n>] [--state <file>] [--environment <name>] [--json]
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
- A sleeper hears and sees nothing and interrupts nobody. Only a deed that the world says wakes it ends its sleep
  early. A call to it is delivered when it wakes. The others see it fall asleep and wake,
  and are told that it is asleep when they are told who is with them.
- Everyone has a sleep debt. It grows by a second for each second awake, on the way included, and falls by two for
  each second asleep, never below zero. At the story's start it is the time since the world's `dayStart`, `07:00`
  unless the world file or its environment says otherwise. A turn never says the count. It says how the body feels, in four steps:
  rested; awake a long while, from half of `tiredHours`; tired, with the warning that the character will fall asleep
  where it is, from `tiredHours`, 16 by default; hardly able to stay awake, in the last quarter of the way from there
  to `spentHours`. From the tired step on the others in the place are told so with who is with them. At `spentHours`,
  24 by default, the rules put the character to sleep at its turn, where it is, for 8 hours: no model is asked, the
  journal keeps it as a record of its own, and the others there see it fall asleep.
- A leaving and an arrival are seen by everyone awake in the place and end their waiting. A `do`, a falling asleep
  and a waking are seen too, and a witness learns of them at its own next turn.
- An answer that cannot be used counts as a wait of 30 seconds. The journal keeps the reason, one of seven: it was
  not a JSON object, named no action, lacked its text, called nobody who can be called, led to the place the
  character is already in or to no place of the list, or lasted no time the action allows. The character's next turn
  says which, and what to do instead.

The world answers a deed:

- A world file may give `facts` to the world, to a place and to a character: what is true there and is not seen at
  once, 300 words each at most. No resident is ever sent any of it.
- After every `do` the world is asked once what came of it, through the model of `--world-model`, which is
  `--model`'s unless given. It is sent the world's description and facts, the place with its things and facts, the names
  of the other places, who is there, awake or asleep, each with looks, pose, what it holds, what it carries out of sight and its facts, what
  came of the latest earlier deeds in that place (400 words of them), the clock, and the doer's name with the deed
  and its span. It is sent no sheet, note, memory or speech.
- It answers with `result`, one or two sentences of what the senses give, 65 words at most, or null when there is
  nothing to notice; with `wakes`, the sleepers of that place whom the deed wakes; and with `changes`, described
  below. Any other id is dropped.
- Nobody gets to another place by a deed, and the world is told so: whoever tries is still where it was, by the
  way out, and a pose never names another place. Only a `go` moves anyone. The world is told the weather so that it
  knows it, and to speak of it only when the deed meets it. Nothing checks that it kept to either.
- The doer and everyone awake in the place read what came of it at their own next turn; it interrupts nobody. A
  sleeper it wakes has its sleep end when the deed ends, and reads who woke it and by what deed.
- The answer is a record of its own, right after its deed: the journal takes nothing else there, so a run that
  stopped between the two asks the world first when it continues. An answer that cannot be used is asked for once
  more; after that nothing came of the deed, and the answer counts as unusable.
- What a model tells in a `do` does not by itself make anything true: the deed is what was tried, and what came of
  it is what the world answered from the facts.

Bodies and belongings:

- A world file may give a character `looks`, what anyone near sees and what never changes: the body and the face,
  and no clothes, which can be taken off (60 words at most); `pose`, how and where in its place it is (20);
  `holds`, what is in its hands or worn, clothes included (30); and `has`,
  what it carries out of sight (60). It may give a place `things`: what lies there and can be moved, taken or
  changed (120). `facts` are for what does not change. All are optional and in the world's language.
- `pose`, `holds`, `has` and `things` start from the world file and then belong to the world's state. They change
  only by `changes` in the world's answer to a deed: a list of `{ of, what, text }`, where `what` is `pose`, `holds`,
  `has` or `things`, `of` is the id of a person in the deed's place, awake or asleep, or for `things` the id of that
  place, and `text` is the whole new text, cut at the limit of its kind; an empty text means that nothing is left.
  An entry that names anyone or anything else is dropped. The record of the answer keeps the changes as they were
  read. A `go` drops the walker's pose. Nothing else touches any of them.
- The world is told that a thing never appears from nowhere and never vanishes: what one gives another receives,
  what is taken from a place is in someone's hands or pockets afterwards, and a thing goes with what is in it, so
  clothes taken off take what is in their pockets out of what the person carries. Nothing checks that it kept to this.
- A character's `looks` are part of its own system text. Every turn says its own pose, what it holds and what it
  carries out of sight, and for each person in its place their looks, pose and what they hold. It is never sent
  what another person carries out of sight, anything of a person in another place, or any `things` or `facts`:
  what lies in a place a character learns by a deed and the world's answer to it.

The weather:

- A place of a world file with `"open": true` lies under the open sky; any other is under a roof.
- A world file or its environment may give `weather`, in one of two forms. A schedule is `start`, the weather when the story starts,
  and `changes`, each with a `day`, counted as the clock counts days, and a time of day `at`. A seeded series is a
  `seed`, a list of `states`, two at least, and `minutes`, the least and the most minutes a state lasts: which
  state comes n-th and how long it lasts follow from the seed and n alone, and no state comes twice running. A
  state, and a change of a schedule, has `text`, what is seen and felt under the open sky, and `indoors`, what of it
  reaches someone under a roof, or null when nothing does; 40 words each at most.
- A change is a record of its own kind. The rules put it when the clock reaches its moment, before anyone acts at
  that moment, and no model is asked. The journal refuses one that is not due or is not the one the world file gives.
- Everyone awake in an open place perceives a change as a line, and it ends their waiting as an arrival does.
  Everyone awake under a roof perceives the `indoors` text in the same way when there is one. A sleeper or a
  traveller perceives nothing of it and is not told later.
- A turn says the weather as the character's place gives it: `text` in an open place, `indoors` under a roof, and
  nothing when that is null. The world's request always holds the weather and says whether the deed's place is
  under the open sky or under a roof.
- The weather changes no other rule yet: nobody is slowed, chilled or woken by it.

Environments, and the form of a law:

- Sleep debt and the weather are laws that the clock drives, each in a module of its own, `src/sleep.ts` and
  `src/weather.ts`, behind one form (`src/laws.ts`): its settings and their check; its part of the world's state;
  the record the rules put when the clock reaches its moment, which a journal holds there and nowhere else; the line
  it adds to a resident's turn; and the most characters it adds to a request. Three more parts of the form are used
  by one law each: the weather adds a line to the world's request, and sleep adds its mark to what others are told
  of a person and keeps its count when someone falls asleep or wakes.
- `environments/<name>.json` holds settings of the laws and nothing else: `dayStart`, `tiredHours` and `spentHours`
  for sleep, and `weather`. A world file names one with `"environment": "<name>"` and may give any of these
  settings itself, which then takes the place of the environment's. `--environment <name>` takes the place of the
  world file's choice. A world file that names none and gives none has the defaults and no weather.
- There are three: `mountain-winter`, which «Ночь на перевале» lives in, `sea-summer` and `village-summer`. Their
  texts are synthetic and in Russian, as the example worlds are.
- The core reads no file: the command line reads the environment and hands it over with the world file.

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
  that waited begin the new lines. A sleeper who has lived through nothing since its last rewrite but falling
  asleep and waking wakes without one, and no model is asked. A character also rewrites its memory at the start of a turn while the lines hold more than
  `shortWords` words, 2000 by default: the oldest lines are folded until about half of that is left.
- If the answer to a rewrite cannot be used, it is asked for once more. After that the old text stays, the lines are
  dropped all the same, and the journal and the totals say that a rewrite was lost.
- A word counts as at most ten characters for every limit, so a text without spaces cannot get around one. This is
  why a request has a largest size that depends on the world file and not on how long the world has run.

The journal and the state file:

- Everything that happens is a record in an append-only journal: an action as it was read from the answer, or the
  reason why the answer could not be used, the world's answer to a deed, an arrival, a waking or a falling asleep
  at the limit, a change of the weather, a memory rewrite. Each record is stored with the event the rules made of it. There is no other
  state: where everyone is and what each one remembers is rebuilt from the records, by the same code that
  plays the world. Any beginning of a journal is a whole world at that moment.
- Without `--state` the journal lives in memory and ends with the run. Then the run is the whole story: a turn says
  how much of it is left, and speech shortens towards the end.
- With `--state <file>` the journal is a SQLite file, written one record at a time, and `live` continues the world
  it finds there. `--minutes` then count from where the world stands, and the end of a run is a pause: nobody is
  told how much is left. When the file is opened, every record is replayed and must give the event stored with it;
  a journal that does not is refused. The file belongs to one world file and its environment together, by a hash
  of the content of both, and refuses another of either, so neither can be edited or exchanged while the world is
  under way. A second run on a file that is in use is
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
- Every deed is followed by the world's answer and by nothing else.
- A sleeper wakes only when its sleep ends or a deed's result wakes it.
- Nobody acts after being awake for the world's limit: at that turn it falls asleep instead.
- What a person has, holds and how it is placed, and the things of a place, change only by the world's answer to a
  deed done in that place; a pose is also dropped when its owner leaves.
- Nobody is sent what another person carries out of sight, or the looks, pose or holdings of a person in another
  place.
- The weather changes only when and as the world file gives, and whoever is asleep or on the way perceives none of
  it.

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
model. Each entry of the journal keeps `by`, the name of the model whose answer it came of, or null for an arrival,
a waking or a change of the weather; `--json` prints it with the event, and the state file keeps it. The rules never read it: the same
records give the same world whoever answered. The totals count requests, unusable answers and tokens for each model
name as well: `--json` has them as `models`, and the text output adds one line for each model when more than one
played.

`npm run bench` plays a synthetic town with a stand-in that answers at once and prints what a step costs and how
large the requests were; `node src/bench.ts 1000 100 50` is 1000 characters in 100 places with 50 calls each.

What it lacks:

- There is no author above the characters. Nothing happens in the world unless a character does it.
- The world answers a deed and does nothing of its own accord. What people have and hold and the things of a place
  are texts that the world's answer rewrites whole: nothing counts the items in them, so nothing checks that a thing
  given was received or that the answer agrees with the facts. The facts of the world file never change.
- A `go` takes along everything a person holds and has, whatever its size, and nobody sees what lies in a place
  without a deed.
- Tiredness is one number. It does not slow anyone or change what a character can do before the limit, and a
  character who is on the way when it reaches the limit falls asleep only at its turn after the arrival.
- A seeded series of weather knows no time of day and no season: its states must read true at any hour.
- The world answers only a `do`. What is claimed in a speech or a note is checked by nobody.
- A rewrite is the model's own summary, and nothing checks that it adds no facts. What a character forgets cannot be
  looked up again: the journal keeps it, the character has no way to it.
- The calls that wait for a sleeper or a traveller are kept until it wakes or arrives, however many they are. If
  they are more than the short-term memory holds, the oldest are folded before its next turn, one rewrite after
  another, so the request stays within its size.
- The journal does not branch yet. A story that forks from a checkpoint needs a copy of the journal up to there.
- The state file does not keep the totals of earlier runs, and Node prints a warning that its SQLite is experimental.
- Its own checks talk only to a scripted stand-in for the model.

#### What comes next for the live world

1. A crowd through the world: people of a place who have no turns of their own, for whom the world answers, while the
   journal keeps what a resident perceived of them; coordinates for places, with travel time from distance; and a
   seaside example world of four residents, houses, a sports pool, a beach and cafés.
2. Things as the engine's state: items with amounts, owners and places; food with calories and tags; money.
3. An energy balance: hunger from the day's shortfall, weight and fitness from the same count over weeks.
4. `examine` as an action the engine answers by a table, more detailed for a resident with a doctor's skill; skills
   in the world file; injury and illness; a person's own reactions to kinds of food.
5. Ordinary days that cost no model calls.
6. After that: training, learning a skill in the story, a farm, ecology.

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
