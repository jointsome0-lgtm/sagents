# Live command reference

The live command, its limits and its saved files are here.
[The world file](world-file.md) supplies the world; [the requests](requests.md) say what models receive.

## The commands and a run

```sh
sagents live examples/night-station.json [--model <id>] [--cast <character>=<id>]... [--world-model <id>] \
  [--minutes <n>] [--calls <n>] [--tokens <n>] [--state <file> | --run <dir>] [--environment <name>] [--json]
```

`argumentsOf` in `src/cli.ts` reads the flags. A bad world or option fails before asking a model.

| Flag | Default, bounds and effect |
| --- | --- |
| `--model <id>` | `gpt-6.1-sol@low` of the ChatGPT plan. Plays residents not named in the cast. `--model api:<id>` uses [your server](connection.md#a-server-of-your-own). |
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
One more exception is yours to allow. With [`SAGENTS_API_AGAIN=1`](connection.md#a-server-of-your-own), a request
to a server whose connection fails with a transport code before any response is sent once more after two seconds,
only without `--tokens` and with room under `--calls`. The server may have received the first request all the same
and may charge for both, so nothing is sent again unless you set it. The failed request stays counted as a call
with unreported spending; the second send is another call of the same purpose and owner, with the same request.
This rule sends no third: the second's answer or failure is handled as any other, and the two tries of a world
answer or a rewrite still hold. Stopping the run during the wait sends nothing more. A status refusal or a failure
after any response is never sent again by this rule.
The library's `againMs` option of `runLive()` sets the wait in milliseconds, 2000 by default, with no CLI flag.
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
as `declined` are in the [table of reasons](ask.md#one-request).

In text output each event has a line with clock, place, who and what. Further lines show found, moved and changed
things, poses, touches, private feelings, lasting feelings, traces left or wiped, sound next door, words with a
deed and a private note. A gesture stands in brackets before speech. A wait without a note prints nothing.
A turn on the way has the way, its direction and the minutes still ahead in place of a place.
A rewrite is shown whole, across all its lines, marked private like a note. `linesOf` in `src/live.ts` holds this
transcript. The totals give status and reason; HTTP status, provider code and field name when present, never the
service's words (`failed (provider_failed 502 bad_gateway)`; `httpStatus`, `providerCode` and `param` in JSON).
`provider_failed` without a status means the service could not be reached. A failed run exits with code 1.

The totals count story minutes, calls, `invalid`, `overlong` cuts, `declined`, memory `rewrites` and `lost`,
memories `dropped` from turns, requests sent `again` after a connection failure, world answers `refused`, world
answers taken `unmoved` (without moves that twice moved nothing), deeds and speeches left `void`, input tokens,
`cachedInputTokens` and output tokens.
`Outcome` in `src/live.ts` also counts each untaken resident turn, world answer and figure reply by cause in
`causes.turn`, `causes.world` and `causes.reply`, with only causes that occurred. A turn's cause is the word of
`REFUSALS` in `src/action.ts` that its `act` record holds; a final service decline with no record also counts as
`declined`. JSON totals include `causes` and `dropped`; text leaves the closing line unchanged and adds
`not taken: turn json 5, here 1; world to 4, sink 5; reply what 2` when any occurred, with kinds in that order
and causes in the order of `UNTAKEN_CAUSES` in `src/live.ts`. When any request was sent again, text also adds
`sent again after a connection that failed before any response: 3`; JSON totals hold the count in `again`.
In the same way text adds `answers of the world taken without moves that moved nothing: 2` and JSON holds
`unmoved`.
They sum only reported usage: `unreported` counts answers without usage and requests that failed with a `ModelError`,
rather than calling their spending zero; an absent cached count adds nothing. `kinds` divides requests and tokens into turns, rewrites and world answers,
including figure replies and retries. Text prints one line for each kind. `models` also divides calls, unusable
answers and tokens by model name, with text lines when several models played. Endpoint names can add that line
for a single model too, as [the connection](connection.md#a-server-of-your-own) says.
Each journal entry's `by` is the model name, or null for an engine record; JSON events print it. The rules do not
read it: records give the same world whoever answered. Every perception goes to the service playing its owner.

### Files and continuation

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
| `language` | `50` |
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

`keepRun` in `src/kept.ts` keeps `--run` as files the [lab](../README.md#the-lab) reads:

| File | Contents |
| --- | --- |
| `world.json` | The world file as given. A directory with another world file is refused. |
| `state.sqlite` | The state described above. |
| `part<N>.events.jsonl` | One event per line for that start, beginning with `part1`, then `part2` and so on. |
| `usage-part<N>.jsonl` | One row per request: when sent, purpose (`turn`, `memory`, `world`, `reply`), owner, model, milliseconds, reported input, cached, written, output and reasoning tokens, and failure code `error`. A failure keeps `status` when it has an HTTP status; `stage` is `connect` before a response or `stream` after one, and on the plan a decline keeps `refusal` as `event`, `filter` or `part`. A second try within the plan connection keeps `tries: 2`, even on success; these fields are absent otherwise. A play's second send to a server has its own row. No request, answer, failure text or service code. |
| `untaken-part<N>.jsonl` | One row per untaken resident turn, world answer or figure reply, after judgment: `n` names its usage row, `kind` is `turn`, `world` or `reply`, and `cause` is the code counted above. Empty when every answer was taken. With `--untaken-text` only, also the rule's refused `entry` when there is one and the model's `answer` when there was text; a turn has no `entry`, and a cut or decline has no `answer`. This file then holds model words like the events file. Use the option only for worlds whose text may be kept. |
| `about.txt` | Your description of the experiment, when you add one; the lab shows it. |

A second start adds the next stretch. Files are made only where absent, lines only appended; nothing is
overwritten or shortened. The state event is saved before the event line, so a killed run can have it in its
world but absent from that stretch. The state does not keep earlier starts' totals. Node warns that SQLite is
experimental.

