# sagents

Story agents. A coding agent gets a shell and a patch tool and works in a repository. A story agent gets an interactive
story: its scenes, the moves that continue it, its checkpoints and its memory. sagents is the program that runs them.

It is early. Today sagents sends one request to a model, to a server that speaks the OpenAI chat completions protocol
or through a ChatGPT plan, runs a first prototype of the live mode, and has a judge read a finished live journal.
For the live world, [what comes next](#what-comes-next-for-the-live-world) is listed below. This page keeps what works
and what is planned apart.

## A first run

sagents needs Node 24.9 or newer.

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

sagents needs Node 24.9 or newer and nothing else. It has no dependencies. From npm, `npm install -g sagents` makes
`sagents` a command of this computer: the same command line as JavaScript with the types erased, with the example
worlds in the package's `examples` folder. In a checkout of this repository Node runs the TypeScript as it is:
`node src/cli.ts` takes the same arguments, and `npm link`, run once there, makes `sagents` a link to `src/cli.ts`,
so the command is always the checkout as it stands. `"private": true` in the checkout's `package.json` guards against
publishing the checkout itself by mistake: the package is the folder that `npm run pack` builds from a commit.
`sagents help` lists the arguments. `sagents --help` and `sagents -h` give the same text.

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
and figure replies use the world's description's language; with `language`, all four are told to use that language. [The example checks](docs/measured.md#translated-examples) cover
these translations; every other measurement here used the Russian texts.

- [The world file](docs/world-file.md): What fields and settings does a world use?
- [The live commands](docs/live.md): How does a run start, stop and continue?
- [The requests](docs/requests.md): What is each model sent, and what does it answer?
- [The mechanisms](docs/mechanisms.md): How do the rules keep time, things and memory?

#### What it lacks

The live world has no author above the characters, and
[what the live world lacks](docs/mechanisms.md#what-the-live-world-lacks) lists the rest.

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

### An evolutionary search

`runEvolve` in `src/evolve.ts` holds the loop and the archive; `keepEvolve` in `src/evolve-kept.ts` keeps its directory.

```sh
sagents evolve <dir> --task <task.json> --model <id> [--model <id>...] --calls <n> [--parallel <k>] [--tries <t>] [--timeout <s>]
sagents evolve-map <dir> > map.html
```

`evolve` lets a model, or several in turn, improve one text file against an evaluator command that the task file
names, in fresh requests, and keeps every file it evaluated with an archive of the best valid file of each cell of
the evaluator's numbers. Nothing in it knows what the file is: a program, a world file or any other text.
`evolve-map` draws a run, its families, its cells, its models and every file against its parent, as one page that
loads nothing. `evolve` runs on Linux and macOS, where an evaluator is stopped with its process group.

- [An evolutionary search](docs/evolve.md): What is in the task file, what does a step send, what is kept, and what
  does the map show?

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

`lab` shows in a browser the experiments that lie under the directories it is given, asks no model and writes
nothing into those directories. [docs/lab.md](docs/lab.md) says the rest: the folders it reads and its address,
the key in that address, the page's language, which files make an experiment, what the page shows, the map, and
what of a world file may leave the lab.

## The model connection

- [The model connection](docs/connection.md): How is a server or a ChatGPT plan used?

## Development

```sh
npm test                        # no install and no network
npm install && npm run check    # the type check
npm run size                    # token counts and the core's comment share
npm run pointers                # check the README and docs after a rename
```

`npm run size` counts tokens of the core of the live mode, of `src/live.ts` and of all tracked text, and the comment
share of the core. [docs/development.md](docs/development.md#npm-run-size) says what it counts, its bands and what it
needs.

## License

MIT
