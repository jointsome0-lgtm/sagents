# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents sends one request to a model, to a server that speaks the OpenAI chat completions protocol
or through a ChatGPT plan, and runs a first prototype of the live mode. The agent loop and the story tools come next;
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
It is run from a checkout of this repository: it is not on npm, and `"private": true` in `package.json` guards against
publishing it there by mistake. `npm link`, run once in the checkout, makes `sagents` a command of this computer: a
link to `src/cli.ts`, so the command is always the checkout as it stands. Without it `node src/cli.ts` takes the same
arguments, and `sagents help` lists them.

With a server that speaks the OpenAI chat completions protocol, vLLM or llama.cpp on a card or OpenRouter, an example
world is played from a clone like this:

```sh
git clone https://github.com/jointsome0-lgtm/sagents.git && cd sagents
export SAGENTS_API_URL=http://127.0.0.1:8000/v1       # the versioned root of your server
read -rs SAGENTS_API_KEY && export SAGENTS_API_KEY    # when the server asks for a key: typed, not shown, not in the history
node src/cli.ts live examples/seaside-cafe.json --model api:google/gemma-4-31b-it --calls 12
```

After `api:` stands the id that your server knows the model by. `live` has that model play the two residents of
`examples/seaside-cafe.json`, a café by the sea with a waitress whom nobody plays, and stops after 12 requests. It
prints each event as it happens, one line with the story's clock, the place, who and what, with the resident's
private note under it, and then the totals:

```
12:50:00 [Café «Anchor»] Nina to Raya (a small smile and a wave of the hand): "Could I have a coffee, please?"
         private note of Nina: I'm early, but the wind is quite strong. I should get a drink before Oleg arrives so I'm settled.
12:50:00 [Café «Anchor»] Raya answers Nina: "Of course, dear. I'll bring it right over."
12:50:00 [Beach] Oleg leaves for Café «Anchor» (192 s)
         private note of Oleg: I should head to the cafe now so I'm not late for Nina. I'm really looking forward to that fish.
...
done (calls): 3.9 story minutes, 12 calls, 0 invalid, 0 of them cut at the output limit, 0 of them declined by the service, 0 memory rewrites, 0 lost, 0 answers of the world refused, 0 deeds left with nothing, 24134 input tokens, 3520 of them cached, 1281 output tokens
  api:google/gemma-4-31b-it: 12 calls, 0 invalid, 0 of them cut at the output limit, 0 of them declined by the service, 24134 input tokens, 3520 of them cached, 1281 output tokens, answered by CoreWeave 8, ModelRun 1, Venice 1, DeepInfra 2
  turns: 10 calls, 20383 input tokens, 3520 of them cached, 1173 output tokens
  memory rewrites: 0 calls, 0 input tokens, 0 of them cached, 0 output tokens
  answers of the world: 2 calls, 3751 input tokens, 0 of them cached, 108 output tokens
```

