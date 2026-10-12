# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents sends one request to a model, to a server that speaks the OpenAI chat completions protocol
or through a ChatGPT plan, runs a first prototype of the live mode, and has a judge read a finished live journal.
For the live world, [what comes next](#what-comes-next-for-the-live-world) is listed below. This page keeps what works
and what is planned apart.

## Two modes

Eval reads the journal of a finished live world with `log`, `show`, `diff` and `report`. `checkout` and `act` are not
written: the journal cannot branch yet. Live has a first prototype with a small world of its own in place of a story
engine, described under [What works today](#a-live-world). Both use the same model connections and a cap on calls.
They differ in what the agent sees and which tools it gets.

**live.** The agent lives in the story's world as one of its characters. It sees what that character sees, which is the
scenes as they arrive and its own notes. It acts by making a move. It cannot go back in time or read the story's
memory.

**eval**, or seval, short for story eval. The agent looks at a story from outside and sees all of it. It travels through
the live journal's numbered records. Travel through branches and checkpoints is to come.

| Tool | What it does |
| --- | --- |
| `log` | Lists numbered records in journal order, with memory rewrites marked. |
| `show` | Shows records with their saved events, or a person, place or thing from the world file. |
| `diff` | Shows a person's memory before and after two records, or the whole run, and what each rewrite folded. |
| `checkout` | Not written. Will start a branch from a checkpoint, to try something there. |
| `act` | Not written. Will make a move on that branch, leaving the story under evaluation as it was. |
| `report` | Ends the run with findings, each with record numbers and checked quotes; the first report with unread records asks once whether to go on, unless it is the last request. |

Code checks every quote of a report against the story and drops a finding whose quote is not there.

The two fit together. One agent plays a story and another checks it, so a measurement does not need its moves written
in advance.

The first story behind these tools is the journal of this program's own live world. The agent interface of
[simple-story-chat](https://github.com/jointsome0-lgtm/simple-story-chat), a Telegram bot for branching interactive
stories, is to come.

## What works today

sagents needs Node 24.9 or newer and nothing else. It has no dependencies, and Node runs its TypeScript as it is.
It is run from a checkout of this repository: it is not on npm, and `"private": true` in `package.json` guards against
publishing it there by mistake. `npm link`, run once in the checkout, makes `sagents` a command of this computer: a
link to `src/cli.ts`, so the command is always the checkout as it stands. Without it `node src/cli.ts` takes the same
arguments, and `sagents help` lists them. `sagents --help` and `sagents -h` give the same text.

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
private note under it, and then the totals.

[The first command was played for release 0.1.0](docs/measured.md#release-010-first-command).

Every `live` request carries a strict `json_schema` `response_format`. A server refusing that field ends the run
at its first request; plain-text answers cannot be used. [The two server checks](docs/measured.md#servers-with-no-schema)
show those failures. The [live command reference](#the-commands-and-a-run) gives the limits and defaults;
[the connection reference](#a-server-of-your-own) gives the server settings and what is sent.

With a ChatGPT plan in place of a server, `login` signs this computer in once. `ask` sends one request by either
connection:

```sh
sagents login
sagents status
echo '{"model":"gpt-6.1-sol@low","messages":[{"role":"user","content":"Say hi"}]}' | sagents ask
```

`login` prints an address. Open it in a browser on the same computer, sign in with ChatGPT and approve. sagents listens
on `127.0.0.1` for the browser's way back, checks the answer and saves the tokens. `sagents login --new`, the `login --new` form, registers sagents
again, for another account or when signing in with the saved registration no longer works.
Sign-in has a ten-minute limit. After it succeeds, `login` prints the same status and model-list check as `status`;
without plan permission it also asks you to run it again and allow that permission.

`status`, as `sagents status [<model>]`, says whether this computer is signed in and checks the given model name,
`gpt-6.1-sol` by default. It prints whether this computer is signed in, whether plan use is allowed and the access
token's minutes left. Only when signed in with plan use allowed does it ask OpenAI for the plan's list of
models and check the name before any `@` effort suffix. The list is not the set of names a request takes: a name that is not in it
may be served all the same.

`sagents ask [--timeout <seconds>]` reads one request as JSON from stdin, at most 16,000,000 bytes, with a nonempty list of messages,
and prints one JSON line. `--timeout <seconds>` limits the call, the reading
of the request included, and is 180 by default; it accepts a finite number from 1 to 3600. It does not cut short a renewal of the ChatGPT plan's access token,
which a call begins with when the token is about to expire: the renewal runs to its own end, at most 90 seconds of
waiting for another sagents process that is renewing and then 30 seconds for the sign-in service, so that a new pair
of tokens is never lost unsaved, and a call whose limit passed meanwhile ends with `timeout` right after it.

| Field | Meaning |
| --- | --- |
| `model` | `api:<id>`, a model of [your own server](#a-server-of-your-own); or a model id of the ChatGPT plan, alone or as `<id>@<effort>` with `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. |
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
`createChatgpt` in `src/chatgpt.ts` sends once more after two seconds only when the connection rejects before a response,
within the same time limit and unless cancelled or timed out; a failure after any response is never sent again.

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

The [connection checks](docs/measured.md#connections-used) cover only the accounts and servers used there.

### A live world

`live` reads a world file and has a model play each of its characters, one request and one action per turn.
The world answers deeds and speaks for named people whom nobody plays. The rules keep time, things and memory.
`examples/night-station.json` is one evening; `examples/night-pass.json` is an evening, a night and a morning,
where memory after the night matters; `examples/seaside-cafe.json` is a café with a crowd and a waitress in a
mapped town. They are synthetic and in English, translated from Russian. The instructions are in English. Residents and memory rewrites use the sheet's language; world results
and figure replies use the world's description's language. [The example checks](docs/measured.md#translated-examples) cover
these translations; every other measurement here used the Russian texts.

#### The world file

The reader is `readWorld` in `src/laws.ts`, with `readCore` in `src/world.ts`. The file is a JSON object.
The tables below list the fields the reader uses. Unknown fields of a world object are ignored; an environment
refuses unknown fields. Required fields have no default. Text must be nonempty unless its entry allows null.
Boolean settings use forms such as `"clock": true`, `"open": true`, `"touch": true`, `"marks": true`
and `"ways": true`; hunger and fixed schemas use `hunger: true` and `fixedSchema: true`. All numeric settings must be finite. Durations derived from them must fit whole seconds from 1 to
1,000,000,000,000; this excludes worlds of 0.1.0 with longer durations, over thirty thousand years.
The check covers settings and derived durations, not seconds accumulated over a long story.

A word limit also limits characters to ten per word, so a text without spaces cannot evade it.
Optional bounded texts accept absence or null; an empty or overlong text is refused, rather than cut.
The texts are in the world's language. The public descriptions should name only what does not move.
Private `facts` belong to the world model alone. They never reach residents and do not change during a run.
`boundedOf`, `sizeOf` and `durationOf` in `src/reading.ts` hold these checks.

An `id` of a place, character, figure or vehicle is a string of 1 to 40 Latin letters, digits, `_` and `-`,
beginning with a letter, unique across those four lists. It cannot be `eaten`, `burned`, a thing label such as
`t7`, or an inherited JavaScript name such as `constructor`. When traces are on it cannot look like `m7` either.
`idOf` in `src/world.ts` holds this rule. Things and traces receive labels from the rules, not ids from the author.

##### World

`World` in `src/world.ts` describes what the core keeps. The law fields are read separately.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `title` | Required text. | The world's name, known to everyone. |
| `about` | Required text. | The description everyone knows. |
| `facts` | Text or null, absent for none; at most 300 words. | What is true but not public. |
| `clock` | Required `HH:MM`, from `00:00` to `23:59`. | The starting time on day 1. It does not give everyone a clock. |
| `places` | Required nonempty list of place objects. | The places anyone can go to. |
| `characters` | Required nonempty list of character objects. | The people whom models play, in their starting order. |
| `wordsPerMinute` | Number above zero, default 130. A 65-word speech, rounded up with a two-second minimum, must fit the duration bound. | The speech rate when a character or figure has no rate of its own. |
| `travelMinutes` | Number above zero, default 5; rounded seconds with a one-second minimum must fit the duration bound. | The walk time when neither a listed time nor coordinates give one. |
| `legMinutes` | Whole number from 1 to 60, absent for off. | A turn after each part of a walk, when at least one minute remains. |
| `walkMetresPerMinute` | Number above zero, default 80. | The pace used with coordinates. Every unlisted pair's distance must be finite and its walk fit the duration bound. |
| `remote` | Nonempty text or null, absent for none. | The means of remote contact, such as a telephone. Without it there is no `call`. |
| `shortWords` | Positive safe whole number, default 2000. | The recent-memory limit that starts a rewrite; waiting calls may require several rewrites. |
| `longWords` | Positive safe whole number, default 400. | The limit of a character's first memory and each rewrite. |
| `vehicles` | List of at most 6 vehicle objects, absent or empty for none. | Moving places. An empty list still selects the vehicle state format. |
| `touch` | Boolean, default false. | Keeps touches between two people as state. Sleep does not end them; crossing a place's boundary does. |
| `marks` | Boolean, default false. | Keeps lasting feelings of a body, including temporary relief. It changes no body or ability. |
| `deedEnds` | Boolean, default false. | Gives deeds a start and an end, as described under Action spans. |
| `portions` | Boolean, default false. | Lets food be eaten or drunk in thirds, with parts and empty containers shown in the lists. Works without hunger. |
| `prices` | Boolean, default false. | Prices on things of a place let a figure's answer move their payment into its till. |
| `ways` | Boolean, default false. | Lets the world name a deed's way to another place; the rules then take an ordinary `go`. |
| `fixedSchema` | Only true or absent, default off. | Keeps deed and figure reply schemas fixed for this world, with the values allowed now in the request text and checked by the engine. |
| `hunger` | Only true or absent, default off. | Turns on hunger and thirst together. The world must contain a thing with `food` above zero and a thing with `drink: true`, anywhere in its lists. It causes no fainting, illness or death. |
| `stableFirst` | Boolean, default false. | Moves a resident's memory and closed blocks of recent lines to the instructions. |
| `oneSchema` | Only true or absent, default off. | Uses one response schema for resident turns and memory rewrites. |
| `environment` | Name or null, absent for none; 1 to 40 lower-case letters, digits and `-`, first a letter or digit. | `"environment": "<name>"` reads `environments/<name>.json`. The command's choice wins over this name. |
| `dayStart` | `HH:MM`, default `07:00`; null uses the default. | The daily start from which the first sleep debt is counted. |
| `tiredHours` | Number above zero, default 16; rounded-up seconds must fit the duration bound. | When tiredness is named to the character and others nearby. |
| `spentHours` | Number above zero, default 24; at least `tiredHours`, with the same duration bound. | At this debt a turn becomes eight hours of sleep, without a request. |
| `weather` | Weather object or null, absent for none. | A schedule or a seeded series of perceptions. It does not slow, chill or wake anyone. |

##### Place

`Place` in `src/world.ts` is an ordinary place, with no hours or door state.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | The destination of a walk and holder of its things. |
| `name` | Required text. | Its public name. |
| `about` | Required text. | What everyone knows of it; use only what does not move. |
| `facts` | Text or null, absent for none; 300 words at most. | Truth for the world model alone. |
| `things` | List of things, default empty; at most 60 records including all contents. | What the rules can find, move, eat, burn and change here. |
| `open` | Boolean, default false. | True for open sky, otherwise a roof; selects weather and cues to time. |
| `clock` | Boolean, default false. | A clock at hand for anyone here. It is not a movable thing. |
| `crowd` | Text or null, absent for none; 60 words at most. | Who is around as anyone sees them. The crowd answers nobody. |
| `figures` | List of figure objects, default empty. | Named people who answer a speech addressed to them. |
| `at` | Two finite numbers `[x, y]`, east and north in metres, or null; absent for none. | When both ends have coordinates and neither lists a time, the straight-line walk at the world's pace, in whole minutes above ten or tenths up to ten, with a one-second minimum. |
| `minutesTo` | Object from another place's id to a number above zero, default empty; rounded seconds with a one-second minimum must fit the duration bound. | Overrides coordinates and the world's fallback time. The departing place's value wins if both ends list the pair. This can make the two directions differ. |
| `alongTo` | Object from another ordinary place's id to nonempty text of at most 60 words, absent for none. | What the world reads for a deed along that way with `legMinutes`. Either end supplies it; the departing end wins when both list it. |
| `nextDoor` | List of other ordinary place ids, default empty. | A door or thin wall that can carry a deed's sound. Either end listing the pair makes it mutual. Speech itself never passes it. |

##### Character

`Character` in `src/world.ts` separates a sheet, which stays true, from a memory, which ages.
Put today's debt, a sum owed or where something was put in memory, rather than in the sheet.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | The person whom the model plays; also a holder and a call's recipient. |
| `name` | Required text. | Its public name. |
| `place` | Required ordinary place id. | Where it starts, awake. A character cannot start inside a vehicle. |
| `sheet` | Required text. | Who it is. No other resident or world model receives it. |
| `memory` | Text or null, absent for none; at most `longWords` words. | What it remembers at the start: what it saw, owes or knows. |
| `facts` | Text or null, absent for none; 300 words at most. | Unchanging truth for the world model alone. |
| `looks` | Text or null, absent for none; 60 words at most. | The body and face, which never change. Clothes belong among things that can be taken off. The owner has it in its system text; people nearby see it. |
| `pose` | Text or null, absent for none; 20 words at most. | How and where within its place it is. Going and falling asleep clear it; waking keeps a pose given during sleep. |
| `carries` | List of things, default empty; 30 records at most including all contents. | What it carries or wears, which goes with it. |
| `clock` | Boolean, default false. | A watch or phone at hand, not a thing that can be handed over. |
| `wordsPerMinute` | Number above zero, absent for the world's rate; same speech-duration bound. | The rate for this person's `say`, `call`, words with a deed, and turn's speech limit. |
| `traces` | List of at most 8 different nonempty texts, 12 words each, absent for none. Whitespace is joined and trailing `.` or `;` removed before checking for repeats. | Temporary visible marks on body or clothes, such as `pink pudding on the upper lip and the tip of the nose` or wet hair. Even an empty list turns traces on for the world. They do not fade or pass to anything by themselves. |
| `marks` | List of at most 6 initial mark objects (`MAX_MARKS`), default empty; no repeated zone and kind. | Lasting feelings from the start, permanent until changed. A nonempty list needs the world's `marks: true`; an empty list does not. |

##### Figure

`Figure` in `src/world.ts` is a named person of one place whom no model plays.
Each figure is `{ id, name, looks, facts, wordsPerMinute, hours }`. It has no sheet, memory, turn or carried things, never speaks first, wakes nobody and follows nobody.
A call cannot reach it. Asking it to answer costs a request even when it says nothing.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | A `say` with this `to` addresses it when it is in the speaker's place. |
| `name` | Required text. | Its public name. |
| `looks` | Text or null, absent for none; 60 words at most. | What anyone in the place sees. |
| `facts` | Text or null, absent for none; 300 words at most. | What the world knows when speaking for it, never sent to residents. |
| `wordsPerMinute` | Number above zero, absent for the world's rate; same speech-duration bound. | The rate of its answer. |
| `hours` | Two different times read with `TIME` in `src/reading.ts`, like `["07:00", "12:00"]`; absent for always here. | Its daily hours, from the first time up to the second, the second excluded; an earlier second time runs over midnight. |

`figureHere` in `src/time.ts` decides presence from the world file and the moment alone. Outside its hours a figure
is away, cannot be seen or heard and does not answer. Requests give only its name and hours in the away line;
its looks and facts are withheld. A figure here with hours has `Here from F to T.` after its list line.
`hoursOf` and `awayOf` in `src/live.ts` build these additions. No arrival or departure is saved or asks a model.
A resident's wait in the place ends at the next coming or going if it would last longer, through `figureChangeIn`
in `src/time.ts` and `apply` in `src/action.ts`; a wait on a walk, in a vehicle or continuing a deed keeps its span.
Past speech and answers keep the figure's name and speech rate, through `namesOf` and `figuresOf` in `src/world.ts`,
which still include every figure of the file. A file without hours keeps its requests and saved state unchanged.

##### Thing

`readThings` and `Thing` in `src/things.ts` hold this form, whether in `things`, `carries` or another thing's `holds`.
The first level is 1; there are at most four levels. A thing has one holder, a place, a person or another thing.
Each thing is `{ name, … }`. A count holds nothing, so four mugs with contents need four records.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `name` | Required text, 8 words at most; none of `, ; [ ] ×`. | The name used in lists and postings. |
| `facts` | Text or null, absent for none; 300 words at most. | Truth of the thing itself, such as what a notebook says or what a bag does not hold. It goes with the thing; write sentences naming it, since the world reads them among the place's facts without labels, and word two like things so that their facts tell them apart. |
| `n` | Whole number from 1 to 1,000,000,000, absent for one uncounted record. | A count of things alike, such as money, cigarettes or logs. |
| `holds` | List of things, absent for no container. | A table, bag or coat with pockets. Even an empty list makes a container; it cannot also be counted, a stock, food or something that burns. |
| `open` | Boolean, default false; true needs `holds`. | Its contents are in plain sight. It does not open a door between places. |
| `fixed` | Boolean, default false; allowed only at a place's top level or inside a fixed thing. | A part of the place that cannot move. Never allowed on a character or inside something movable. |
| `price` | Object `{ name, n }`, absent for none; needs `prices`. | One costs `n` units of the counted money named by `name`, with the bounds of a fare. Only on movable things of an ordinary place, never money or things carried by a character. |
| `till` | Boolean, default false; needs `prices`, `holds` and `fixed`. | Where prices are paid. Never hidden or inside a hidden thing, on a character, in a vehicle or at the fourth level, where it could hold nothing. A place has at most one at any depth, and exactly one when it has priced things. |
| `stock` | Boolean, default false; cannot have `n` or be money. | A supply with no count; taking from it does not use it up. |
| `food` | Finite number, zero or above, absent for none. | Calories of one, and permission to eat it. Only hunger accounts for the calories. |
| `drink` | Boolean, default false; true needs `food`, zero for water. | Each one is a drink, including what comes from a stock. Read but does nothing without hunger; never shown in requests or thing notation. |
| `burns` | Boolean, default false. | Permission to burn it up, when there is fire. |
| `states` | 2 to 4 different strings, default none; each 1 to 30 characters with no whitespace, `/`, `(`, `)` or the signs forbidden in a name. | The states it can be in. Not allowed on a count or stock. |
| `state` | One of `states`, default the first; absent when there are no states. | Its starting state. Needs `states`. |
| `fire` | Boolean, default false, or one of `states`. | True can set things alight; a named state can do so only while it is current. |
| `money` | Boolean, default false; true needs `n`. | Counted money, which a deed neither creates nor uses up. A bus fare can use it up. |
| `hidden` | Object `{ spot, minutes }`, absent for visible; only on a place's or vehicle's top-level thing. | What lies unfound, with its contents. Finding makes it visible to everyone. |

##### Hidden thing

`readThings` in `src/things.ts` reads these required fields of `hidden`, with no defaults.

| Field | Type and bounds | What it means |
| --- | --- | --- |
| `spot` | Nonempty text, at most 20 words. | The exact spot a deed may go straight to. |
| `minutes` | Number above zero; rounded-up seconds fit the duration bound. | A person's accumulated search time here. A short deed straight to the spot can find it sooner. |
The earlier text forms of a character's `holds` or `has`, a text of `things`, and a place-level list `hidden`
are refused. They are not silently lost.

##### Vehicle and fare

`Vehicle` and the vehicle part of `readCore` in `src/world.ts` describe a moving place.
It has no hours, figures, crowd, clock or coordinates. People and things stay inside its place throughout a drive,
with speech, deeds, sleep and the weather as in an ordinary place. The world's weather holds on the way.
A standing vehicle and its stop are next door; a driving one has no neighbour.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | Its place id, named in a `go` to get in. |
| `name` | Required text. | Its public name. |
| `about` | Required text, 60 words at most. | Its unchanging description. |
| `at` | Required ordinary place id; for a bus the first route stop. | Where a driven vehicle starts. A bus's position follows its timetable and the starting clock. |
| `faster` | Required whole number from 2 to 30. | Divides the walk time, rounded up to seconds with a thirty-second minimum. |
| `seats` | Required whole number, 1 to 12; for a bus 1 to 60. | The number of people allowed inside. |
| `drivers` | List of distinct character ids, absent for anyone, empty for nobody. | Who may drive. Refused with a route. |
| `reach` | List of distinct ordinary place ids, absent for all, empty for none. | Where it may drive. Refused with a route. |
| `open` | Boolean, default false. | An inside under open sky, rather than a roof. |
| `things` | A place's list of things, default empty; 60 records including contents. | What is inside, which goes with the vehicle. |
| `route` | List of 2 to 12 ordinary place ids, absent for a driven vehicle; no consecutive repeat, including last to first. | A bus that nobody drives, going around these stops. It takes the place of `drivers` and `reach`. |
| `leaves` | Required with a route, 1 to 48 `HH:MM` times in strictly rising order. | Daily departures from the first stop. The round must finish strictly before the next, including over midnight. Ignored without a route. |
| `stands` | Whole seconds from 30 to 1800, default 60 with a route. | The pause at each stop after the first. At the first it waits for the next departure. Ignored without a route. |
| `fare` | Object `{ name, n }`, absent for free. | The price of boarding a bus; ignored without a route. |

##### Fare

`readCore` in `src/world.ts` reads these required fields of `fare`, with no defaults.

| Field | Type and bounds | What it means |
| --- | --- | --- |
| `name` | Nonempty text. | Names a counted thing of money in the world file. |
| `n` | Whole number from 1 to 1,000,000,000. | The price of one ride. |

For example, a synthetic bus is:

`{ "id": "bus4", "name": "Bus 4", "about": "A yellow town bus.", "at": "pier", "faster": 4,
  "seats": 20, "route": ["pier", "market", "hill"], "leaves": ["08:00", "08:30"],
  "stands": 60, "fare": { "name": "rubles", "n": 30 } }`

A driven car could instead have `{ "id": "blue", "name": "Blue car", "about": "A small blue car.",
"at": "pier", "faster": 4, "seats": 3 }`.

##### Initial mark

`readGiven` and `Given` in `src/marks.ts` read each entry of a character's `marks`.
Each is `{ zone, kind, level, text }`. Every field is required, with no default.

| Field | Type and bounds | What it means |
| --- | --- | --- |
| `zone` | `head`, `face`, `neck`, `shoulders`, `chest`, `back`, `belly`, `hips`, `arms`, `hands`, `legs`, `feet` or `body`. | The part of the body; `body` is the whole of it. |
| `kind` | `itch`, `burn`, `ache`, `pain` or `numb`. | The kind of feeling. |
| `level` | `faint`, `clear` or `strong`. | Its strength. |
| `text` | Nonempty text, 15 words at most. | Where exactly and what it feels like. |

##### Environment and weather

An environment holds only `dayStart`, `tiredHours`, `spentHours` and `weather`, in the forms above and below.
The world file's explicit value of any of these wins over the environment's, including null where allowed.
The environment is checked on its own, so an override cannot hide an invalid setting. Hunger belongs to the world
file alone. `environmentOf` and `readWorld` in `src/laws.ts` hold the choice and the merge.
The CLI reads the files; the core reads none. The three supplied environments are `mountain-winter`, for
«A Night on the Pass», `sea-summer` and `village-summer`, synthetic texts in English.

`readWeather` and `skyOf` in `src/weather.ts` read either of these weather forms.
A seeded series takes precedence when `seed` is present; otherwise a schedule needs `start`.

| Object | Field | Type, default and bounds | Meaning |
| --- | --- | --- | --- |
| Weather schedule | `start` | Required sky object. | Weather at the story's start. |
| Weather schedule | `changes` | List of change objects, default empty. | Changes strictly after the start and one another, each elapsed time fitting the duration bound. |
| Weather series | `seed` | Required nonnegative safe whole number. | Determines state and duration by seed and change number alone; no state comes twice running. |
| Weather series | `states` | Required list of at least 2 sky objects. | States that must read true at any hour; the series knows no season or time of day. |
| Weather series | `minutes` | Required pair of positive safe whole numbers `[least, most]`, most at least least; both times in seconds fit the duration bound. | The shortest and longest span of one state. |
| Sky, or change | `text` | Required nonempty text, 40 words at most. | What is seen and felt under open sky. |
| Sky, or change | `indoors` | Text or null, absent for none; 40 words at most. | What reaches under a roof, or nothing. |
| Change | `day` | Required positive safe whole number. | Day 1 begins at the starting clock, later days at midnight as the clock counts them. |
| Change | `at` | Required `HH:MM`. | The time of day of the change. |

#### The commands and a run

```sh
sagents live examples/night-station.json [--model <id>] [--cast <character>=<id>]... [--world-model <id>] \
  [--minutes <n>] [--calls <n>] [--tokens <n>] [--state <file> | --run <dir>] [--environment <name>] [--json]
```

`argumentsOf` in `src/cli.ts` reads the flags. A bad world or option fails before asking a model.

| Flag | Default, bounds and effect |
| --- | --- |
| `--model <id>` | `gpt-6.1-sol@low` of the ChatGPT plan. Plays residents not named in the cast. `--model api:<id>` uses [your server](#a-server-of-your-own). |
| `--cast <character id>=<model name>` | Repeatable, absent for no overrides. Names a character id exactly once and a model name in the same form as `--model`. Both turns and rewrites go to that model. An unknown character, repeated id or missing half is refused. |
| `--world-model <id>` | The `--model` name. `--world-model` answers deeds and speaks for figures. |
| `--minutes <n>` | 30 story minutes; a number above zero and at most 1440. Ends at the story horizon, or pauses a kept world. |
| `--calls <n>` | 60; a whole number at least 1. Counts every request when sent, including retries, rewrites, cuts, declines and the request that ends the run. |
| `--tokens <n>` | No ceiling; a positive safe whole number when given. `--tokens` stops with reason `tokens` before another request once reported input plus output reach it; the last request can cross it. An answer that reports no usage is read under the usual rules; a failed request also leaves spending unknown. No further request is sent: the ceiling cannot be kept without the counts, and `--calls` is the limit for a server that reports none. The reason is then `unreported`, unless another stop ends the run first. |
| `--state <file>` | None. Opens or creates a SQLite journal and continues it. |
| `--run <dir>` | None. Keeps an experiment directory and continues it as another stretch. Cannot be given with `--state`. |
| `--untaken-text` | Off. Requires `--run`; see the untaken-answer file below. |
| `--environment <name>` | The world file's choice, or none. Same name bounds as the field; reads `environments/<name>.json`. |
| `--json` | Off. Prints one JSON object per event, including silent waits, followed by JSON totals. |

Without a state file the journal ends with the run. A resident is told how much story time is left and its speech
limit shortens towards the end. With state, the end is a pause, no resident is told a horizon, and `--minutes`
counts from an unfinished deed's moment, else the next due clock law or vehicle arrival, else the next person's turn.
The library's `runLive()` given a journal without `pause` still tells the horizon; the CLI always uses pause with state.

The run stops at the first model-connection failure except cuts and declines, and switches nobody to another model.
An `output_limit` loses that turn or takes one of the world's or memory's two tries, with no usage known.
A `declined` request is never sent again with the same words: its turn becomes a wait, its deed has no result,
and its rewrite is lost unless a readable first answer was set aside. The third decline in the run, for any model
or purpose, ends as `failed (declined)`. Both count as calls and unusable answers.
Five consecutive tasks left with nothing usable end as `failed (stalled)`, after the finished task is journalled.
Each resident has a separate streak for turns and rewrites; the world has one for deeds and figure replies together.
A turn with no action, a lost rewrite or a world answer not accepted after its tries adds to that streak; acceptance
clears only that streak. Unreadable answers, rule refusals, cuts and declines can all leave a task unusable.
`invalid` counts and cut streaks no longer end a run by themselves. A terminal connection failure or the decline
limit ends it without a record of that task, except a readable memory set aside is saved even when its retry stops
the run. `failedRun` and `declinedRun` of the library's `runLive()` have no CLI flags; their defaults are 5 and 3,
and `Infinity` turns each limit off. Streaks and counters start fresh at each start.
`runLive` in `src/live.ts` holds these stops. No real service refusal was seen; the documented shapes that count
as `declined` are in the [table of reasons](#what-works-today).

In text output each event has a line with clock, place, who and what. Further lines show found, moved and changed
things, poses, touches, private feelings, lasting feelings, traces left or wiped, sound next door, words with a
deed and a private note. A gesture stands in brackets before speech. A wait without a note prints nothing.
A turn on the way has the way, its direction and the minutes still ahead in place of a place.
A rewrite is shown whole, across all its lines, marked private like a note. `linesOf` in `src/live.ts` holds this
transcript. The totals give status and reason; HTTP status, provider code and field name when present, never the
service's words (`failed (provider_failed 502 bad_gateway)`; `httpStatus`, `providerCode` and `param` in JSON).
`provider_failed` without a status means the service could not be reached. A failed run exits with code 1.

The totals count story minutes, calls, `invalid`, `overlong` cuts, `declined`, memory `rewrites` and `lost`,
world answers `refused`, deeds and speeches left `void`, input tokens, `cachedInputTokens` and output tokens.
`Outcome` in `src/live.ts` also counts each untaken resident turn, world answer and figure reply by cause in
`causes.turn`, `causes.world` and `causes.reply`, with only causes that occurred. A turn's cause is the word of
`REFUSALS` in `src/action.ts` that its `act` record holds; a final service decline with no record also counts as
`declined`. JSON totals include `causes`; text leaves the closing line unchanged and adds
`not taken: turn json 5, here 1; world to 4, sink 5; reply what 2` when any occurred, with kinds in that order
and causes in the order of `UNTAKEN_CAUSES` in `src/live.ts`.
They sum only reported usage: `unreported` counts answers without usage and requests that failed with a `ModelError`,
rather than calling their spending zero; an absent cached count adds nothing. `kinds` divides requests and tokens into turns, rewrites and world answers,
including figure replies and retries. Text prints one line for each kind. `models` also divides calls, unusable
answers and tokens by model name, with text lines when several models played. Endpoint names can add that line
for a single model too, as [the connection](#a-server-of-your-own) says.
Each journal entry's `by` is the model name, or null for an engine record; JSON events print it. The rules do not
read it: records give the same world whoever answered. Every perception goes to the service playing its owner.

##### Files and continuation

`openState` and `formatOf` in `src/state.ts` hold the saved format and opening checks.
A new or empty file becomes a state file; an unrelated SQLite database is refused without writing to it.
Each record is saved with its event, one at a time. Opening replays every record and requires the same event.
The hash of the world file's content and its environment's content binds the file to both; editing or exchanging
either refuses continuation. A second run on a file in use is refused. A state stopped on the way arrives at the
same destination and instant when continued. An unfinished deed or addressed speech asks the world first, except
that with deed ends a deed still going is rebuilt and continues until its answer is due.

The format is the first applicable row below. A state opens only with its world's mark, since earlier versions
would ignore settings and lose their state.

| Condition | Format |
| --- | --- |
| Any figure has `hours` | `49` |
| `prices` | `47` |
| `portions` | `46` |
| `deedEnds` | `45` |
| `legMinutes` | `44` |
| `stableFirst` | `43` |
| `oneSchema` | `40` |
| `fixedSchema` | `39` |
| `hunger` | `31` |
| `ways` | `30` |
| Any character or figure has `wordsPerMinute` | `29` |
| Any character has `traces`, even empty | `23` |
| `marks` | `22` |
| `touch` | `21` |
| Any vehicle has a `route` | `20` |
| `vehicles` is present, even empty | `19` |
| Otherwise | `18` |

Thus vehicles with touch take `21`; a speaker's rate wins over those and loses to ways, hunger and fixed schemas.
The earlier README reports that files of releases 0.1.0 and 0.1.1 with none of these settings and no `vehicles` still open. Their worlds that
already had hunger, touch, marks, traces or a speaker's rate have mark `18` and are refused, because those
releases ignored the setting. It also reports that files written under the earlier order that allowed a turn between simultaneous
arrivals are another version and are refused. These historical format claims are unconfirmed here; the current
opening and replay checks above are the code's rules.

A state file also holds its own random name. Requests derive one `cache` name for each resident and one for the
world, so continuation keeps them and a new journal has others. An unsaved run makes one for itself. They are
not printed or journalled; a byte copy of a state file keeps the original's names. Each connection says how it
sends them. This groups requests without putting story text or ids in the names.

`keepRun` in `src/kept.ts` keeps `--run` as files the [lab](#the-lab) reads:

| File | Contents |
| --- | --- |
| `world.json` | The world file as given. A directory with another world file is refused. |
| `state.sqlite` | The state described above. |
| `part<N>.events.jsonl` | One event per line for that start, beginning with `part1`, then `part2` and so on. |
| `usage-part<N>.jsonl` | One row per request: when sent, purpose (`turn`, `memory`, `world`, `reply`), owner, model, milliseconds, reported input, cached, output and reasoning tokens, and failure code `error`. A failure keeps `status` when it has an HTTP status; on the plan, `stage` is `connect` before a response or `stream` after one, and a decline keeps `refusal` as `event`, `filter` or `part`. A second try keeps `tries: 2`, even on success; these fields are absent otherwise. No request, answer, failure text or service code. |
| `untaken-part<N>.jsonl` | One row per untaken resident turn, world answer or figure reply, after judgment: `n` names its usage row, `kind` is `turn`, `world` or `reply`, and `cause` is the code counted above. Empty when every answer was taken. With `--untaken-text` only, also the rule's refused `entry` when there is one and the model's `answer` when there was text; a turn has no `entry`, and a cut or decline has no `answer`. This file then holds model words like the events file. Use the option only for worlds whose text may be kept. |
| `about.txt` | Your description of the experiment, when you add one; the lab shows it. |

A second start adds the next stretch. Files are made only where absent, lines only appended; nothing is
overwritten or shortened. The state event is saved before the event line, so a killed run can have it in its
world but absent from that stretch. The state does not keep earlier starts' totals. Node warns that SQLite is
experimental.

#### What a model is sent

`sharedOf`, `systemOf` and `runLive` in `src/live.ts` build a resident's request anew: its fixed instructions,
name and sheet, and one message of memory, perceived lines and current surroundings. No earlier request or
answer is resent, and no resident receives another's sheet, note or memory, or an unperceived event.
The fixed opening gives the world's title and public description, the ordinary places with ids, descriptions
and neighbours, the played people's names and the means of remote contact. With vehicles it lists their name,
id, description, seats and allowed drivers by name, or anyone; a bus instead gives route, times and fare.
The list opens `Vehicles:`. It never gives their position and stays fixed; the action schema names vehicles from the first turn, even as they move.
Only worlds with vehicles add the vehicle rule line, with the round and automatic fare clauses only when relevant.

A turn lists figures here under ``People of this place, who answer when you say with `to`:`` only when some are here,
then names any away figures with their hours. Without another resident here, the choice of nobody or no played people
counts only figures here and the crowd. `runLive` in `src/live.ts` builds these lists. It lists the crowd as
`Around you: …`. It gives its owner its pose, traces and carried things three levels deep with counts. For people in its place
it gives looks, pose, traces and visibly carried things. Open containers show contents; closed ones conceal them.
It gives figures' names and looks, the crowd, sleep debt, its owner's hunger and thirst when needed, local weather,
its own lasting feelings and touches it holds or sees. It gives current place and walking times to ordinary places
when outside a vehicle. Inside it gives the stop or destination and minutes and seconds to departure or arrival,
never an arrival clock time. A vehicle elsewhere is not revealed. A place's things are learned by a deed and its
answer; hidden things and all facts are withheld. Its own looks are in the system text.

The `action` is `say`, `call`, `go`, `do`, `wait` or `sleep`, with an optional private `note` written before the action.
The note is what goes on in the character now, what it notices, feels, wants and holds back, rather than a plan.
A `say` can have a `gesture`, what its face, hands or body do, seen with the speech but not sent to the world.
Only a figure here at the turn's moment can be its `to`; `readAction` in `src/action.ts` drops any other `to`,
saying the speech to the room without a reply request. A speech begun while the figure is here is answered.
A `do` can have `says`, spoken aloud
before the world answers; the world still receives the deed alone. [Gestures, words and note order were checked
together](docs/measured.md#gestures-words-and-notes), without counting whether the action follows its note.
`schemaOf` in `src/live.ts` lists the world's actions and place ids, omitting `call` without remote contact.
The other fields are text or null, or a whole number or null for `seconds`. [The turn schema check](docs/measured.md#turn-schemas)
compared invalid destinations; a server ignoring the schema can still write one, which the rules refuse.

`worldSystemOf`, `deedOf`, `placeOf` and `hereOf` in `src/live.ts` build a deed's request. It has the world's
description and facts, the place and its facts, listed and hidden things, ordinary other places, the clock, doer,
deed and span. For people here, awake or asleep, it has name, id, looks, pose, things and facts; for neighbours
only names, ids and whether awake or asleep, or nobody. `crowdOf` in `src/live.ts` gives the crowd and figures here
with looks and facts at the deed's moment, followed by the away line,
recent deeds, and recent speeches to figures and their answers. With deed ends it describes the place when the
answer is due, and `doingOf` in `src/live.ts` also lists other deeds still going here. A vehicle inside has its
description and the places between which it drives or the stop where it stands; a deed outside sees only vehicles standing there.
It has optional traces, touches and lasting feelings as described below. It has no sheet, note, memory or speech
between residents. [The port's deed checks](docs/measured.md#deed-requests-on-the-main-line) do not measure what
these mechanisms change in a story.

Every listed thing's facts reach the world, whether hidden, carried or nested, for deeds and figure replies.
They follow the place's facts as sentences without labels or headings, once per identical text at its first record:
`The place: Red room (red), under a roof. Red walls. Facts: FACT-RED. FACT-KEY.`
A part taken from a stock or count keeps its facts; counts merge only with identical facts.
In `examples/night-pass.json` the guest register, backpack, map and notebook carry their own texts.
This layout avoids a labelled facts block that led a weak model to move things against the lists;
[the combined check](docs/measured.md#facts-of-things) did not isolate each part of the request.

`resultSchemaOf` in `src/live.ts` and `readResult` in `src/answer.ts` hold the world's answer and its checks.
The answer lists entries before its prose `result`, so words cannot lead the entries. [Both orders were checked](docs/measured.md#order-of-the-world-answer).
With traces, `traces` and `wipes` come last, after `result`, in that order; [that order's checks](docs/measured.md#traces-in-the-answer)
were on the earlier line. Each request's schema enumerates allowed labels, ids and states. An empty enum takes
any string because a strict schema may refuse an empty list; all states share one list, so it cannot hold a state
to its own thing. Code then drops out-of-place `finds`, `poses` and `feels`, or `wakes` naming no sleeper here or
next door. Invalid moves or states refuse the whole answer. More than 12 moves or 6 state entries makes it unusable.
Answer texts are cut at their word limits. An empty `beyond` is null, and an empty pose clears the pose.

| Answer field | Meaning and limit |
| --- | --- |
| `search` | Whether the deed searched the place. The rules count its seconds. |
| `finds` | Labels of hidden things whose exact spot the deed went straight to. Unknown labels are dropped. |
| `moves` | Entries `{ what, n, to }`: thing label, count and destination, a person here, this place, a container label, `eaten` or `burned`, and with portions `tasted` for a third of one food, with `n` 1. No `from`; the rules already know it. |
| `sets` | Entries `{ what, state }`, changing a thing to one of its states. |
| `poses` | Entries `{ of, text }`, where and how a person here is; 20 words. A pose names no other place. |
| `touches` | Only with touch, after `poses`, before `wakes`; entries `{ of, to, kind, force, text }` described below. |
| `wakes` | Sleepers here or next door whom the deed wakes. |
| `feels` | Entries `{ of, text }`, bodily feeling, not a thought or wish; 20 words, later entry per person wins. Only that owner receives `You feel: …`, even with no result. No sleeper, including one woken by this deed, figure, traveller or person elsewhere gets it. Empty entries are dropped. |
| `lingers` | Only with marks, after `feels`, before `beyond`; entries `{ of, zone, kind, level, minutes, text }` described below. |
| `beyond` | Sound next door, text or null, at most 20 words. |
| `result` | One or two sentences anyone here could see, hear or smell, 65 words at most, or null for nothing noticeable. |
| `traces` | Only with traces, entries `{ of, text }` left on people here. |
| `wipes` | Only with traces, labels of traces removed from people here. |
| `leads` | Only with ways, first before `search`: this place's id to stay here, another id for the doer's way there. |

`replyOf`, `replySchemaOf` and `figureInstructionsOf` in `src/live.ts` build a figure's request. It has the deed
request's place and people, without hidden things, neighbours, touches or lasting feelings. It includes crowd,
figures here with looks and facts at the speech's moment and the away line through `crowdOf` in `src/live.ts`,
recent deeds, and the latest 300 words said to the figures of this place and answered.
These lines are shared by all figures, not a figure's private memory. The answer has `reply`, up to 65 words or
null, and `moves` for something handed over while speaking. A figure's things are among the place's things;
it cannot eat or burn through its answer. With `prices`, moving a priced thing that lies in the place sells it,
wherever it ends up; the one who spoke pays into the place's till, and what arrives has no price. A thing left
where it is sells nothing, and neither does a priced thing that a deed has put into someone's hands or into a
place with no till. `reply` in `src/answer.ts` starts the answer when the speech ends and
holds those who heard it as speech does; it wakes nobody, and `applied` in `src/journal.ts` writes it into their
memories at that time. A deed's request includes what figures promised, too.

#### The mechanisms

##### Turn order and hearing

`next`, `apply`, `arrive`, `wake` and `attend` in `src/action.ts` keep residents taking turns in time order.
Arrivals come before waking and both before turns at one instant, so two who walk together are both there before
either looks around. [The arrival check](docs/measured.md#arrivals-at-one-instant) covered this order on one model.
With deed ends one waking can come after a turn of its instant: the one that the answer to a deed cut short at
that instant brings, since that answer follows the turn that cut the deed; every later turn of the instant comes
after it.
The clock displays whole seconds and names the day from day 2. Everyone awake in the speaker's place hears a
`say` and is held until it ends. A `call` reaches its recipient anywhere, with only the caller's half heard by
those near the caller. A sleeper or traveller gets its waiting calls on waking or arrival.

##### Action spans

`speechSeconds`, `wordLimit`, `travelSeconds` and `lasting` in `src/time.ts` give spans; `readAction` in `src/action.ts`
reads actions. Speech and a call are cut at 65 words and at the turn's limit, with the speaker's rate and a minimum
of two seconds. Notes and deeds are cut at 65, gestures at 12, words with a deed at 20 and the turn's limit.
A deed lasts at least as long as its words, and they hold listeners like speech.
`own` in `src/journal.ts` tells only the doer of a cut deed, on its own line like cut speech: `Your deed was longer than the limit: only its first words were done.`
[Speaker rates were checked with stand-ins](docs/measured.md#speech-rates), with no changed instruction text.
The walking fields above give the time. Walking hears nothing,
cannot stop and takes no turn on the way without `legMinutes`. With it, long walks take turns in parts;
speech leaves arrival unchanged, and a deed or wait stops the walker for its seconds before another part.
Vehicles, boarding and getting out keep their own rules.

A `do` or `wait` lasts chosen whole `seconds`, at most an hour, or `until` the next occurrence of a time of day such as `06:30`;
a `sleep` lasts at most 12 hours. `until` wins over seconds. An excessive span is capped without losing the turn;
the resident reads the seconds with no cut warning and the action record has `capped`, never sent in a request.
A deed's doer and a waiter get a turn early with speech, a call to the resident, leaving or arrival nearby, sound
next door, or a weather record reaching the place, even with unchanged text. Freedom waits for speaking and
listening to end. Without deed ends the deed is credited whole at once: the world answers its whole span.
A sleeper sees and hears nothing, interrupts nobody, and wakes early only by the world's `wakes`. Without deed
ends it wakes at the deed's intended end or its already earlier waking time; with deed ends it wakes when the
result is written, or at its already earlier waking time. Others see deeds, falling asleep and waking at their
own next turn; leaving and arrival also end their waits.

With `deedEnds: true`, `apply` in `src/action.ts`, `settlementDue` and `applied` in `src/journal.ts` and `runLive`
in `src/live.ts` keep at most one deed going per person. A `do` starts it without asking the world. `own` and
`perceived` in `src/journal.ts` tell the doer `You begin, for 600 s: TEXT`, or `You begin, until about 10:30: TEXT`,
and witnesses `X begins, for 600 s: TEXT`. At a turn before the end, `runLive` tells the doer
`You are still doing, 62 of 600 s so far: TEXT. To go on with it, answer wait: a do, a go or a sleep would stop it.`
and `doingOf` in `src/live.ts` tells others here `X is still doing: TEXT.` Speech, a call and a wait leave it
going. That wait lasts to the deed's end whatever span was asked: its event holds those seconds, its doer reads
`You wait (8 s).` with no `until about` form, and the action record keeps the span given. An answer that the rules
refuse or cannot use stops nothing, a refused `go` included: it costs 30 seconds or the seconds to the deed's end,
whichever is less, and its event holds them. Another `do`, `go` or `sleep` only stops the deed, without taking
that action, and the doer chooses again after its result. A doer who gets a turn at or past `spentHours` with a
deed going has it answered at that turn, cut short, and then falls asleep. `advance` in `src/journal.ts` has the
world answer a whole deed at exactly its end, even while its doer is speaking or listening; the doer's next turn
then waits for that speech to end. `deedOf` in `src/live.ts` and `stoppedOf` in `src/journal.ts` tell the world
`Now 10:30:00. X stopped after 600 of 600 s: TEXT`, or
`Now 10:21:02. X stopped after 62 of 600 s: TEXT. It was cut short.` Its answer takes effect then, including
moves, eating, finds, waking and sound next door. The doer remembers
`You stopped after 62 of 600 s: TEXT. It was cut short.` before the result. A deed stopped with no time spent
gets an empty result without a world request. `result` in `src/answer.ts` gives every result to everyone awake
in the place but the doer: they remember `X stopped after 62 of 600 s: TEXT. It was cut short.` before any
result lines, also when the result has no words and changes nothing and when no time was spent.
Without the setting the requests and journal stay unchanged.

##### Walks in parts

`deedEnds` and `legMinutes` cannot be set together yet.

`walkAt`, `legAt` and `turnSeconds` in `src/time.ts`, with `together` in `src/action.ts`, keep a walk's progress and
company. Walkers on the same way in the same direction are together when their arrivals differ by at most a minute.
They hear speech and see deeds as people in one place do; a stop that puts the arrival farther apart leaves one behind.
`go` walks on or turns elsewhere, back in the time walked or by the shorter route through either endpoint.
Sleep is refused until arrival, and forced sleep waits for it. `roadDeedOf` in `src/live.ts` gives the world only
these walkers, what they carry and wear, the weather and the way's description; nothing can be taken from a place
or left on the way. `advance` in `src/journal.ts` keeps way lines in memories and an optional `onWay` in events,
and rebuilds progress from kept actions. Passing walkers in the other direction is not built.

##### Time without a clock

`hasClock`, `timeFor`, `sensed` and `DRIFT` in `src/time.ts` keep clock knowledge local.
With a clock at hand a turn opens `Now 21:04:10.` and perceived lines keep clock times; without one it opens a
part of day, `Now evening, as far as you can tell: no clock is at hand.`, and a line begins `[evening]`. Nothing from the rules gives a clock time then; a time spoken aloud
stays speech. Memories keep the time as their owner could tell it when it happened, even after losing a clock.
Open-sky cues begin at 05:00 early morning, 07:00 morning, 10:00 late morning, 12:00 around midday,
14:00 afternoon, 16:00 late afternoon, 18:00 early evening, 20:00 late evening and 23:00 night.
Under a roof or on a walk without `legMinutes` they are 05:00 morning, 11:00 the middle of the day, 15:00 afternoon,
18:00 evening and 23:00 night. Later days are named. With a clock, `until` is an alarm at that time.
Without one, replayable drift is at most a tenth of the span and half an hour for sleep, a twentieth and three
minutes for deed or wait, never outside the action's allowed span. Its own line says `until about 06:00`.
The world always receives the clock.

##### Refused turns

An unusable turn is a thirty-second wait. `REFUSALS` in `src/action.ts` and `refused` in `src/journal.ts`
keep its reason and the next turn's sentence of what to do instead. The original nine are a non-JSON object,
unknown action, missing text, invalid call recipient, this place or unknown place, bad time, output cut or service
decline. Vehicle refusals add unavailable, full, driving, unauthorised driver, out of reach, self-driven round
and insufficient fare. A decline uses the non-JSON sentence because no separate sentence was measured; the
journal distinguishes them.

##### Vehicles and buses

`driveSeconds`, `busRound` and `busAt` in `src/time.ts` govern timing. `go` boards or gets out immediately,
holding the next turn ten seconds; boarding needs a free seat. Inside, `go` drives elsewhere immediately,
taking walk time divided by `faster`, rounded up, at least thirty seconds. The driver is busy ten seconds;
riders take turns en route. Ordinary journeys stay walks. There is no fuel, key, getting out, turning back or
changing destination on the way. Invalid journeys take a thirty-second wait and fixed refusal sentence;
driving a bus gives `This vehicle goes its round by itself.`
[Vehicle checks](docs/measured.md#vehicles-on-the-main-line) and
[bus checks](docs/measured.md#buses-on-the-main-line) showed drives and paid rides, without measuring their
effect on the story.

`pay` in `src/things.ts` takes directly carried money first, then contents, then their contents, in list
order. Too little takes nothing: `You need 30 rubles for the fare.` Only the payer reads `You pay 30 rubles.`
after boarding. Getting out gives no refund; staying another round costs no fare. A holder with id `fare` can
receive ordinary moves; deeds cannot use up money.

`vehicleView` and `standingAt` in `src/journal.ts` give `Here stands:` lines with free seats and a bus's next
departure: `Here stands: Blue car (car), 1 of 2 seats free.` or
`Here stands: Bus 4 (bus4), 19 of 20 seats free, leaving for Hill in 1 min 0 s.` A line is written on first
sight, arrival, pull-up or a change of seats, with the time left then; time alone adds no line. Outside,
`Bus 4 has driven off.` and `Bus 4 has pulled up.` name no occupants. At a stop a bus's pull-up frees only
those who wait, with the standing line at once; others get it at their next turn only if the bus remains, and
a long deed continues to its end. A driven vehicle's arrival frees everyone awake where it arrives. A departure
ends no wait; its line waits for the person's turn. Inside, arrival frees everyone awake and is told in the
vehicle's words; departure is only in the next `Now` position line. Bus sleepers get no notices, even on
waking; their `Now` gives position. Driven-vehicle sleepers get arrival on waking.

`vehicleDue` and `applied` in `src/journal.ts` give one bus arrival record only with someone awake at its stop
or inside beforehand. Other bus instants add no record, request or delay to the run or horizon; the timetable
restores position after a pause without witnesses. Replay refuses a `round` refusal without a round. Vehicle
arrivals follow weather and precede sleep at the limit, people's arrivals and turns at the same instant.
Without vehicles, requests and journals stay unchanged. This port keeps the main line's rebuilt turns and the
candidate's transport wording; it has no opening hours, places on demand, closed-place refusals or going by
words.

##### Things and deeds

`settle`, `keep`, `stocked` and `sought` in `src/things.ts`, with `result` and `refusal` in `src/answer.ts`,
keep model prose from changing counts. A deed is an attempt, not a fact. The rules take an answer's moves in
order, the whole answer or none. A whole record keeps its label and contents; a part of a count or stock is
another record, the rest stays, and compatible counts at a holder merge. A stock is unchanged. Labels `t1`, `t2`
and on follow file order and are never reused or shown to residents. The world reads notation such as
`t8 parka [t9 cigarettes ×17, burns; t10 lighter, fire]`, under `Things here`, `Carries`, and brackets for contents.
With portions, `written` and `shown` in `src/things.ts` add `two thirds left` or `a third left`
after food in the world's notation and after the name and count for residents. Empty containers read `[empty]`;
residents see it only where they could see contents, through two levels of their own things or open things of others.
`written` in `src/things.ts`, with `prices`, adds `price 6 euro` for what one costs and `till` for where payment
goes, after the other marks; residents read neither. There is no model-maintained list or count.

An answer is refused for its first unknown or unfound hidden thing, fixed thing, excess count or more than 20
from stock, invalid holder, self-containment or nesting beyond four, non-food eaten, nonburnable burned or burning
without fire, money eaten or burned, more than 30 records on a person or 60 in a place, or invalid state.
With `portions`, `tasted` also refuses non-food or money and any `n` other than 1; a figure's reply has no sinks.
The id `tasted` is reserved with `eaten` and `burned` only with the setting.
Moves all to their current holders refuse it because prose could claim a move that did not happen; beside an
actual move they are passed over. A refusal changes nothing and is not journalled. The world gets the same
request once more with a sentence naming the entry and cause in its instructions' words. After the second,
nothing comes of the deed or speech; totals count `refused` and `void`. `runLive` in `src/live.ts` passes each
untaken attempt to `Live.onUntaken` for the kept file above. The closed list `UNTAKEN_CAUSES`
in `src/live.ts` is `cut`, `declined`, `unread`, the rule codes of `CODES` in `src/things.ts` and `TRACE_CODES` in
`src/answer.ts`, then the words of `REFUSALS` not already in the list, each once; no untaken answer enters the journal.

With `prices`, `settle` also refuses a figure's answer with `price` when the one who spoke cannot pay,
using its first sale as the refused entry. After moves and before sets, it sums each money name's prices,
subtracts what the answer already took from that person's money, and moves the balance into the till.
Money received in the answer increases the balance due. It takes directly carried money first, then contents,
then their contents, in list order, as `pay` does. These are ordinary postings, marked `price` only for the
printed line's ` (price)`; replay derives them again. A deed pays nothing and keeps a thing's price.

Only stock creates things; only eating, burning and fares remove them. With `portions`, tasting the last third
also removes a thing; tasting stock takes nothing from it. A thing with a part left still counts as one,
and a third tasted from a pile splits off one record beside it without merging; moves merge only equal parts.
For each name, what remains plus what was eaten, burned or paid, minus stock additions, equals what the file gave. Money plus fares never changes.
With portions the balance counts food in thirds: remaining food uses `(left ?? 3) × (n ?? 1)`, eating and
tasting use `thirds` or three times the count, and burning uses the part before the move. Stock additions
use the same units, including a third tasted from stock.
Events hold `moved` postings with source, destination and amount, `set` and `found`; eaten postings name the eater,
and only with hunger keep calories and drink. With portions, `Posting` in `src/things.ts` adds `thirds`
for a tasting or eating what is left, and `left` after tasting non-stock. `listed` in `src/journal.ts`
keeps the label of a split part; tasted lines say how much is left, without a count.
Residents receive one line from postings with names and no labels;
`told` in `src/journal.ts` leaves out a move whose two ends it names alike, such as into the doer's own pocket,
which the world's earlier-deed line keeps. The invariant checks count from these postings.

##### Search

`result` in `src/answer.ts` adds a searching deed's seconds to a time kept per person and place, across deeds and
after leaving; `sought` in `src/things.ts` reads it and says what a search finds now. The world's `search` credits
the whole deed's seconds without deed ends, and the seconds actually spent with it, so a ten-minute hidden
backpack can be found in one search or several. The request separates what this deed finds if a search from what no search finds yet; the model does not count time.
Alternatively `finds` judges a deed straight to the named spot, however short, not merely the thing's name or
another spot. Found things and contents become visible to all; only an answer finding one can move it or its
contents. Nobody is told search progress or that more is hidden. Nothing checks the model's judgement of search
or direct reach, nor that its result does not mention something still hidden.

##### Earlier deeds

`earlierOf` in `src/live.ts` and `advance` in `src/journal.ts` keep the latest 400 words of deeds in each place,
and always its newest line. A line has the result's clock, doer, deed, credited span, `Result:` words and
`In the lists:` postings, including things found, eaten, burned or changed. Each move names its label and the destination exactly as a
request names that holder, never its source (`t38 camera went to t1 long table.`, `t15 key to the shed went to
 t33 hiking jacket.`). Names alone made a weak model mistake a jacket for its owner. Entries without prose still
leave a line; neither entries nor prose leaves none. Feelings and sound next door leave none of it in that
history. [Stale-list checks](docs/measured.md#earlier-deeds-and-stale-lists) explain why these lines were added;
their effect on a whole run was not measured.

##### World retries

`runLive` in `src/live.ts` and `advance` in `src/journal.ts` require a result immediately after its deed without
deed ends, and after a stop with it; replies immediately follow addressed speech. No other record can intervene
at those points. Unreadable or cut world answers are asked once more; unreadable replies leave silence, deeds leave nothing. Retries are local to a start: a pause
at the call cap resets the two-ask count and loses the refusal explanation. Declines follow the separate stop
rule above. The doer and awake witnesses get the result on their next turns, without interruption; a sleeper
woken here learns who woke it and by what deed.

##### Sound next door

`result` in `src/answer.ts` names who hears `beyond` next door and `applied` in `src/journal.ts` writes their lines.
It gives sound, not the doer's identity unless a voice carries words. Awake people next door receive
`From <place name>, next door: <text>` and stop waiting. It reveals no deed, result, pose, move or feeling.
A named sleeper wakes with `Something from <place name>, next door, woke you: <text>`, or `… woke you.` if null,
because a weak world may fill `wakes` before `beyond`. Others asleep or travelling get nothing, nor anyone in the
deed's place, including its doer. With no neighbour, any returned sound is made null, saved and printed nowhere,
without refusal or retry. The world is told to use null then; the transcript labels it `heard next door: …`. [The sound check](docs/measured.md#sound-next-door)
did not count it separately from the other request changes.

##### Feeling during a deed

`readResult` and `result` in `src/answer.ts` read a bodily feeling and `applied` in `src/journal.ts` gives it to its
owner alone and keeps it out of the world's later history. Its transcript label is `private feeling of …`.
A deed touching another body asks for feelings of both toucher and touched; looking, listening, speaking,
watching and ordinary handling of a thing ask for none. Each text begins with what is felt, naming nobody,
since it follows `You feel:`. [Feeling checks](docs/measured.md#feelings-during-a-deed) led to narrower wording;
its separate effect was not counted. This is the first of three planned layers: feeling during a deed is built;
feeling from bodily state over time, such as an arm tired after carrying, and a body that changes are not.

##### Touches

`readTouches` and `touched` in `src/touch.ts` keep one touch per ordered pair, allowing mutual touch. With
`touch: true`, a list is required; otherwise requests and saved form stay unchanged and older journals replay.
Entries precede waking and feelings so those agree. Continuing entries name two different people here,
sleepers allowed; `kind` is `touch`, `press`, `squeeze`, `hold`, `embrace`, `rub`, `lean` or `none` to end;
`force` is `light`, `firm` or `hard`; `text` says with what body part and where on the other body, naming
neither, at most 15 words. A touch that holds needs no entry. `MAX_TOUCHES` is 8 per place. Entries run in
order; endings make room; later per pair wins. Invalid ids, kind, force, empty text, endings without a touch
and ninth beginnings are dropped. A changed kind or force restarts the touch at the result's moment; otherwise its
start stays and only the text changes. Leaving, boarding or getting out
ends touches in `applied` in `src/journal.ts`; sleep, driving and arrival keep them. Holding someone back or
keeping touch while walking together is not built.

Deed requests list `Touches that hold now:` after people, with
`- of <id> to <id>: <kind>, <force>, for <time>: <text>`, or `Touches that hold now: none.`. Time is seconds,
whole minutes from two minutes; figure replies omit them. `runLive` in `src/live.ts` shows participants, under
their poses, `You touch <name> (<kind>, <force>, for <time>): <text>` or `<name> touches you (…): <text>`;
awake witnesses here see only `<name> touches <name> (<kind>): <text>` after other people. Nobody elsewhere
sees it. Residents are told no renewal is needed; a deed lets go or leaving ends it. Result records and events
keep `touches`; transcripts say `touch of … on …`. Leaving adds no touch entry; the next turn lacks it. Touch
adds no memory line; result and feeling tell its beginning.
[The body port check](docs/measured.md#body-mechanisms-on-the-main-line) left the story effect unmeasured.

##### Lasting feelings

`readLingers`, `marked` and `marksAt` in `src/marks.ts` keep a person's feeling per zone and kind.
With marks on, `lingers` is required; without it the request and saved form stay unchanged. It uses the initial
mark's fields plus `of`, a person here, `minutes`, null or a whole number from 1 to 1440, and `level` also allows
`none`. Text has 15 words; none needs no text. Null lasts indefinitely; a number lasts that many minutes after
the deed's intended end without deed ends, or its result's moment with it, then restores what was there,
including an older temporary layer. Up to 3 layers (`MAX_LAYERS`) keep relief or worsening; layers expiring before the new one are dropped. A change to a part already feeling
something needs an entry, such as cream on a burn, cold water, a muscle rub or a blow on a bruise.
Invalid person, zone, kind, level, minutes, empty text except none, ending a missing mark, a fourth layer or a
seventh mark is dropped. Later entry per person, zone and kind wins. No entry leaves it unchanged; only entries
and time change it, and it follows its owner asleep or awake.

Expiry writes no record. Entries stay in result records and events; transcript lines are
`private lasting feeling of …`. A turn gives only its owner `Your <zone> (<kind>, <level>): <text>` after sleep
debt, `Your whole body` for body, no time or temporarily absent mark, and no memory line. The deed request has
`Feelings that last now:` after people and touches, with `- of <id>, <zone>: <kind>, <level>, for <time>: <text>` and `, <time> left` when temporary,
or `Feelings that last now: none.`. Times are seconds, whole minutes from two minutes, whole hours from two hours. An unchanged
initial mark has no `for <time>`; temporarily gone is none with no text. Figure replies omit it. The name `lingers`
avoids confusion with the marks after things in the world's notation. [The body port check](docs/measured.md#body-mechanisms-on-the-main-line) left the story effect unmeasured.

##### Traces

`marked`, `retraced` and `refusal` in `src/answer.ts` keep traces on people, independent of looks and pose.
The labels `m1`, `m2` and on follow file order and are never reused. The world reads `Traces: m1 …; m2 …` or
`Traces: none`; residents read only `On you: …` or `On them: …` after looks and pose, without labels, as they are
now. Past lines never retell appearances. Deeds alone leave or wipe traces; a figure answer has neither field.
Wipes precede additions; unknown person, empty text or unknown local label is dropped, a duplicate text is passed
over, and a ninth trace refuses the whole answer with a retry, like a thirty-first carried record. Both lists
are required. Records keep them and events `traced` and `wiped` with owner, label and text; earlier-deed lines
name traces left or removed. Optional instructions and schema sentences appear only when traces are on.
[The first trace checks](docs/measured.md#traces-first-checks) were on an earlier engine, and
[the example comparison](docs/measured.md#traces-unchanged-examples) checked unchanged worlds without the setting.
Trace state survives continuation; formats are listed with the files above. Traces on things or places, clothing
or pose hiding them, and fading with time are not built: a wet sleeve stays wet until a deed dries it.

##### Ways by deeds

`waysOf` in `src/action.ts` and `wayDue` in `src/journal.ts` let a deed begin the journey of a `go`. Without ways,
the world is told to leave doers here by the way out. Poses never name another place. With ways, `leads` names here or an
allowed id, even when travel outlasts the deed. Only the doer goes; results say only what happens here before
leaving. Unlisted parts, upstairs rooms, yards or steps towards doors stay here. The schema lists available
ways and told refusals, full, fare, driver, reach or round, including standing vehicles and this vehicle's
stop. The other-place line is ``Other places, which a deed reaches only through `leads`: ...``, replacing
`Other places, which nobody reaches by a deed: ...`. The last sentence names here and any standing vehicle:
``What comes of it? This place is `cafe`, and `leads` is `cafe` unless the deed is the way to another place or into a vehicle that stands here.``
Inside, `This vehicle stands at ...` gives the stop's id. This avoids mistaking similar names for neighbours'
ids. [The six wordings](docs/measured.md#ways-by-deeds) tested mistaken departures and missed ways; their
limits stay with that entry.

`worldInstructionsOf`, `worldTextOf` and `WORLD_INSTRUCTIONS` in `src/live.ts` give the exact texts with and
without ways. Only the world's fourth instruction paragraph, first-field point, other-place line and last
request sentence change; residents and figure requests do not. Result records and events keep the way as `goes`,
another place id or null, whatever the answer's field is called. `result` in `src/answer.ts` drops the doer's
pose for a named way; other entries work normally. At the doer's next free moment after the result, the rules
check and take that `go` without asking a model. Travel, notices, seats, drivers, fares and touch endings use ordinary `go` rules. A refusal leaves the deed as it was and takes the ordinary
thirty-second wait and refusal sentence; either way the pending way is used up. Clock laws and vehicle arrivals
precede it.
Action records and events have `fromDeed`, the result's sequence number, and null `by`. Rebuilding from
results preserves pauses before departure or during travel. Without ways, requests, records, events, stored
rows and format stay unchanged.

A world file with `stableFirst: true` uses `known` in `src/live.ts` to append a resident's memory and
closed blocks of 40 recent lines to the instructions, for turns and memory rewrites. The remaining lines and
the turn's changing end or the rewrite's question stay in one user message. This is for a provider whose cache
follows the instructions: their beginning stays whole and grows by a block until the next rewrite.

A world file with `fixedSchema: true` keeps the deed and figure reply schemas fixed for its run. The values
allowed now come last in the request text; `allowedOf` and `allowedTextOf` in `src/live.ts` list them, and
`allowedIn` in `src/answer.ts` rejects an answer outside them before anything happens, with the ordinary retry.
Without the setting, requests, records, events, stored rows and format stay unchanged.

##### Clock laws

`Law`, `LAWS` and `beginLaws` in `src/laws.ts` give a clock law its settings and checks, state, due record,
turn line and request-size bound. Weather also supplies the world's line; sleep supplies how someone looks and
updates debt on sleep and waking; hunger updates counts from eating and sleep. Core laws have no model or disk
access.

##### Sleep debt

`sleep` in `src/sleep.ts` grows debt while awake, including travel, and reduces it twice as fast in sleep,
never below zero, beginning at time since `dayStart`. The count is not told. Its four bodily steps are rested,
awake a long while from half `tiredHours`, tired from that threshold, and hardly able to stay awake in the last
quarter to `spentHours`. From tired on the owner is warned it will fall asleep where it is, and tiredness shows
to others here. At the limit sleep replaces a turn, where the
person is, for eight hours; it is an engine record, no model asked, witnessed as falling asleep.

##### Hunger and thirst

`hunger` in `src/hunger.ts` accounts only for the doer's accepted `eaten` postings, never words or a figure's
answer. With `portions` it also counts `tasted`: a third gives a third of the calories and drink time;
eating a remaining part gives its remaining thirds. A part of a food whose whole has at least 100 calories
also lifts a negative fed count to zero. Everyone begins fed for 3 hours and not thirsty for 2. Both fall by a second per waking second, half per
sleeping second, below zero when needed. A deed's calories count together: at least 100 first lifts a negative
count to zero; each calorie then adds 36 seconds, up to 10 hours. Smaller meals add time without that lift.
Thus an awake hour uses 100 calories, 600 holds 6 hours from zero or less, and 400 after waking hungry holds 4.
Water with zero calories feeds nobody; each drink first lifts negative thirst to zero and adds 3 hours up to 6;
a drink with calories feeds too. Effects begin at the result's recorded moment and replay from the journal;
this law writes no record of its own. [The hunger checks](docs/measured.md#hunger-and-thirst) explain why a fine
body adds no line: a resident used `You are not hungry.` to refuse an agreed supper.

Only its owner's turn receives the line after sleep debt. At zero to above minus 2 hours it says
`You are getting hungry.`, from minus 2 to above minus 8 `You are hungry.`, at minus 8 or below
`You are very hungry and feel weak.` Thirst at zero to above minus 6 says `You are thirsty.`, below that
`You are very thirsty.` Both sentences share one line with one space; above zero there is no sentence or line.
These are the only new model texts; world and figures are asked as before, and others never learn these counts.

##### Weather

`weather` in `src/weather.ts` says which change is due and what it does; `runLive` in `src/live.ts` and `applied`
in `src/journal.ts` put it before actions, without a model request, and replay refuses a wrong or undue change.
Awake people in open places receive its text and end their waits, those under a roof do so only with indoors
text. Travellers and sleepers get nothing and are not told later. Turns give the local
text; the world always gets weather and roof or sky, with instructions to mention weather only when a deed
meets it. Nothing checks that instruction. Seeded weather is replayable and does not repeat a state consecutively.

##### Folding memory

A world file with `oneSchema: true` uses the turn schema with `memory` first, a string or null, for both
turns and rewrites. `schemaOf` and `residentInstructionsOf` in `src/live.ts` give both requests the same
schema and fixed instructions; `known` puts memory before perceived lines in both. A turn requires null
memory; a rewrite writes it, sets `action` to `wait` and the rest to null, and only its memory is read.
`readTurn` in `src/live.ts` and `readMemory` in `src/memory.ts` reject the wrong form with the existing retry.
Records keep their form. Without the setting, requests and stored rows stay unchanged.

`oldest`, `rewrite` and `idle` in `src/memory.ts` keep short memory as perceived lines with local times, own
actions and notes, and delivered waiting calls. On waking, everything before sleep is folded; waking and calls
start new lines. Sleep and waking alone since the last rewrite need no request. Before a turn over `shortWords`,
the oldest lines fold until about half remains. Long memory is the character's own summary of its old memory
and folded lines; omissions are forgotten and overlong text loses its end. `rewriteOf` in `src/live.ts` asks
for about 85% of the limit, beginning with wants and changes, then lasting obligations, promises, sums, times,
locations and knowledge of people, retaining the names and figures in the lines. Passing chores, small talk and
trivial prices go last or are omitted, so a cut loses least. It asks for sentences, no numbered list, sums and
times in figures, past tense without current location, and no deed result without one in the lines.

##### Guarding a rewrite

`readMemory` and `sameScript` in `src/memory.ts` guard a rewrite without judging its truth.
It ends before the first `}`, trims spaces before it and marks a cut; nothing before it is unusable.
[The ending check](docs/measured.md#memory-endings) saw continuations inside the string and noise.
An unreadable rewrite gets one retry; after two the old memory stays but folded lines are lost, counted as `lost`.
A readable first answer in another script is set aside and retried only when a sheet has at least 20 letters,
at least four fifths in one script, and the cut answer has at least 10 letters with fewer than half in that script.
It counts unusable, but a failed, cut or declined retry, or a stop before retry, saves the first; a readable second
is kept unchecked, also after an unreadable first. The guard can cost one request and never a memory.
Only letters count, and letters of any script count towards these sizes and shares; the scripts told apart are
Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and Han/Hiragana/Katakana/Hangul together. A tie or
unclear sheet disables it; names and a few foreign words can stay, while a language with two scripts follows the
sheet. [This guard has stand-in checks](docs/measured.md#memory-script-guard), no model measurement.
`requestLimit` in `src/live.ts` bounds requests by the world file, however long the story runs, using the text limits.

##### The journal

`Record`, `advance` and `replay` in `src/journal.ts` make the append-only records the world's only state.
Actions or their refusal reasons, results, replies, arrivals, waking, sleep at the limit, weather and rewrites
are records, each with its derived event. With deed ends, a stopping action is an action record whose event is
`stop`; a result event holds `ofDeed`, the deed's record number, and `worked` and `planned`, seconds spent and
seconds chosen. An unanswered start remains pending when the run pauses. A drive records driver, vehicle,
departure, destination and arrival, with one engine arrival record. Every journal prefix rebuilds a whole world through the same rules that play it.
`LAWS` in `src/invariants.test.ts` gives each invariant in one sentence; `npm test` plays thirty characters for
thousands of steps with answers of every kind, checking laws from the journal alone, naming law and record on failure.

`npm run bench` uses an immediate stand-in in a synthetic town and prints step costs and request sizes;
`node src/bench.ts 1000 100 50` means 1000 characters, 100 places and 50 calls each.

#### What it lacks

- There is no author above the characters; the world answers deeds and does nothing of its own accord.
- Counts are checked, but whether a deed should move a thing is the model's reading. Words can say a jacket was
  hung up while lists keep it on its owner. No check compares prose and moves; immutable facts do not adapt.
- Earlier-deed lines are history, not current location. A carrier leaving or a figure moving a thing writes no
  deed line; old prose can still name it. The lists are the truth, and the world is told so.
- Speech never passes a door, however loud. Calling through it needs a deed, and an answer another deed.
  Every neighbour hears the same `beyond`, the doer is not told who heard it, and hearing is the model's judgement.
- Doors have no open, shut or bolted state. Description is all the world knows, every `go` passes, and sound does
  not depend on doors. There is no shop or manufacture, or taking, giving and eating without the world. Prices serve only a figure's
  answer: deeds do not pay, a resident who sells has no payment rule, and nothing in a vehicle or on a person is priced.
- Walking is at one pace for everyone, whatever terrain or tiredness. Without `legMinutes` it cannot be interrupted
  and perceives nothing. Walkers receive no later weather notices between turns. Carried things go along regardless of size.
  A resident names a thing in words, and the world must find its label.
- A handed-over, lost or stopped watch still tells its original owner time; a removed place clock stays there.
  Seconds are exact for all; an early-woken sleeper is not told by how much. Tiredness is one count, changes no
  ability before its limit, and a traveller falls asleep only on its turn after arrival.
- Figures have no private memory, hear no resident-to-resident speech, and share only local figure dialogue
  history plus their facts. A crowd cannot answer. Only a deed or addressed figure speech asks the world;
  claims in speech or notes are unchecked.
- Nothing checks invented facts in a memory summary. The character cannot retrieve what it forgot from the
  journal. Waiting calls have no count limit; repeated rewrites fold the oldest before the next turn if needed.
- The journal cannot branch. A checkpoint fork needs a copy of its prefix. The project's checks ask stand-ins alone.

#### What comes next for the live world

1. What things still lack: food tags, a shop, payment for deeds or a resident who sells, prices in vehicles or
   on people, things made of other things, and residents who take,
   give and eat without the world.
2. A larger seaside world than `examples/seaside-cafe.json`: four residents, houses, a sports pool, beach and cafés.
3. An energy balance: hunger from daily shortfall, weight and fitness over weeks.
4. `examine` answered by an engine table, more detailed with a doctor's skill; skills in the world file, injury,
   illness and a person's reactions to kinds of food.
5. Ordinary days with no model calls.
6. Then training, learning a skill, a farm and ecology.

### A judge of a live run

`runEval` and `readQuestions` in `src/eval.ts` hold the judge and its questions; `readState` in `src/state.ts` reads its journal.

```sh
sagents eval <dir> --model <id> --ask <questions.json> [--calls <n>] [--window <words>] [--out <file>]
sagents eval --state <file> --world <world.json> --model <id> --ask <questions.json> [--calls <n>] [--window <words>] [--out <file>]
```

`eval` gives one finished live journal to a model as a judge: the `world.json` and `state.sqlite` of a directory
that `live --run` made, or a state file and a world file named apart, opened for reading only. The model name
chooses the connection as in `live`, and every request counts toward `--calls`, 60 by default. The questions file
names the task and the kinds of finding, as [examples/eval-questions.json](examples/eval-questions.json) does; a
finding is kept only when its quote stands in a record that it names. Past `--window` words, 6,000 by default, the
oldest answers leave the judge's view. One JSON report goes to stdout, or to `--out`, which must name a file that
does not exist. `instructionsOf` in `src/eval.ts` joins the judge's rules. Without deed ends it gives `INSTRUCTIONS`;
with them it says that interruptions give the doer a turn while the deed goes on, and waking takes effect at
the result's moment. It adds `DEED_ENDS_INSTRUCTIONS` for starts, later results, stops, waits to the deed's end,
refused answers and falling asleep at the limit of being awake.
[docs/judge.md](docs/judge.md) says the rest: what is read, what the judge is told, its tools, how
quotes are compared and findings taken back, the limits and the report.

### Numbers of kept runs

`numbersOf`, `numbersTable` and `numbersJSON` in `src/numbers.ts` hold the counts and the two outputs.

```sh
sagents numbers <dir>... [--json]
```

`numbers` reads directories kept by `live --run` and prints one table, a column under each directory's name.
It joins every stretch in numbered order, asks no model, sends nothing and writes nothing; SQLite is never
opened. `--json` gives one object keyed by those names, with the same row names and numbers, and null for `-`.
Repeated directory names get ` (2)`, ` (3)` and so on. A directory that is not a kept run is named on standard
error; the others are still printed, and the command ends with a code that is not 0.

The rows are:

- Requests, all and by the kinds of the usage rows, in their first appearance's order.
- Story minutes from the first event to the end of the last, and story minutes for 100 requests, both to one
  decimal.
- Actions of residents, all and by kind: `say`, `call`, `go`, `do`, `wait`, `sleep`. Driving counts as going.
  With deed ends a `stop` counts too and has its own `actions: stop` row.
- Actions that led somewhere, and their share of all actions as a whole percent: a speech or call somebody
  heard, a going that set out, or a deed with a result. Waiting, sleeping and stopping never count.
- Deeds without a result and their share of deeds as a whole percent, the longest row of them by one resident,
  and how many rows of two or more there were. A result has null text, nothing moved, set or found, and is no
  search for the deed to count as without a result. Another action of that resident or a deed with a result
  ends its row, including a `stop` with deed ends; another resident's action does not.
- Deeds cut short, only when result events carry `planned`; these have `worked` below `planned`.
- Places residents were in, including their starting places and door crossings, and how many the world has,
  including vehicles. Setting out alone does not count the destination as visited.
- Input tokens, cached input tokens and their share of input as a whole percent, output tokens, and mean input
  tokens per request as a whole number, all and for each run's two commonest kinds. A tie keeps the first
  appearance's order.
- Answers that could not be used, memory rewrites lost, and answers of the world refused by the rules, when
  the files hold them. Null text in a memory event counts a lost rewrite. The other two need `invalid` and
  `refused` in one total row without `kind` in each stretch's usage file; `live --run` does not write those totals.

Nothing is estimated: `-` means a missing number. A gap in the numbered stretches leaves their totals unknown.
Missing, unreadable, unfinished or damaged event files leave
the event counts unknown. Without deed ends, a deed at the very end, cut before its result, is left out of the
deed counts and of the two shares; any other deed without its following result leaves those counts unknown.
With deed ends, results pair by `ofDeed` when it names a start in the joined events, otherwise by the doer, who
has at most one deed going. Starts still going at the end are left out of the same counts and shares. Missing
counted result fields leave the deed counts and actions that led somewhere unknown. Missing or damaged usage
files leave requests and tokens unknown. A token total or mean is missing when any request in it has no count, including a failed
request; a zero denominator leaves a rate or share missing. A mean for a kind outside a run's two commonest is
missing in that column. A run with only its state file has no event or request counts here. To give those numbers
without opening SQLite it would need the kept event and usage files too. These numbers compare what a change of
wording or a rule did before a transcript is read; they cannot judge a scene, and a quiet good scene counts as
standing still.

### The lab

`startLab` in `lab/server.ts` serves the files read by `openLab` in `lab/data.ts`.

```sh
sagents lab [<dir>...] [--port <n>] [--lang <en|ru>] [--no-open]
export SAGENTS_LAB=~/runs:~/more-runs    # the folders `sagents lab` reads when it is given none
export SAGENTS_LAB_LANG=ru               # the page's language when `--lang` is not given
```

`lab` shows in a browser the experiments that lie under the directories it is given: under those that `SAGENTS_LAB`
names, separated as in `PATH`, when it is given none, and under the current directory when that is not set either.
It asks no model and writes nothing into those directories. It prints its address, which is on this computer only,
and asks the system opener to open it in the default browser unless `--no-open` is given. The usual address is `http://127.0.0.1:4747/`;
when that port is taken and no port was asked for, it takes a free one and says so. `--port` asks for a whole number
from 0 to 65535; 0 lets the system choose. Ctrl+C stops it.

The browser gets the data key after `#` in the first address, keeps it in its origin's storage and removes it from
the address. When the system opener exits successfully, the printed address has no key. With `--no-open` or when
that command cannot start or exits unsuccessfully, it prints the first address with the key; open it once in the browser you read in.

The page is in English or in Russian: in the language that `--lang` names, or `SAGENTS_LAB_LANG` when the flag is
not given, or else the language it remembers, and with none in Russian for a browser set to Russian and in English
for any other. Any other flag or environment value is refused. The chosen language goes in the first address as
`?language=ru`; the page remembers it and removes it from the address. Its RU or EN button changes that choice.

[docs/lab.md](docs/lab.md) says the rest: which files make an experiment, what the page shows, the map, and what
of a world file may leave the lab.

## The model connection

There are two; `modelFor` in `src/model.ts` chooses by the model name. Neither tries a request a second
time: a failure comes back as a code, and the caller decides.

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
- [Naming one router endpoint can help its cache](docs/measured.md#router-cache).
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
  `session-id` and `x-client-request-id`. [The cache check](docs/measured.md#plan-cache) compared requests with and without these names. A request with no name has none of the three.
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

## Development

```sh
npm test                        # no install and no network
npm install && npm run check    # the type check
npm run size                    # token counts and the core's comment share
npm run pointers                # check the README and docs after a rename
```

`npm run size` counts tokens (`o200k_base`) of three things: the core of the live mode without model and disk
(`src/world.ts`, `time.ts`, `action.ts`, `answer.ts`, `things.ts`, `journal.ts`, `laws.ts`, `sleep.ts`, `weather.ts`, `memory.ts`, `reading.ts`, `touch.ts`, `marks.ts`), `src/live.ts`, and
all tracked text except `LICENSE` and `package-lock.json`. It reads the working tree, or the Git index with
`npm run size -- --index`. The core is meant to stay small enough to read whole, and its count falls into one of four bands,
around the owner's mark of 70,000 tokens, which is there to steer by: up to 56,000 tokens, four fifths of the mark,
the number is printed and nothing else; from there to 70,000 a
note says that the core is nearing its size; from there to 84,000, six fifths of the mark, a warning says that it is over, and that a change
which adds to the core says what it takes out or why the size should rise; above 84,000 a strong warning says that
the core no longer reads whole and should be split or cut before more is added. The script ends well in every band:
it forbids nothing. One more line gives the comment tokens, total tokens and whole-percent comment share of the
core and `src/live.ts`, with a bound of 10 percent for the core. A comment is a whole line whose first characters
after indentation are `//`; its token count is the file's count less the count without those lines, summed across
the core's files. Above the comment bound a note asks for a look at comments that retell the code, while keeping
reasons; it forbids nothing. Tests are counted against nothing. The list of core files, the three size bounds and
the comment bound are at the top of `scripts/size.py`. The count needs the Python package `tiktoken`,
which is no dependency of this project: name a Python that has it in `SAGENTS_SIZE_PYTHON`.
Without `tiktoken` the script says how to get it, counts nothing and ends well. `SAGENTS_SIZE_AGAIN` is its
internal guard against entering that Python twice, not a user setting. It is not part of `npm test`. A change that grows the core says by how many tokens.

## License

MIT
