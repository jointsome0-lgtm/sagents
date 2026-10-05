# AGENTS.md

Orientation for AI coding assistants and people working in this project. Keep it short and true.

## What this is

sagents runs story agents: models with tools for an interactive story where a coding agent has tools for a repository.
[README.md](README.md) says what is written and what is only planned. Today the code is the two model connections
(`src/chatgpt.ts` for a ChatGPT plan, `src/compatible.ts` for a chat completions server), the choice between them by
the model's name (`src/model.ts`), a prototype of the live mode and the command line (`src/cli.ts`). The live mode is
`src/world.ts` for the rules of time, place and perception, `src/reading.ts` for the checks a world file is read
with, `src/laws.ts` for the form of a law that the clock drives, with `src/sleep.ts` and `src/weather.ts` in that
form, `src/memory.ts` for what a character remembers, `src/journal.ts` for the records that are its only state,
`src/state.ts` for the file that keeps them and `src/live.ts` for the run and the prompts. All but the last two hold
no model call and no disk access, and only `state.ts` touches the disk; `src/cli.ts` reads the world file and its
environment from `environments/`.

## The code

- Node 24.9+ runs the TypeScript without a build step, so use erasable syntax only and explicit `.ts` import
  specifiers.
- No dependencies at run time. `typescript` and `@types/node` are there for `npm run check`.
- `npm test` needs no `npm install` and no network. A test goes in only where a failure would cost money, leak
  something or lose data unnoticed.
- A request to the model holds what the caller gave and nothing else. Do not add default instructions, tools or
  metadata to it.
- The core of the live mode (`world.ts`, `journal.ts`, `laws.ts`, `sleep.ts`, `weather.ts`, `memory.ts`,
  `reading.ts`) is meant to stay small enough to read whole. `npm run size` counts it in tokens against a ceiling
  kept in `scripts/size.py`; over the ceiling it warns and forbids nothing. When a change grows the core, run it
  before and after and say in your report by how many tokens the core grew. It needs `tiktoken` from outside the
  repository and never estimates: without it, say that the count was not taken.
- A `catch` names the errors it expects and passes the rest on. An empty `catch` carries a comment saying why
  nothing can be lost there.

## Secrets and private text

- Do not open `~/.config/sagents/chatgpt.json`. It holds tokens. When you need a fact about it, run
  `node src/cli.ts status`. It prints whether this computer is signed in, whether plan use is allowed and how many
  minutes the access token has left. For a signed-in account it also asks OpenAI for the models, which can renew the
  tokens.
- The owner signs in. An assistant does not run `login` for them and does not type credentials anywhere.
- The key of a chat completions server comes from the environment (`SAGENTS_API_KEY`) and is never printed, logged,
  written to a file or put into an error. Do not open `.env*` files or print the environment. A request to a real
  server costs the owner money: an assistant sends one only when the owner asked for that request.
- Never print or log tokens, keys, request text or the service's error text. A model's answer goes where its caller asked
  for it and nowhere else: `ask` prints it on stdout. A failure is a code in `ModelError`, with the service's own code
  and field name only when they are plain identifiers. A sign-in problem is one of this project's own sentences in
  `SignInError`.
- Tests and examples use synthetic stories.
- When the plan's limit or the key's balance is reached (`budget_exceeded`), stop. Do not look for another way to pay or to raise it.

## Publishing

A push needs the owner's word each time.
