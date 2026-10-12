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
show those failures. The [live command reference](docs/live.md#the-commands-and-a-run) gives the limits and defaults;
[the connection reference](docs/connection.md#a-server-of-your-own) gives the server settings and what is sent.

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

- [One request](docs/ask.md): What does `ask` read and return?

### A live world

`live` reads a world file and has a model play each of its characters, one request and one action per turn.
The world answers deeds and speaks for named people whom nobody plays. The rules keep time, things and memory.
`examples/night-station.json` is one evening; `examples/night-pass.json` is an evening, a night and a morning,
where memory after the night matters; `examples/seaside-cafe.json` is a café with a crowd and a waitress in a
mapped town. They are synthetic and in English, translated from Russian. The instructions are in English. Residents and memory rewrites use the sheet's language; world results
and figure replies use the world's description's language. [The example checks](docs/measured.md#translated-examples) cover
these translations; every other measurement here used the Russian texts.

- [The world file](docs/world-file.md): What fields and settings does a world use?
- [The live commands](docs/live.md): How does a run start, stop and continue?
- [The requests](docs/requests.md): What is each model sent, and what does it answer?
- [The mechanisms](docs/mechanisms.md): How do the rules keep time, things and memory?

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

- [Numbers of kept runs](docs/measured.md#numbers-of-kept-runs): What does `numbers` count, and when is a count unknown?

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

- [The model connection](docs/connection.md): How is a server or a ChatGPT plan used?

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
