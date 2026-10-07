// A run kept in a directory as an experiment that the lab reads with no other tool (`lab/data.ts`, the shape of
// one world): `world.json`, the world file as it was given; `state.sqlite`, the journal; and for every start a
// stretch of its own, `part<N>.events.jsonl` with one event a line and `usage-part<N>.jsonl` with one row for every
// request. A second start in the same directory goes on in the same world as the next stretch. Nothing that is
// there is ever overwritten or shortened: a file is made only where there is none, and lines are only added.
// A usage row holds what was counted and no text of a request, an answer or a failure: `n`, the request's number in
// the stretch; `at`, when it was sent; `kind`, what it was for; `who`, the resident's id, or null for the world's;
// `model`, the name the model was given by; `ms`; `input`, `cached`, `output` and `reasoning` tokens, null where the
// service reported none; and `error`, the failure's code, on a request that failed.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ModelError } from './chatgpt.ts';
import { StateError } from './journal.ts';
import type { Live, Player } from './live.ts';
import { openState } from './state.ts';
import type { Event } from './world.ts';

// The sentences about a run directory that cannot be used; they are this file's own and may be shown, as those of
// the state file it keeps are.
export class KeptError extends StateError {}
const STRETCH = /^(?:usage-part(\d+)\.jsonl|part(\d+)\.events\.jsonl)$/;
const failed = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;

// Opens the run kept in `dir`, or begins one there, for the world whose file holds `world` and whose environment's
// file holds `environment`. A directory that keeps another world file is refused before anything is made in it, and
// so is, by the state file, a directory that another run holds or whose environment has changed. `count` wraps a
// player's `respond` so that each of its requests leaves a row, `onAsk` and `onEvent` are `runLive`'s, and `close`
// lets the state file go. The engine sends one request at a time, so the request a row is written for is the one
// `onAsk` was told of last.
export function keepRun(dir: string, world: string, environment?: string) {
  const kept = join(dir, 'world.json');
  let names: string[];
  try {
    mkdirSync(dir, { recursive: true });
    try { writeFileSync(kept, world, { flag: 'wx' }); } catch (error) {
      if (!failed(error, 'EEXIST')) throw error;
      if (readFileSync(kept, 'utf8') !== world) throw new KeptError('The run directory keeps another world file than this one: a kept run goes on only in its own world.');
    }
    names = readdirSync(dir);
  } catch (error) {
    if (error instanceof KeptError || !(error instanceof Error && 'code' in error && typeof error.code === 'string')) throw error;
    throw new KeptError('The run directory cannot be made, read or written.');
  }
  // The state file is held from here on, so no other run can take the same stretch.
  const state = openState(join(dir, 'state.sqlite'), world, environment);
  try {
    const stretch = `part${Math.max(0, ...names.map(name => { const found = STRETCH.exec(name); return found ? Number(found[1] ?? found[2]) : 0; })) + 1}`;
    const events = join(dir, `${stretch}.events.jsonl`), usage = join(dir, `usage-${stretch}.jsonl`);
    // Both files are made here, and only where there is none.
    for (const path of [events, usage]) writeFileSync(path, '', { flag: 'wx' });
    let asked: { kind: string; who: string | null; name: string } | null = null, sent = 0;
    const onAsk: NonNullable<Live['onAsk']> = (kind, who, name) => { asked = { kind, who, name }; };
    const count = (respond: Player['respond']): Player['respond'] => async request => {
      const row: { [field: string]: unknown } = { n: sent += 1, at: new Date().toISOString(), kind: asked?.kind ?? 'other', who: asked?.who ?? null, model: asked?.name ?? request.model };
      asked = null;
      const began = performance.now();
      try {
        const answer = await respond(request);
        Object.assign(row, { ms: Math.round(performance.now() - began), input: answer.usage?.inputTokens ?? null, cached: answer.usage?.cachedInputTokens ?? null,
          output: answer.usage?.outputTokens ?? null, reasoning: answer.usage?.reasoningTokens ?? null });
        return answer;
      } catch (error) {
        // The code of a failure is one of this project's own words; nothing the service said is written.
        Object.assign(row, { ms: Math.round(performance.now() - began), error: error instanceof ModelError ? error.code : 'unexpected' });
        throw error;
      } finally { appendFileSync(usage, `${JSON.stringify(row)}\n`); }
    };
    return { state, stretch, count, onAsk, onEvent: (event: Event) => appendFileSync(events, `${JSON.stringify(event)}\n`), close: () => state.close() };
  } catch (error) {
    state.close();
    if (failed(error, 'EEXIST') || failed(error, 'EACCES')) throw new KeptError('The run directory cannot be made, read or written.');
    throw error;
  }
}
