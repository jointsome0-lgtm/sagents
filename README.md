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
It is run from a checkout of this repository, as the lines below show: it is not on npm and has no installed command
or entry point of a package, and `"private": true` in `package.json` guards against publishing it there by mistake.

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

`ask` reads one request as JSON from stdin and prints one JSON line. `--timeout <seconds>` limits the call, the reading
of the request included, and is 180 by default. It does not cut short a renewal of the ChatGPT plan's access token,
which a call begins with when the token is about to expire: the renewal runs to its own end, at most 90 seconds of
waiting for another sagents process that is renewing and then 30 seconds for the sign-in service, so that a new pair
of tokens is never lost unsaved, and a call whose limit passed meanwhile ends with `timeout` right after it.

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
limit cut short comes back as `output_limit`, without the text written by then. This holds for what a call returns,
and `ask` and `live` take nothing else. A program that calls `src/chatgpt.ts` itself and gives it `onText` is handed
the text as the stream brings it, before the answer is known to be whole or to come from the model asked for, so a
call that ends in a failure, `wrong_model` included, may have handed over a part by then.

| `reason` | What happened |
| --- | --- |
| `unauthorized` | Not signed in, the session is over, or OpenAI refuses this account or registration. Run `login`. For `api:`, the server refused the key or asks for one (HTTP 401 or 403). |
| `budget_exceeded` | The plan's limit, or the share of it given to sagents, is used up. For `api:`, the balance behind the key is (HTTP 402). |
| `rate_limited`, `model_unavailable`, `provider_failed` | The service did not serve the request this time. `provider_failed` without `httpStatus` means it could not be reached. |
| `invalid_request`, `context_limit` | The request cannot be served as it is. `param` names the field when the service did, and for `api:` the setting or the field that sagents itself refused, before anything was sent. |
| `output_limit`, `incomplete_stream`, `invalid_stream`, `invalid_response`, `empty_response` | The answer did not arrive whole or cannot be read. |
| `wrong_model` | The plan's service said that another model answers than the one asked for. Nothing of that answer is returned. Checked only for the ChatGPT plan, and only when the stream names a model: a stream that names none is taken as it is, and an `api:` server's answer is not checked. |
| `timeout`, `cancelled` | The call's own limit, or its caller, stopped it. |
| `storage_failed` | The account file or its lock could not be read or written. An account file that cannot be read or understood is left as it is; repair or remove it by hand in `~/.config/sagents/`. |

In its own checks this code talks to stand-ins for both services and to nothing else. Beyond them it has been used
with one account of a ChatGPT plan and with one chat completions server, so what another account or server does
differently is not known.

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
what each one remembers after the night decides what happens; `examples/seaside-cafe.json` is a café with a
crowd and a waitress whom nobody plays, in a town whose places lie on a map. The three examples are written in
Russian. What the models are told is in English and asks for answers in the language of the world's description; no
world in another language has been run with a real model.

The rules of time and hearing:

- The clock counts whole seconds of the story, and from the second day on a time names its day. The character who
  is free first plays next.
- Speech lasts as long as its words take at the world's `wordsPerMinute`, 130 by default. A `say` or a `call` holds at
  most 65 words. A longer one is cut. So are a note and the text of a `do`.
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
  next moment the story's clock shows it. A `do` or a `wait` is an hour at most, a `sleep` 12 hours. A known limit:
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
- An answer that cannot be used counts as a wait of 30 seconds. The journal keeps the reason, one of eight: it was
  not a JSON object, named no action, lacked its text, called nobody who can be called, led to the place the
  character is already in or to no place of the list, lasted no time the action allows, or was cut short at the
  model's limit of one answer. The character's next turn
  says which, and what to do instead.

The world answers a deed:

- A world file may give `facts` to the world, to a place, to a character and to a thing: what is true there and is
  not seen at once, 300 words each at most. No resident is ever sent any of it.
- The `facts` of a thing are what is true of the thing itself: what is written in a notebook, what a bag does not
  hold. Any thing may have them, wherever it stands: in a place, inside another thing, on a character. They go with
  the thing. The world is told the facts of every thing that its request lists, for a deed and for a figure's answer
  alike: lying in the place, in the hands or the pockets of someone there, inside another thing, or hidden. They
  stand in lines of their own after the lists, under `Facts of things:`, each under the label of its thing, like
  `- t23: …`, so that a long text does not stand in the notation. A part taken off a counted thing or out of a
  stock has the facts of what it was taken from, and two counts become one record only when their facts are the
  same. In `examples/night-pass.json` what the guests' journal, the backpack, the map and the notebook say is with
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
  that the ordinary handling of a thing gives no entry. This wording has not been run on a real model. This is the first of three planned layers of sensation. The
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
  the result. The world's text with the facts of things, the places next door and this field has not been run on
  a real model: what was measured is the text before them.
- A hidden thing is found in two ways. The first is by time and not by the world's judgement. The rules keep, for
  each person and place, the seconds of that person's deeds there that the world called a search. A thing is found
  by the search with which they reach its `minutes`: ten minutes for the backpack in the shed of «Ночь на
  перевале», in one deed or in several. The rules know how long a deed lasts before the world is asked, so the
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
  state or was found, which is the line that those in the place are told, when there was any of that. So a deed
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
  a run that stops between the two, at its `--calls`, starts the count again when it continues.
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
  count the answers `refused` and the deeds and speeches left `void`.
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
  a deed gives it one, and wakes with none. The things a person carries go where the person goes.
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
- There are three: `mountain-winter`, which «Ночь на перевале» lives in, `sea-summer` and `village-summer`. Their
  texts are synthetic and in Russian, as the example worlds are.
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
  refused. A new or empty file becomes a state file; an SQLite database of anything else is refused, and sagents
  writes nothing to it.

The laws of the world. Whatever the model answers, these hold in every journal. `npm test` plays thirty characters
for thousands of steps with answers of every kind, checks each law from the journal alone, and a failure names the
law and the record. Each law is one sentence, and they are written in one place: `LAWS` in
`src/invariants.test.ts`.

The run ends after `--minutes` of the story, 30 by default, or after `--calls` requests, 60 by default; a memory
rewrite is a request too. It stops at the first failure of the model connection and tries nothing again, with one
exception: an answer that the model's own limit cut short (`output_limit`) is an answer that cannot be used. For a
turn it is a lost turn like any other, for the world's answer and a memory rewrite it is one of their two tries,
and it counts as a request, with no tokens known for it. Three such answers of one model in a row, with no answer
of that model arriving whole in between, end the run as `failed (output_limit)`. It prints
each event as it happens. In the text output an event is one line, followed by a line for each thing it found, moved
or put into another state, for each pose it changed, for each private feeling, for what was heard next door and for a private note; a `wait` with
no note prints nothing,
and a memory rewrite is shown whole, over as many lines as it has, marked as private like a note. With `--json`
every event is one JSON object on one line, the silent waits too. Then comes one line of totals: the status and its
reason, the story minutes played, the requests, the unusable answers of every kind and how many of them were cut
at the output limit (`overlong`), the memory rewrites and how
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
