# AGENTS.md

Orientation for AI coding assistants and people working in this project. Keep it short and true.

## What this is

sagents runs story agents: models with tools for an interactive story where a coding agent has tools for a repository.
[README.md](README.md) says what is written and what is only planned. Today the code is the model connection
(`src/chatgpt.ts`), a prototype of the live mode (`src/world.ts` for the rules, `src/live.ts` for the run) and the
command line (`src/cli.ts`).

## The code

- Node 24.9+ runs the TypeScript without a build step, so use erasable syntax only and explicit `.ts` import
  specifiers.
- No dependencies at run time. `typescript` and `@types/node` are there for `npm run check`.
- `npm test` needs no `npm install` and no network. A test goes in only where a failure would cost money, leak
  something or lose data unnoticed.
- A request to the model holds what the caller gave and nothing else. Do not add default instructions, tools or
  metadata to it.

## Secrets and private text

- Do not open `~/.config/sagents/chatgpt.json`. It holds tokens. When you need a fact about it, run
  `node src/cli.ts status`. It prints whether this computer is signed in, whether plan use is allowed and how many
  minutes the access token has left. For a signed-in account it also asks OpenAI for the models, which can renew the
  tokens.
- The owner signs in. An assistant does not run `login` for them and does not type credentials anywhere.
- Never print or log tokens, request text or the service's error text. A model's answer goes where its caller asked
  for it and nowhere else: `ask` prints it on stdout. A failure is a code in `ModelError`, with the service's own code
  and field name only when they are plain identifiers. A sign-in problem is one of this project's own sentences in
  `SignInError`.
- Tests and examples use synthetic stories.
- When the plan's limit is reached (`budget_exceeded`), stop. Do not look for another way to pay or to raise it.

## Publishing

A push needs the owner's word each time.