These are the first lines and the totals of a real run: the check of release 0.1.0 ran the last command as it stands
on OpenRouter with Gemma 4 31B, with nothing set but the address and the key, from a copy of the repository with
nothing installed. The clone and the line of the key were not run in that check, and a model writes something else
every time. The model's own line is there because that router names the endpoint that answered. The four endpoints
are its choice for a run that is told nothing: [A server of your own](#a-server-of-your-own) says how one is named
and what share of a request was then read from a cache.

- The server must hold an answer to a schema: every request of `live` carries one as a strict `json_schema`
  `response_format`. A server that refuses the field ends the run at its first request, and one that ignores it and
  answers in plain text fails nothing. Both were played against a stand-in for such a server on the same computer.
  When it answered HTTP 400, the totals began `failed (invalid_request 400 unsupported_parameter response_format)`,
  the server's own code and field name after the status. When it answered in plain text, no answer could be used and
  each counted as a wait of 30 seconds, which prints no line, so that check printed only its totals, `done (calls)` with
  as many `invalid` as `calls`. Today five unusable answers of one model in a row end it as `failed (invalid)`,
  unless the same answer reaches the cut or decline limit, whose reason wins, as described below.
- `--calls` is the most requests one run sends, 60 when it is not given, and every request counts, whatever it is
  for: a resident's turn, the world's answer to a deed, a memory rewrite. `--tokens <n>` also ends the run before
  another request when the reported input and output tokens reach that ceiling, with reason `tokens`. An answer
  with no usage adds nothing; the request that crosses the ceiling is the last, so it can go over by one request.
  Without `--tokens` there is no token ceiling. The run also ends after `--minutes` of the story, 30 by default.
- Without `--model` the residents are played through the ChatGPT plan, which needs the `login` below.
- The address is `https`, or plain `http` to this computer only; a card elsewhere is reached through an SSH tunnel to
  a local port or over `https`. This, the other settings and what is sent to whom are under
  [A server of your own](#a-server-of-your-own).

With a ChatGPT plan in place of a server, `login` signs this computer in once. `ask` sends one request by either
connection:

```sh
sagents login
sagents status
echo '{"model":"gpt-6.1-sol@low","messages":[{"role":"user","content":"Say hi"}]}' | sagents ask
```

`login` prints an address. Open it in a browser on the same computer, sign in with ChatGPT and approve. sagents listens
on `127.0.0.1` for the browser's way back, checks the answer and saves the tokens. `login --new` registers sagents
again, for another account or when signing in with the saved registration no longer works.

`status` says whether this computer is signed in. For a signed-in account it also asks OpenAI for the plan's list of
models and says whether the name is in it. The list is not the set of names a request takes: a name that is not in it
may be served all the same.

`ask` reads one request as JSON from stdin and prints one JSON line. `--timeout <seconds>` limits the call, the reading
of the request included, and is 180 by default. It does not cut short a renewal of the ChatGPT plan's access token,
which a call begins with when the token is about to expire: the renewal runs to its own end, at most 90 seconds of
waiting for another sagents process that is renewing and then 30 seconds for the sign-in service, so that a new pair
of tokens is never lost unsaved, and a call whose limit passed meanwhile ends with `timeout` right after it.

| Field | Meaning |
| --- | --- |
| `model` | `api:<id>`, a model of [your own server](#a-server-of-your-own); or a model id of the ChatGPT plan, alone or as `<id>@<effort>` with `minimal`, `low`, `medium`, `high` or `xhigh`. |
| `messages` | `user` and `assistant` messages with text `content`. |
| `system` | Optional instructions. |
| `schema` | Optional JSON Schema, in OpenAI's strict form, that the answer must follow. |
| `cache` | Optional name of your own for whoever the request is one of, 64 characters at most of letters, digits, `-` and `_`, so that a service that keeps the beginnings of requests it has read brings the requests under one name to the same place. It holds nothing of the text. See each connection for how it is sent; a request with none is sent with none. |

```json
{"status":"done","text":"Hi.","usage":{"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"reasoningTokens":0}}
{"status":"failed","reason":"invalid_request","httpStatus":400,"providerCode":"subscription_sharing_unsupported_capability","param":"reasoning.effort"}
```

The numbers and the failure above only show the shape. An answer is whole or it is a failure: one that the model's own
limit cut short comes back as `output_limit`, without the text written by then. This holds for what a call returns,
and `ask` and `live` take nothing else. A program that calls `src/chatgpt.ts` itself and gives it `onText` is handed
the text as the stream brings it, before the answer is known to be whole or to come from the model asked for, so a
call that ends in a failure, `wrong_model` included, may have handed over a part by then. The same holds for
`src/compatible.ts` with `SAGENTS_API_STREAM`; without it an `api:` server's text is handed over once, whole and checked.

| `reason` | What happened |
| --- | --- |
| `unauthorized` | Not signed in, the session is over, or OpenAI refuses this account or registration. Run `login`. For `api:`, the server refused the key or asks for one (HTTP 401 or 403). |
| `budget_exceeded` | The plan's limit, or the share of it given to sagents, is used up. For `api:`, the balance behind the key is (HTTP 402). |
| `rate_limited`, `model_unavailable`, `provider_failed` | The service did not serve the request this time. `provider_failed` without `httpStatus` means it could not be reached. |
| `invalid_request`, `context_limit` | The request cannot be served as it is. `param` names the field when the service did, and for `api:` the setting or the field that sagents itself refused, before anything was sent. |
| `output_limit`, `incomplete_stream`, `invalid_stream`, `invalid_response`, `empty_response` | The answer did not arrive whole or cannot be read. |
| `declined` | The service declined to write an answer. On the plan's stream that is an event of a refusal (`response.refusal.delta`, `response.refusal.done`), an answer left incomplete by the `content_filter`, or a part of type `refusal` in the closing event; from an `api:` server, a `finish_reason` of `content_filter` or a message with a `refusal`. Nothing of what the service wrote is kept. These shapes are taken from what the two APIs document: no refusal of a real service was seen, so a service that declines in another shape is reported under another code, `empty_response` or `incomplete_stream` most likely. |
| `wrong_model` | The plan's service said that another model answers than the one asked for. Nothing of that answer is returned. Checked only for the ChatGPT plan, and only when the stream names a model: a stream that names none is taken as it is, and an `api:` server's answer is not checked. |
| `unexpected_tools` | The answer held a call of a tool, and sagents offers none. Nothing of that answer is returned. |
| `timeout`, `cancelled` | The call's own limit, or its caller, stopped it. |
| `storage_failed` | The account file or its lock could not be read or written. An account file that cannot be read or understood is left as it is; repair or remove it by hand in `~/.config/sagents/`. |
| `internal_error` | sagents itself failed in a way that has no code of its own. |

In its own checks this code talks to stand-ins for both services and to nothing else. Beyond them it has been used
with one account of a ChatGPT plan and with two chat completions servers, a router (OpenRouter) and vLLM behind a
gateway on a rented card, so what another account or server does differently is not known.

### A live world

```sh
sagents live examples/night-station.json [--model <id>] [--cast <character>=<id>]... [--world-model <id>] \
  [--minutes <n>] [--calls <n>] [--tokens <n>] [--state <file> | --run <dir>] [--environment <name>] [--json]
```

`live` reads a world file: a description everyone in the world knows, a starting clock, named places and characters,
each with a place and a sheet. Every character is played by the model that `--model` names: `--model api:<id>` plays
them on [a server of your own](#a-server-of-your-own), and without `--model` it is `gpt-6.1-sol@low` of the ChatGPT
plan. One turn is one request
and one action: `say`, `call`, `go`, `do`, `wait` or `sleep`, with an optional private note. A `say` may come with a `gesture`, what the speaker's face, hands or body do meanwhile, which those in the place are told in the line of the speech and which never reaches the world; a `do` may come with `says`, words said aloud while doing it, which everyone in the place hears as a speech of that moment before the deed goes to the world as any deed does. Both were measured together with the note's place in a rain scene of two, 160 requests: Gemma 4 31B gave a gesture with 11 speeches of 11 and words with 10 deeds of 13, GPT-6 Luna at low effort a gesture with 18 speeches of 18 and words with none of 7 deeds. The note is the first field of an answer, so that it is written before the action is chosen: in that measurement it was the first field written in 28 answers of 28 on Gemma and in 32 of 32 on Luna, where the action had been first before; whether an action now follows from its note was not counted. The rules ask a note to be no plan but what is going on in the character at that moment: what it notices in those with it, what its body feels, what it wants and what holds it back, so that no sheet has to say what a note is for.
`examples/night-station.json` is one evening; `examples/night-pass.json` is an evening, a night and a morning, where
what each one remembers after the night decides what happens; `examples/seaside-cafe.json` is a café with a
crowd and a waitress whom nobody plays, in a town whose places lie on a map. The three examples are written in
English, translated from Russian. What the models are told is in English and asks for answers in the language of the
world's description; every other measurement reported here was made on the Russian texts. The translated examples
were played for release 0.1.0 on Gemma 4 31B through OpenRouter, 132 requests in all: each example for 36, with the
model's reasoning off and one endpoint of the router named as the only one that may answer, and the station and the
café for 12 more each by the command of the start above, with nothing set but the address and the key. Every request
was answered, every answer could be used, and nothing was written in Russian. `examples/night-station.json` lists no
things, so in its two runs the world answered all 7 deeds, 6 of them searches, with nothing found; the other two
examples list theirs. Earlier that day, on the engine before its last two changes, the café was played once on a
rented card, by a small Gemma (E2B) under vLLM behind a gateway, as a stream: 16 requests, of which 15 were answered
before a failure of the connection ended the run, and 9 of the 15 answers could not be used.

The rules of time and hearing:

- Every numeric setting must be finite, and each duration derived from the settings must be a whole number of
  seconds from 1 to 10^12; a world of 0.1.0 with a longer derived duration, over thirty thousand years, is refused
  on purpose. These checks cover settings and their derived durations, not seconds accumulated over a long story.
- The clock counts whole seconds of the story, and from the second day on a time names its day. The character who
  is free first plays next. Of those free at one instant, whoever arrives comes first and whoever wakes after them,
  so everyone who comes or wakes at an instant has done so before anyone takes a turn at it: two who walk to a place
  together are both there when either looks around. On GPT-6 Luna, in a scene where two leave together, 81 requests, both were in the place before anyone took a turn in 4 leavings of 4, against a turn between the two arrivals in 4 of 4 on the engine before; the rule changes no text that a model reads, so it was played on no second model. A state file
  written under the earlier order, where a turn could come between two arrivals of one instant, is of another
  version and is refused.
- Speech lasts as long as its words take at the world's `wordsPerMinute`, 130 by default. A `say` or a `call` holds at
  most 65 words. A longer one is cut. So are a note and the text of a `do`, a `gesture` at 12 words, and the `says` of a `do` at 20 and at the turn's limit. A deed lasts at least as long as its `says` take, and they hold those who hear them as a speech does.
- Everyone in the speaker's place hears a `say` and is held until it ends, so people in one place take turns.
- A place of a world file may list `nextDoor`, the ids of the places that share a door or a thin wall with it. Two
  places are next door to each other whichever of them lists the other; the place itself or an id that is no place
  of the list is refused. The list of places that every resident is sent says which places are next door to each.
  Speech does not pass a door. What of a deed is heard next door is the world's to say, as the point on `beyond`
  below describes.
- A `call` goes through the world's `remote`, a telephone for example. The one called hears it wherever they are, and
  those next to the caller hear the caller's half. A world without `remote` has no calls.
- A `go` leads to another place of the list and takes the minutes between the two: those a `minutesTo` of either
  place gives for the pair; else, when both places have `at`, `[x, y]` in metres, the straight line between them at
  the world's `walkMetresPerMinute`, 80 by default, as whole minutes above ten and tenths of a minute up to there;
  else the world's `travelMinutes`. A walk of some kilometres is one action, and the clock stands at its end when the walker arrives. On the way a character hears
  nothing and does not act. A call to it is delivered when it arrives.
- A `do`, a `wait` and a `sleep` last the `seconds` the character chose, or `until` a time of day like `06:30`: the
  next moment the story's clock shows it. A `do` or a `wait` is an hour at most, a `sleep` 12 hours: an answer that asks for
  more, in `seconds` or to a time of day further off, lasts that most in seconds and is no lost turn, the character reads the seconds it lasts and is not told of the cut, and the record's
  action is marked `capped`, which no request holds. A known limit:
  a `do` ends early as a `wait` does, when someone speaks, comes or leaves nearby, something is heard from next door
  or the weather changes, and its
  doer is free again then, yet the deed is credited whole at once: the world answers for all its seconds, and a
  search counts them all.
- A place of a world file may have `"clock": true`, and so may a character, for a watch or a phone. A resident knows
  the clock only with one at hand, its own or its place's: then a turn opens with `Now 21:04:10.` and the lines of
  its memory open with the clock. With none the turn says the part of the day, `Now evening, as far as you can tell:
  no clock is at hand.`, a line opens with `[evening]`, and nothing the rules send it holds a time of the clock. A
  time that someone says aloud is speech and stays. A line keeps the time as its owner could tell it when it
  happened, so what was seen by a clock is remembered by the clock.
- The parts of the day are, under the open sky: early morning from 05:00, morning from 07:00, late morning from
  10:00, around midday from 12:00, afternoon from 14:00, late afternoon from 16:00, early evening from 18:00, late
  evening from 20:00 and night from 23:00; under a roof and on the way: morning from 05:00, the middle of the day
  from 11:00, afternoon from 15:00, evening from 18:00 and night from 23:00. From the second day on the day is
  named, as the clock names it.
- With a clock at hand an action `until` a time of day ends at that time: the clock is the alarm. With none it ends
  early or late by a number of seconds that follows from who acts, when and until what time, so a replay gives it
  again: at most a tenth of the span and half an hour for a `sleep`, a twentieth of the span and three minutes for a
  `do` or a `wait`, and never outside the span the action allows. The resident's own line then says `until about
  06:00` in place of the seconds. The world is always told the clock.
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
- A turn's answer follows a schema made for the world: `action` is one of the actions, without `call` where there is
  no `remote`, and `place` is the id of one of the world's places or null. A server that holds an answer to its
  schema therefore cannot write a `go` to a place that is not there, which cost a resident played by a weak model
  14 turns of 28 in one run and 3 of 23 in another. From a server that does not hold to schemas such an answer is
  read and refused as before. The other fields are a text or null, or a whole number or null for `seconds`.
- An answer that cannot be used counts as a wait of 30 seconds. The journal keeps the reason, one of nine: it was
  not a JSON object, named no action, lacked its text, called nobody who can be called, led to the place the
  character is already in or to no place of the list, lasted no time the action allows, was cut short at the
  model's limit of one answer, or the service declined to write it (`declined`). The character's next turn
  says which, and what to do instead; after a declined turn it reads the sentence of an answer that was no JSON
  object, since no sentence for it was measured, and only the journal tells the two apart. Five answers of one
  model's name that could not be used, with none of its answers used in between, end the run as `failed (invalid)`,
  unless the same answer reaches the cut or decline limit, when `output_limit` or `declined` wins respectively.
  This counts turns, world answers and memory rewrites, including cut and declined answers. An answer that the
  rules of things refuse is neither used nor unusable: it is counted under `refused` and neither adds to that row
  nor ends it. The answer that ends the run is counted but is not put in the journal. `invalidRun` of `runLive()`
  sets this limit, with no command flag.
- A request that the service declined to answer is not sent again: the same words would be declined again. A turn
  goes as the wait above, nothing comes of a deed whose answer the world's model declined, and a memory rewrite is
  lost as after two answers that could not be used. Each counts as a request and as an unusable answer, with no
  tokens known for it. The third in a run, whoever was asked and for what, ends the run as `failed (declined)`.
  The row of unusable answers can end it before then as `failed (invalid)`; when one decline reaches both limits,
  `declined` wins. A service that keeps declining is not asked on. No refusal of a real service was seen: the shapes
  that are read as one are those of the table of reasons above.

The world answers a deed:

- A world file may give `facts` to the world, to a place, to a character and to a thing: what is true there and is
  not seen at once, 300 words each at most. No resident is ever sent any of it.
- The `facts` of a thing are what is true of the thing itself: what is written in a notebook, what a bag does not
  hold. Any thing may have them, wherever it stands: in a place, inside another thing, on a character. They go with
  the thing. The world is told the facts of every thing that its request lists, for a deed and for a figure's answer
  alike: lying in the place, in the hands or the pockets of someone there, inside another thing, or hidden. They
  stand in the first line of the request, the place's, after the place's own facts, as sentences with no label
  and no heading: `The place: Red room (red), under a roof. Red walls. Facts: FACT-RED. FACT-KEY.` A text stands
  once, at the first record that has it, however many parts of one stock or count are listed. So a thing's fact is
  written as a sentence that names its thing, since the world reads it among the facts of the place with nothing
  that says whose it is, and two like things need wording that tells them apart. A block of these facts under
  labels, after the lists, was tried first: next to the `In the lists:` tails of the earlier lines a weak model then
  moved things to where no deed had put them. This layout as the engine writes it was then measured on a set of
  62 deeds, 25 with things, 14 with facts of things, 8 with clothes and 15 after a line gone stale: Gemma 4 31B
  gave exactly the due entries in 54 answers of the 60 that arrived and GPT-6 Luna at low effort in 49 of 62. A part taken off a counted thing or out of a
  stock has the facts of what it was taken from, and two counts become one record only when their facts are the
  same. In `examples/night-pass.json` what the guest register, the backpack, the map and the notebook say is with
  those things, so it is still known when one of them is carried to another place.
- After every `do` the world is asked once what came of it, through the model of `--world-model`, which is
  `--model`'s unless given. It is sent the world's description and facts, the place with its facts and its things, what is hidden in it, the names
  of the other places, for each place next door who is there, by name and id and awake or asleep, or that nobody
  is, who is in the deed's place, awake or asleep, each with looks, pose, what it carries and its facts, the facts
  of the things listed, what
  came of the latest earlier deeds in that place, in the world's words and in what the rules moved (400 words of
  them), the clock, and the doer's name with the deed
  and its span. It is sent no sheet, note, memory or speech, and of those next door no looks, pose or things.
- It answers with `search`, whether the deed was a search of the place; `finds`, the labels of the hidden things
  the deed went straight to; `moves`, `sets` and `poses`, described under «Things» below; `wakes`, the sleepers of
  that place or of a place next door whom the deed wakes; `feels`, what the deed makes a body feel, and `beyond`,
  what of the deed is heard next door, described in the next two points; and
  `result`, one or two sentences of what anyone there could see, hear or smell, 65 words at most, or null when
  there is nothing to notice. The fields stand in this order, the entries before the words, so that the
  words are written after the entries and cannot lead them; both orders passed the check of 2026-10-05 on the weak
  local model. The schema is made for each
  request and lists the labels, ids and states that the answer may name, so a model held to its schema names
  nothing else where a list has entries. A list that is empty takes any string, since a strict schema may refuse an
  empty list, and the states of all the things there stand in one list, so the schema does not hold a state to its
  own thing. The rules do the rest: an id of `finds`, `poses` or `feels` that is not of the place, or of `wakes` that is of
  no sleeper of the place or of a place next door, is
  dropped, and an entry of `moves` or `sets` that cannot be taken refuses the answer, as «Things» says.
- `feels` is a list of `{ of, text }`: what the deed makes the body of a person there feel, such as weight, cold,
  pain or taste, and never a thought or a wish. A deed that does something to a body gives entries, for the one
  touched and for the one who touches; a deed that only looks, listens or speaks gives none, and one who only
  watches gets none. An entry is one line of 20 words at most for one person, the later of two, and only its owner
  is told it, as a line `You feel: …` after what came of the deed, also when nothing else came of it. Nobody else in
  the place is told it and no figure is. A sleeper gets none, the one whom that deed wakes included, and so does
  someone elsewhere; an entry with no words is dropped. It is not kept for the world: what a place keeps of its
  earlier deeds holds the `result`, what the rules moved and no feeling, so no later request to the world has it. The transcript of
  `live` shows it as a `private feeling of …` line, like a note. The text of the field passed the check of
  2026-10-05 on a strong model and on two weak ones. In two whole runs of that day with the weak local model as the
  world, 120 requests each, 9 deeds of 52 got a feeling and each was told to its doer alone: three where one was
  due, cold, smoke and the heat of a stove, and six for the ordinary handling of a thing, such as keys taken into
  the hand or boots pulled on. Nobody touched anybody in those runs, so entries for two bodies have been seen only
  in single requests. The sentence of the field is narrower since those runs: it says that an entry is read right
  after `You feel:`, so that it begins with what is felt and names nobody, that the touch is of another body, and
  that the ordinary handling of a thing gives no entry. This wording has stood in the world's requests of every measurement since, but what it changed by itself was not counted. This is the first of three planned layers of sensation. The
  other two are not built: what a body feels from its own state over time, such as an arm tired by an hour of
  carrying, and a body that changes and is kept as a record.
- `beyond` is a string or null: what of the deed is heard in the places next door, one sentence of 20 words at
  most, and null when nothing carries that far, which is most deeds. It says the sound and not who made it, unless
  it is a voice with its words. It is read as a pose is: cut at the limit, and one with no words is null. Everyone
  awake in a place next door, and not on the way, is told one line, `From <place name>, next door: <text>`, and it
  ends a wait as speech nearby does. The line has the name of the deed's place and that text, and never the doer's
  name, the deed, its result, a pose, a move or a feeling. A sleeper next door whom `wakes` names is woken as a
  sleeper of the place is, and wakes with the line `Something from <place name>, next door, woke you: <text>`, or
  with `… woke you.` when `beyond` is null: a weak world fills the old field sooner than the new one, so the
  waking is taken without the text. A sleeper next door whom `wakes` does not name is told nothing, and so is
  someone on the way. Nobody in the deed's own place is told the text, the doer included, and it is not kept for
  the world: what a place keeps of its earlier deeds has none of it. The world is told to answer null when it
  is told of no place next door, and a text for a deed in such a place is read as null all the same: the record
  holds none, nobody is told, nothing is printed, and the answer is neither refused nor asked for again. The transcript of `live` shows it as a `heard next door: …` line under
  the result. The world's text with the facts of things, the places next door and this field was measured as a
  whole on the set of 62 deeds named above; what is heard next door was not counted by itself.
- A hidden thing is found in two ways. The first is by time and not by the world's judgement. The rules keep, for
  each person and place, the seconds of that person's deeds there that the world called a search. A thing is found
  by the search with which they reach its `minutes`: ten minutes for the backpack in the shed of «A Night on the
  Pass», in one deed or in several. The rules know how long a deed lasts before the world is asked, so the
  request lists the hidden things of the place in two kinds, those this deed finds if it is a search and those no
  search finds yet, and the world counts nothing.
- The second way is a deed that goes straight to the very spot named for the hidden thing, however short: someone who
  knows that the backpack lies under the workbench behind the canisters reaches there and has it. That is a reading
  of the deed, so the world judges it: every hidden thing is sent under its label with its spot, and the answer's
  `finds` names the labels the deed went straight to. A label that was not sent is dropped.
  The world is told that a deed which names another spot, or the thing and not where it lies, is not one.
- The world is told that nobody sees a hidden thing and that no result speaks of one until it is found. What is
  found either way is hidden no longer, for anyone: it lies in the place in sight, with all that it holds. Only an
  answer that finds a hidden thing can move it or what it holds. The time one person searched does not count for
  another, and it is kept when the person leaves.
- Nobody gets to another place by a deed, and the world is told so: whoever tries is still where it was, by the
  way out, and a pose never names another place. Only a `go` moves anyone. The world is told the weather so that it
  knows it, and to speak of it only when the deed meets it. Nothing checks that it kept to either.
- The doer and everyone awake in the place read what came of it at their own next turn; it interrupts nobody. A
  sleeper it wakes has its sleep end when the deed ends, and one of the deed's own place reads who woke it and by
  what deed.
- A place keeps for the world what came of the deeds done in it, the latest 400 words of lines and the newest line
  whatever its size. A line is the clock, the doer, the deed and its span, then `Result:` with the world's words
  when there were any, then `In the lists:` with what the rules say went where, was eaten or burned, is in another
  state or was found, when there was any of that. It says what those in the place are told, in the world's own
  words for things: each thing under its label, every move, also one into a pocket of the same person, and where
  the thing went as the answer's `to` named it and as a request writes that holder (`t38 camera went to t1
  long table.`, `t15 key to the shed went to t33 hiking jacket.`), with no word of where it came from. Told with names
  alone, a key that went into a jacket reads as gone to the person, and a weak model then answered with the person
  where it had answered with the jacket. So a deed
  whose answer had entries and no words leaves a line too, and a deed that left neither leaves none. The line is
  written from the postings and not from the answer's words, and every later request to the world in that place
  has it, for a deed and for a figure's answer alike. In two whole runs of 2026-10-05, when a place kept only the
  deeds whose result had words, a weak model twice answered by an earlier line against the lists: money still on
  a counter after it had been pocketed, and keys gone from a box after they had been put back. Whether a weak
  model reads the lists better with the new lines has not been seen in a whole run.
- The answer is a record of its own, right after its deed: the journal takes nothing else there, so a run that
  stopped between the two asks the world first when it continues. An answer that cannot be used is asked for once
  more; after that nothing came of the deed, and the answer counts as unusable. An answer that the rules of things
  refuse is asked for once more too, as «Things» says. The count of two asks is a run's own and no record keeps it:
  a run that stops between the two, at its `--calls`, starts the count again when it continues. The explanation
  of a refused answer is not kept either, so the next ask after continuing has none of it.
- What a model tells in a `do` does not by itself make anything true: the deed is what was tried, and what came of
  it is what the world answered from the facts.

People of a place whom nobody plays:

- A place of a world file may have `crowd`, a text of who is around as anyone there sees them (60 words at most), and
  `figures`, a list of `{ id, name, looks, facts }`: those of them who have a name. A figure has no sheet, no memory
  and no turn, so it costs nothing until someone speaks to it. It stays in its place, never speaks first, wakes
  nobody and follows nobody, and a `call` does not reach it.
- An id names one thing: the ids of the places, the characters and the figures are all different, and none is
  `eaten` or `burned`, has the shape of a thing's label (`t7`) or is a name every object of JavaScript has, like
  `constructor`. A world file that gives such an id is refused.
- A turn lists the figures of the resident's place with their looks, under `People of this place, who answer when
  you say with \`to\`:`, and then the crowd as `Around you: …`. A figure's `facts` are for the world alone.
- A `say` may have `to`, the id of a figure of the speaker's place; any other `to` of a `say` is dropped. Everyone
  in the place hears the speech as any other. Then the world is asked once, through the model of `--world-model`,
  what the figure answers: it is sent what a deed's request holds of the place and of those in it, without what is
  hidden and without the places next door, with the crowd and every figure of the place with looks and facts, with what came of the latest earlier
  deeds there, and with what was said to the figures of that place before and answered (300 words of it).
- It answers with `reply`, the figure's words, 65 at most, or null when the figure says nothing, and with `moves`
  as a deed's answer has them, for a thing handed over while speaking: a figure carries nothing of its own, what it
  has at hand is among the things of its place, and nothing is eaten or burned by its answer. The answer begins when the speech ends and
  holds the speaker and everyone who heard the speech as speech does. A sleeper is not woken by it.
- The answer is a record of its own, right after its speech, and the journal takes nothing else there. An answer
  that cannot be used, or one cut at the model's limit, is asked for once more; after that the figure says nothing.
  So a speech to a figure costs one request more than a speech, and a null answer costs it too.
- The world's request about a deed also holds the crowd and the figures of the deed's place, and what was said to
  them before and answered, so that a deed is judged with what a figure promised.

Things:

- A world file may give a character `looks`, what anyone near sees and what never changes: the body and the face,
  and no clothes, which can be taken off (60 words at most), and `pose`, how and where in its place it is (20).
  `facts` are for what does not change. All are optional and in the world's language.
- Things are records that the rules keep and count (`src/things.ts`). A place has `things` and a character
  `carries`, each a list of `{ name, … }`, and a thing has one holder: a person, a place or another thing. `holds`,
  a list, makes it a thing that holds others, like a table, a coat with pockets or a bag; `open` says that what it
  holds is in plain sight. `n`, a whole number from 1 to 1,000,000,000, makes it a count of things that are alike,
  like money, cigarettes or logs; a count holds nothing, so four mugs are four records. `fixed` is a part of the
  place that never moves: a thing of the place itself or a thing inside a fixed one, and never something a character
  carries or that lies in a thing which can move. `stock` is a
  supply with no count, which taking does not use up. `food` is the calories of one and makes it something to eat
  or drink; `burns` says that it can burn up. `states` is the list of states it can be in and `state` the one it is
  in, the first when not given; `fire` is true for what can set things alight, or names the state in which it can.
  `money` marks a count that no deed uses up or makes. `hidden`, `{ spot, minutes }` on a thing of a place itself,
  says where it lies unfound and how long a search finds it. `facts` is what is true of the thing and is not seen
  at once, for the world alone, as «The world answers a deed» says. A name has eight words at most and none of `, ; [ ] ×`.
  The examples show all of these. A file that still has the texts `holds`, `has`, a text of `things` or a list
  `hidden` is refused.
- The rules give every record a label, `t1`, `t2` and on in the order of the file. A label is the world's own, is
  never used again, and no resident is sent one. The world is told of things in one notation,
  `t8 parka [t9 cigarettes ×17, burns; t10 lighter, fire]`: under `Things here` what stands or lies in the place,
  after `Carries` what a person has in hand or wears, and in square brackets what a thing holds.
- The world keeps no count and rewrites no list. Its answer says which things the deed moved: `moves` is a list of
  `{ what, n, to }`, the label, how many, and where they end up: the id of a person there, the id of the place, the
  label of a thing that holds others, `eaten` or `burned`. There is no «from»: the rules know where the thing was.
  `sets` is a list of `{ what, state }` and puts a thing into one of its states; `poses` is a list of `{ of, text }`.
- The rules take the moves in their order and the whole answer or none of it. A whole record keeps its label and
  all that it holds, so a coat goes with what is in its pockets. A part of a count leaves the rest under the old
  label and is a new record where it went. What is taken from a stock is a new record, and the stock is as it was.
  Counts of one name and kind at one holder become one record. A move to where the thing already is does nothing.
- An answer is refused whole for the first entry that names no thing of the place, a hidden thing that the answer
  does not find, a `fixed` thing, more than there is or more than 20 from a stock, a `to` that is none of the above,
  a thing put into itself or deeper than four, something eaten that is not `food` or burned that does not burn or
  with no fire there, money eaten or burned, more than 30 records on a person or 60 in a place, or a state the
  thing does not have. It is refused too when it lists moves and every one of them is to where its thing already
  is, so that nothing moved and its words would tell of a move that the lists never took. Next to a move that changes something, such an entry is passed over as before. More than 12 moves or 6 states make the answer unusable. A refused answer changes nothing
  and never reaches the journal: the world is asked once more with the same request and one sentence that names
  the entry and the cause in the words of its instructions. After the second nothing came of the deed. The totals
  count the answers `refused` and the deeds and speeches left `void`. A refused answer is neither used nor unusable
  and neither adds to the row of unusable answers nor ends it.
- A thing appears only out of a stock and leaves the world only by being eaten or burned, so for every name what
  there is, what was eaten or burned and what came from a stock add up to what the world file gave, and the sum
  of money never changes. The event of an answer holds `moved`, a posting for each thing with how many went from
  which holder to which, and an `eaten` posting says who ate what; `set`; and `found`. The laws of the random run
  count by these postings.
- The rules read no prose, and no words of a model change a count. Whoever perceives an answer reads after it one
  line that the rules wrote from the postings: what went from whom or from what to whom, what was eaten or burned,
  what is in another state now and what was found where. It names things and people, and no label.
- `pose` and the things start from the world file and then belong to the world's state. A `go` drops the walker's
  pose, and so does falling asleep, by a `sleep` or at the limit: a sleeper is shown as asleep and has no pose until
  a deed gives it one, and keeps that pose when it wakes. The things a person carries go where the person goes.
- A character's `looks` are part of its own system text. Every turn says its own pose and what it carries, three
  things deep with the counts, and for each person in its place their looks, pose and what they carry, without what
  is inside a thing unless the thing is `open`. It is never sent what is inside a thing that another carries,
  anything of a person in another place, anything hidden, or any `facts`; the things of a place it learns by a deed
  and the world's answer to it.
- A character may have `memory`, what it remembers when the story begins, within `longWords`: what it owes and is
  owed today, what it saw, where a thing lies. The sheet says who the person is; a sum or a debt in the sheet would
  stay true in every request whatever happened, while the memory ages by the rules of memory. A place's `about`
  names only what does not move.
- Not built yet: a shop and prices, things made of other things, residents who take, give and eat without the
  world, calories that count, and doors that stop a `go`. A clock is still a mark of a place or a person and not a
  thing that can be handed over.

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
- There are three: `mountain-winter`, which «A Night on the Pass» lives in, `sea-summer` and `village-summer`. Their
  texts are synthetic and in English, as the example worlds are.
- The core reads no file: the command line reads the environment and hands it over with the world file.

What a character knows:

- A request is built anew at every turn: the system text, which is the same for all characters up to the character's
  own name and sheet, and one message with what the character remembers, what happened since, and where it is now.
  No earlier request or answer is sent again. A character is never sent another character's sheet, note or memory,
  or an event it did not perceive.
- The short-term memory is the lines since the last rewrite, each under its time as the character could tell it: what the character heard and saw, its
  own actions and notes, and the calls that waited for it.
- The long-term memory is one text of at most `longWords` words, 400 unless the world file says otherwise. The
  character writes it itself, through the model, from the old text and the lines being folded into it. What it
  leaves out is forgotten. A longer answer is cut at the limit and its end is lost, so the character is asked to aim
  at about 85% of the limit. It is asked to begin with what it wants and what has changed in it, then to give what
  later turns hang on, with the figures, names and places as the lines give them (what is owed, what was promised
  and by when, sums, times, where a thing was put), then what it knows about people, and to leave out passing
  chores, small talk and the prices of trifles. It is asked for sentences and no numbered list, for every sum and
  time of day in figures, for the past tense without where it is at that moment, and to give a deed a result only
  where the lines show one. The order is there so that the cut takes what matters least.
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
  reason why the answer could not be used, the world's answer to a deed, a figure's answer to a speech, an arrival, a waking or a falling asleep
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
  refused. The file also holds a random name of its own, made when it begins: every request of a run carries a name
  made of it for its player, one for each resident and one for the world, as the request's `cache`, so a world that
  is continued keeps those names and a journal begun in another file has others. A run with no state file makes one
  for itself. No name is printed, and none is in the journal. A byte copy of a state file has the names of the original. A new or empty file becomes a state file; an SQLite database of anything else is refused, and sagents
  writes nothing to it.
- With `--run <dir>` the run is kept as an experiment that [the lab](#the-lab) reads: the directory holds the world
  file as it was given, `world.json`; the state file, `state.sqlite`, with everything the point above says of one;
  and for every start a stretch of its own, `part1`, `part2` and so on, as two files. `part<N>.events.jsonl` has the
  events of that start, one a line, as the rules made them. `usage-part<N>.jsonl` has a row for every request: when
  it was sent, what it was for (`turn`, `memory`, `world` or `reply`), whose it was, the model's name, the
  milliseconds it took, the input, cached, output and reasoning tokens that the service reported, and the code of a
  failure. No text of a request, an answer or a failure is in a row. A second start with the same directory goes on
  in the same world as the next stretch. Nothing that is there is overwritten or shortened: a file is made only where
  there is none, and lines are only added. A directory that keeps another world file is refused, and `--state` is not
  given together with `--run`. An event is in the state file before it is in the events file, so a run that is killed
  between the two has the event in its world and not in its stretch. A file `about.txt` that you put into the
  directory is shown by the lab as what the experiment was for.

The laws of the world. Whatever the model answers, these hold in every journal. `npm test` plays thirty characters
for thousands of steps with answers of every kind, checks each law from the journal alone, and a failure names the
law and the record. Each law is one sentence, and they are written in one place: `LAWS` in
`src/invariants.test.ts`.

The run ends after `--minutes` of the story, 30 by default, after `--calls` requests, 60 by default, or before a
request when the reported input and output tokens reach `--tokens`, if given; a memory rewrite is a request too.
Usage that was not reported adds nothing, and the request that crosses the token ceiling is the last.
It stops at the first failure of the model connection and tries nothing again, with two
exceptions. A request that the service declined to answer (`declined`) counts as a request and as an unusable answer,
as the rules of time and hearing above say, and the third in a run ends it as `failed (declined)` unless the row of
unusable answers ends it before then. And an answer that the model's own
limit cut short (`output_limit`) is an answer that cannot be used. For a
turn it is a lost turn like any other, for the world's answer and a memory rewrite it is one of their two tries,
and it counts as a request, with no tokens known for it. Three such answers of one model in a row, with no answer
of that model arriving whole in between, end the run as `failed (output_limit)`, unless the row of unusable answers
ends it before then. Five unusable answers of one model's name, with none of its answers used in between, end it
as `failed (invalid)`, including cut and declined answers. An answer that the rules of things refuse is neither
used nor unusable: it is counted under `refused` and neither adds to that row nor ends it. When one answer reaches
the invalid limit and the cut or decline limit together, `output_limit` or `declined` wins respectively. `cutRun`,
`declinedRun` and `invalidRun` of `runLive()` set these limits; they have no command flags. It prints
each event as it happens. In the text output an event is one line, followed by a line for each thing it found, moved
or put into another state, for each pose it changed, for each private feeling, for what was heard next door, for the words said with a deed and for a private note; a gesture stands in brackets before its speech; a `wait` with
no note prints nothing,
and a memory rewrite is shown whole, over as many lines as it has, marked as private like a note. With `--json`
every event is one JSON object on one line, the silent waits too. Then comes one line of totals: the status and its
reason, for a run that a connection's failure ended also the HTTP status and the service's own code and field name when the failure had them (`failed (provider_failed 502 bad_gateway)`; `httpStatus`, `providerCode` and `param` with `--json`; `provider_failed` with no status means the service could not be reached), never the service's words, the story minutes played, the requests, the unusable answers of every kind, how many of them were cut
at the output limit (`overlong`) and how many the service declined to write (`declined`), the memory rewrites and how
many of them were lost, the answers of the world that the rules of things refused and the deeds left with nothing, and the tokens: the input tokens, how many of them the service says it read from its cache (`cachedInputTokens`), and the output tokens. The tokens are summed over the answers that reported their usage: when some
reported none, the totals say how many (`unreported`) and do not count them as zero; an answer that reported no cached count adds none. The totals also count the requests and the tokens by what a request was for, a resident's turn, a memory rewrite or an answer of the world, which is the result of a deed or a figure's answer, a second ask included: `--json` has them as `kinds`, and the text output adds one line for each, so that the turns are told from the world's answers when one model gives both.

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
- The world answers a deed and does nothing of its own accord. The rules count the things and hold every move to
  what is there, but whether a deed moved a thing at all is the world's reading: a weak model leaves a move out, and
  then its words say that a jacket was hung up while the lists keep it on its owner. Nothing compares the words of
  a result with its moves. The facts of the world file never change.
- What a place keeps of its earlier deeds says what the rules moved and never where a thing is now: a thing that
  left the place on its carrier, or was moved by a figure's answer, leaves no line there, and an older line of
  the world's own words may still speak of it. The lists are the truth, and the world is told so.
- Speech does not pass a door: a `say` is heard in the speaker's place and nowhere else, however loud. Someone
  who calls through a door does it by a `do`, and the one inside reads only what the world put into `beyond`, and
  can answer the same way. Whether a deed is heard next door is the world's reading, and nothing checks it; every
  place next door hears the same, and the doer is not told that it was heard.
- A door has no state. It is not a thing that is open, shut or bolted: what a place's description says of its door
  is all the world knows, a `go` passes any door, and what is heard next door does not depend on one.
- A search is whatever the world calls one, and a deed went straight to a hidden thing when the world says so:
  nothing checks either, so a world that is generous finds a thing for someone who only guessed. Nobody is told how
  long a search has lasted or that there is anything left to find.
- A walk is a straight line at one pace for everyone, whatever lies between and however tired the walker is. A
  long walk cannot be broken off, nothing is perceived on it, and the walker is not told what the weather did meanwhile.
- A `go` takes along everything a person carries, whatever its size, and nobody is told what lies in a place
  without a deed. A resident names a thing in its own words, and the world has to find the label.
- A clock is a mark in the world file and not a thing: a watch that is handed over, lost or stopped still shows its
  first owner the time, and a clock carried out of a place stays in it. A span in seconds is said exactly to
  everyone, and a sleeper who is woken early is not told by how much.
- Tiredness is one number. It does not slow anyone or change what a character can do before the limit, and a
  character who is on the way when it reaches the limit falls asleep only at its turn after the arrival.
- A seeded series of weather knows no time of day and no season: its states must read true at any hour.
- A figure remembers nothing of its own: it is consistent only by its facts and by the latest of what was said to
  the figures of its place, which all of them share. It does not hear what residents say to each other. A crowd is a text and answers nobody.
- The world answers only a `do` and a speech to a figure. What is claimed in a speech or a note is checked by nobody.
- A rewrite is the model's own summary, and nothing checks that it adds no facts. What a character forgets cannot be
  looked up again: the journal keeps it, the character has no way to it.
- The calls that wait for a sleeper or a traveller are kept until it wakes or arrives, however many they are. If
  they are more than the short-term memory holds, the oldest are folded before its next turn, one rewrite after
  another, so the request stays within its size.
- The journal does not branch yet. A story that forks from a checkpoint needs a copy of the journal up to there.
- The state file does not keep the totals of earlier runs, and Node prints a warning that its SQLite is experimental.
- Its own checks talk only to a scripted stand-in for the model.

#### What comes next for the live world

1. What the things still lack: tags on food, a shop and prices, things made of other things, and residents who
   take, give and eat without the world.
2. A larger seaside world than `examples/seaside-cafe.json`: four residents, houses, a sports pool, a beach and cafés.
3. An energy balance: hunger from the day's shortfall, weight and fitness from the same count over weeks.
4. `examine` as an action the engine answers by a table, more detailed for a resident with a doctor's skill; skills
   in the world file; injury and illness; a person's own reactions to kinds of food.
5. Ordinary days that cost no model calls.
6. After that: training, learning a skill in the story, a farm, ecology.

### The lab

```sh
sagents lab [<dir>...] [--port <n>] [--lang <en|ru>] [--no-open]
export SAGENTS_LAB=~/runs:~/more-runs    # the folders `sagents lab` reads when it is given none
export SAGENTS_LAB_LANG=ru               # the page's language when `--lang` is not given
```

`lab` shows in a browser the experiments that lie under the directories it is given: under those that `SAGENTS_LAB`
names, separated as in `PATH`, when it is given none, and under the current directory when that is not set either.
It asks no model and writes nothing into those directories. It prints its address, which is on this computer only,
and opens it in the default browser unless `--no-open` is given; `--port` asks for a port, and without it the system
picks one. Ctrl+C stops it. A computer with no browser to open is no failure: the address is on the screen.

A directory is looked into six levels deep. Names that begin with a dot and `node_modules` are passed over, a link is
followed only where it stays inside the directory given, and a `*.sqlite` is never opened: only its name is looked at.
On a system without `/proc`, the lab trusts that nobody rewrites the given folders while it reads them.
What is found is listed newest first, in groups by the folder it lies in, and typing a part of a name narrows the
list. An experiment has one of three shapes:

- A world: a directory with `world.json`, as `live --run` keeps one. Every `<name>.events.jsonl` in it is a stretch
  of that one world, with `usage-<name>.jsonl` or `<name>.usage.jsonl` beside it, and it may have `about.txt` and the
  chapters of a story, `story/chapter-NN.json`. The lab shows the stretches joined, as one story.
- A run: in a directory with no `world.json`, every `<name>.events.jsonl` is an experiment of its own, with the usage
  file and the transcript `<name>.txt` of its name. Names of residents and places come from a `*.json` of the same
  directory that reads as a world file and has the characters of the run's events, `<name>.json` first; with none,
  the ids are shown.
- A text: a transcript `<name>.txt` with no events file, taken for one when a state file or a usage file of its
  name lies beside it; `<name>-1.txt` and `<name>-2.txt` beside `<name>.sqlite` are one experiment. Only its text is
  shown. Any other `.txt` is passed over.

A rehearsal, a run whose name begins with `dry-` or in which no request reported a token, is listed apart, folded.
The page has the feed of events with filters by resident and a search, the numbers of the requests, a comparison of
two experiments side by side, the story's chapters and the transcript; `?` lists its keys. A field or a kind of
event that the page does not know is shown as a plain line, so a journal of a newer engine still reads. The page is
in English or in Russian: in the language that `--lang` names, or `SAGENTS_LAB_LANG` when the flag is not given, and
with neither in Russian for a browser set to Russian and in English for any other. Any other value is refused. The
language goes to the page in the address that the command prints and opens, as `?lang=ru`. In its review the page was
opened in Chrome over synthetic runs, in English: the list with its groups, the folded rehearsals, the narrowing, the
feed, the transcript and the numbers. The Russian page was opened in the review of the command too, over synthetic
runs: the list, the feed and the numbers.

An experiment that has a world file also has a map (the key `P`). It draws every place of the file with its name: a
room as a box, a place under the open sky with a rounded dashed edge, the people of a place whom nobody plays named
under it, and a thick line between two places that are `nextDoor`. Places that are near each other form a group
that is drawn to a scale of its own, written under it, and groups stand apart with the time of the way written on
the link between them, which is not to scale: the places are joined into one tree by the shortest ways, and a way of
that tree that takes five minutes or more, and three times the middle one of the other ways of its part or more,
parts two groups. Inside a group a place with `at` stands where its metres put it and one with minutes alone where
its minutes do, as well as a plane allows; places that name one point, and boxes that would lie on each other, are
set beside each other, so a distance of a few steps is not to be measured on the drawing. Everyone is a mark of its
own colour in the place where it is at the moment that the control above the map names, a ring when asleep, and on
the way a mark on a dashed line between the two places with where it goes and when it is due. Each direction has
its own side of the line; beyond six travellers in one direction the rest share one mark with their count. When
only a continuation is available, someone with no event yet is listed as not yet known and has no mark, and so is
someone whose first event finds it elsewhere than where the world file starts it, until that event. The moment
is `t` of the address, as in the feed, `J` and `K` step to the next and the previous moment at which someone moved, fell
asleep or woke, and with the newest followed it is the newest. Pointing at a place shows its description, who is
there and the time to every other place; a click puts it into the feed's filter by place. Beside a second
experiment the map is of the left one alone and says so. The same world file gives the same drawing at every load.
The map was checked without a browser: its positions as tables and its drawings as SVG files made by the layout
code that the page uses, over the three example worlds and a synthetic one played by a stand-in for the model, and
the page's script was run through over a stand-in for the document.

What the lab may do with the files, and `lab/lab.test.ts` holds it to that:

- It listens on `127.0.0.1` alone and has no option for another address. Its address holds a token made at start,
  and every path without it, and every method but GET, is answered 404.
- The token is in no process's arguments. The browser is handed a file that only you can read, in a temporary
  directory that only you can open, which leads on to the address, as Jupyter does it; the file is removed when the
  lab stops.
- No name from a request builds a path: an experiment is looked up among those the walk found.
- Of a world file there leave the lab the ids and names of characters and places and what the map is drawn from: of
  the world `travelMinutes` and `walkMetresPerMinute`; of every place `at`, `minutesTo`, `nextDoor`, `open`, `about`
  and the ids and names of its `figures`; of every character the `place` it starts in. Nothing else of it: never a
  sheet, a memory, looks, facts or things of anyone or anything, never `crowd`, never the description or the facts
  of the world. Of a chapter everything but its `carry`; of a usage row the counted fields; of a failure its code.
- The list gives `mapKey`, the world file's modified time and size as one value, so that an edit refreshes the map.
- For the map the lab reads the events itself and gives the page where each one put someone (who, the place, where
  a way leads and how long it or a sleep takes), so a long world does not have to be loaded into the browser for it.
- The page loads its script and its style sheet from the lab and nothing from anywhere else.

The server and the reading of files are TypeScript as the rest (`lab/server.ts`, `lab/data.ts`, `lab/open.ts`). The
page is plain files that the browser loads as they are: `lab/page.html`, `lab/app.css`, `lab/app.js`,
`lab/strings.js` with the page's two languages, `lab/map.js`, which lays out and draws the map, and `lab/core.js`,
which the server's reading shares with the page.
`npm run check` reads `lab/core.js` for the types of what `lab/data.ts` imports from it and reports nothing in a
`.js` file: the page's scripts are not type-checked.

## The model connection

There are two, and the name of the model chooses between them (`src/model.ts`). Neither tries a request a second
time: a failure comes back as a code, and the caller decides.

### A server of your own

A model written as `api:<id>` goes to any server that speaks the OpenAI chat completions protocol
(`src/compatible.ts`): vLLM or llama.cpp on a card you rent, or OpenRouter. The settings come from the environment.

| Variable | Meaning |
| --- | --- |
| `SAGENTS_API_URL` | The versioned root, such as `http://127.0.0.1:8000/v1` or `https://openrouter.ai/api/v1`. Required. |
| `SAGENTS_API_KEY` | The key, when the server asks for one. |
| `SAGENTS_API_MAX_TOKENS` | The output limit of one call, 2048 by default. |
| `SAGENTS_API_EXTRA` | One JSON object of further body fields, such as `{"reasoning":{"enabled":false}}`, which keeps a model's reasoning off on OpenRouter. |
| `SAGENTS_API_CACHE_FIELD` | The name of the body field that a request's `cache` name is sent under, such as `session_id` or `prompt_cache_key`. Not set, the name is not sent. |
| `SAGENTS_API_STREAM` | `1` asks for the answer as a stream, for a server that gives no other. Not set, the answer is one JSON body. Any other value is refused. |

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
  delta is never read. With nothing held, a `data:` line that is JSON is read at once; otherwise it is held and
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
- A router that is told nothing may spread the requests of one run over its endpoints, and then little of a request
  is read from a cache. In the check of release 0.1.0, on OpenRouter with Gemma 4 31B, two runs of 12 requests with
  nothing set but the address and the key were answered by three and by four endpoints, and 7 and 15 percent of their
  input tokens were read from a cache. Three runs of 36 requests whose `SAGENTS_API_EXTRA` named a session and the one
  endpoint that may answer, `{"reasoning":{"enabled":false},"session_id":"<a name of the run>","provider":{"quantizations":["fp4"],"order":["<endpoint>"],"allow_fallbacks":false}}`,
  were each answered by that endpoint alone and read 71 to 75 percent, 64 to 71 in their first 12 requests. For the
  café, the one world played both ways, that is 71 percent of 24,247 input tokens against 15 percent of 24,134. These
  are OpenRouter's own fields, which of them made the difference was not taken apart, and nothing else was compared.
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
- A request that has a `cache` name carries it three times: as `prompt_cache_key` in the body and as the headers
  `session-id` and `x-client-request-id`. The plan's route reads far more of a request from its cache with them:
  8 or 9 requests of 20 against 1 to 3 without. A request with no name has none of the three.
- Every request has `store: false`. sagents writes no log of requests or answers.
- A failure is a code, with the HTTP status and OpenAI's own error code and field name when there were any. sagents
  never prints OpenAI's error text, which can quote the request.
- When the plan's limit, or the share of it given to sagents, is used up, sagents stops with `budget_exceeded` and tries
  nothing else.
- Several sagents processes may run at once. They take turns to renew the tokens through a lock next to the account
  file, because OpenAI replaces the renewing token at every use. An exclusive SQLite transaction in
  `chatgpt.json.renew.sqlite`, made with the account file's permissions plus the owner's write bit and never removed,
  holds the lock through renewal and saving. A process that dies gives it up; a stopped process keeps it, and waiters
  time out after 90 seconds. Version 0.1.0 and this version do not shut each other out, so do not use them on one
  account at the same moment.

## Development

```sh
npm test                        # no install and no network
npm install && npm run check    # the type check
npm run size                    # how large the core is, in tokens
```

`npm run size` counts tokens (`o200k_base`) of three things: the core of the live mode without model and disk
(`src/world.ts`, `time.ts`, `action.ts`, `answer.ts`, `things.ts`, `journal.ts`, `laws.ts`, `sleep.ts`, `weather.ts`, `memory.ts`, `reading.ts`), `src/live.ts`, and
all tracked text except `LICENSE` and `package-lock.json`. It reads the working tree, or the Git index with
`npm run size -- --index`. The core is meant to stay small enough to read whole, and its count falls into one of four bands,
around the owner's mark of 70,000 tokens, which is there to steer by: up to 56,000 tokens, four fifths of the mark,
the number is printed and nothing else; from there to 70,000 a
note says that the core is nearing its size; from there to 84,000, six fifths of the mark, a warning says that it is over, and that a change
which adds to the core says what it takes out or why the size should rise; above 84,000 a strong warning says that
the core no longer reads whole and should be split or cut before more is added. The script ends well in every band:
it forbids nothing. Tests are counted against nothing. The list of core files and the three bounds are at the top of `scripts/size.py`. The count needs the Python package `tiktoken`,
which is no dependency of this project: name a Python that has it in `SAGENTS_SIZE_PYTHON`. Without it the script
says how to get it, counts nothing and ends well. It
is not part of `npm test`. A change that grows the core says by how many tokens.

## License

MIT
