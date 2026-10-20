# AGENTS.md

Orientation for AI coding assistants and people working in this project. Keep it short and true.

## Secrets and private text

- Do not open `~/.config/sagents/chatgpt.json`. It holds tokens. When you need a fact about it, run
  `node src/cli.ts status`. It prints whether this computer is signed in, whether plan use is allowed and how many
  minutes the access token has left. For a signed-in account it also asks OpenAI for the models, which can renew the
  tokens.
- The owner signs in. An assistant does not run `login` for them and does not type credentials anywhere.
- The key of a chat completions server comes from the environment (`SAGENTS_API_KEY`) and is never printed, logged,
  written to a file or put into an error. Do not open `.env*` files or print the environment. A request to a real
  server costs the owner money: an assistant sends one only when the owner asked for that request.
- Never print or log service tokens or keys, request text or the service's error text. A model's answer goes where its caller asked
  for it and nowhere else: `ask` prints it on stdout. A failure is a code in `ModelError`, with the service's own code
  and field name only when they are plain identifiers. A sign-in problem is one of this project's own sentences in
  `SignInError`.
- Tests and examples use synthetic stories.
- When the plan's limit or the key's balance is reached (`budget_exceeded`), stop. Do not look for another way to pay or to raise it.

## Publishing

A push needs the owner's word each time.

The npm package is the folder `pack/`, which `npm run pack` builds (`scripts/pack.mjs`): Node strips no types under
`node_modules`, so the package holds JavaScript, and its own manifest has no `"private"`. It is built from the
commit that is checked out and not from the working files: what is not committed does not reach the package, and a
build that fails removes `pack/` or says not to publish it.
The owner publishes it with `npm run pack && npm publish ./pack`, so that the folder is never an older build; the
`./` is needed, since npm reads a bare `pack` as the package of that name on the registry. An assistant never runs
`npm publish` or `npm login`. The root manifest keeps `"private": true`, so that a publish of the checkout itself is
refused.

## What this is

sagents runs story agents: models with tools for an interactive story where a coding agent has tools for a repository.
[README.md](README.md) says what is written and what is only planned, with the long accounts of
one request in [docs/ask.md](docs/ask.md), the world file in [docs/world-file.md](docs/world-file.md),
the live commands in [docs/live.md](docs/live.md), the requests in [docs/requests.md](docs/requests.md),
the mechanisms in [docs/mechanisms.md](docs/mechanisms.md), the model connection in [docs/connection.md](docs/connection.md),
the judge in [docs/judge.md](docs/judge.md), the lab in [docs/lab.md](docs/lab.md), what was measured in
[docs/measured.md](docs/measured.md) and `npm run size` in [docs/development.md](docs/development.md). These pages
point at code by a symbol and its file.
`npm run pointers` checks that every pointer still names a top-level declaration of its file. Run it after a rename.

Today the code is the two model connections, the choice between them, a prototype of the live mode and the command
line:

| File | What it is responsible for |
| --- | --- |
| `src/chatgpt.ts` | The model connection for a ChatGPT plan. |
| `src/compatible.ts` | The model connection for a chat completions server. |
| `src/model.ts` | The choice between the two connections by the model's name. |
| `src/cli.ts` | The command line. It reads the world file and its environment from `environments/`. |
| `src/world.ts` | Live mode: the world file and what a run holds. |
| `src/time.ts` | Live mode: the clock and the distances. |
| `src/action.ts` | Live mode: what a resident does. |
| `src/answer.ts` | Live mode: what the world answers to a deed. |
| `src/things.ts` | Live mode: the things that the rules count and move. |
| `src/touch.ts` | Live mode: the touches between two people that a world file with `touch` keeps. |
| `src/marks.ts` | Live mode: the lasting feelings of a part of a body that a world file with `marks` keeps. |
| `src/reading.ts` | Live mode: the checks a world file is read with. |
| `src/laws.ts`, `src/sleep.ts`, `src/weather.ts` | Live mode: the form of a law that the clock drives in `laws.ts`, with `sleep.ts` and `weather.ts` in that form. |
| `src/memory.ts` | Live mode: what a character remembers. |
| `src/journal.ts` | Live mode: the records that are its only state. |
| `src/state.ts` | Live mode: the file that keeps the records. |
| `src/live.ts` | Live mode: the run and the prompts. |
| `src/eval.ts` | Reads a saved journal with log, show and diff for a judge, checks quotes by their words and keeps its report with findings and bounded refusal details, with no disk access. |
| `src/numbers.ts` | Counts the story's time, actions and requests from kept event and usage files, with no model and no writes; it uses the lab's file reader and never opens SQLite. |
| `src/kept.ts` | Beside the live mode, writes the directory of `live --run`: it only makes files where there are none and adds lines to them. |
| `lab/data.ts` | The lab, `sagents lab`: reads the experiments under the directories it is given and writes nothing. |
| `lab/server.ts` | The lab: serves the page at `/` and `/view/<id>` on `127.0.0.1`, usually port 4747. |
| `lab/open.ts` | The lab: writes the one temporary file that takes the browser to the page with the key. |
| `lab/page.html`, `app.css`, `app.js`, `strings.js`, `map.js`, `core.js` | The lab: the page, which holds no data, in plain files that `npm run check` does not check. |

Of the live mode's files, all but `state.ts` and `live.ts` hold no model call and no disk access, and of the live
mode only `state.ts` touches the disk. Nothing in `src/` but the command line, `numbers.ts` and the test of `kept.ts`
imports from `lab/`, and `lab/` asks no model. What may leave the lab is listed in [docs/lab.md](docs/lab.md); keep
that list true.

- The key that the lab's data needs, where it travels and which address the command prints:
  [docs/lab.md](docs/lab.md#the-folders-the-address-and-its-key).
- What the ChatGPT plan connection does with a message the service marks as interim (`commentary`), and the limit
  of 100,000 characters: [docs/connection.md](docs/connection.md#chatgpt-plan).

## The code

- Node 24.9+ runs the TypeScript without a build step, so use erasable syntax only and explicit `.ts` import
  specifiers.
- No dependencies at run time. `typescript` and `@types/node` are there for `npm run check`.
- A comment says why, never what. Comments are whole lines that begin with `//` after indentation.
  `npm run size` counts their token share of the core against a 10 percent bound, a reason to look and not a ban.
- `npm test` needs no `npm install` and no network. A test goes in only where a failure would cost money, leak
  something or lose data unnoticed.
- A request to the model holds what the caller gave and nothing else. Do not add default instructions, tools or
  metadata to it.
- The core of the live mode (`world.ts`, `time.ts`, `action.ts`, `answer.ts`, `things.ts`, `journal.ts`, `laws.ts`, `sleep.ts`, `weather.ts`, `memory.ts`,
  `reading.ts`, `touch.ts`, `marks.ts`) is meant to stay small enough to read whole. `npm run size` counts it in tokens against the owner's
  mark of 70,000, a mark to steer by, and two bounds a fifth below and above it, kept in `scripts/size.py`: a note above the first, a warning above the second, a strong warning above the third,
  and it forbids nothing. Above the mark a change that adds to the core says what it takes out or why the
  size should rise. When a change grows the core, run it
  before and after and say in your report by how many tokens the core grew. It needs `tiktoken` from outside the
  repository, from the Python that `SAGENTS_SIZE_PYTHON` names, and never estimates: without it, say that the count was not taken.
- A `catch` names the errors it expects and passes the rest on. An empty `catch` carries a comment saying why
  nothing can be lost there.
