import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ModelError } from './chatgpt.ts';
import { StateError } from './journal.ts';
import type { Live, Player } from './live.ts';
import { openState } from './state.ts';
import type { Event } from './world.ts';

export class KeptError extends StateError {}
const STRETCH = /^(?:usage-part(\d+)\.jsonl|part(\d+)\.events\.jsonl)$/;
const failed = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;

// runLive sends one request at a time, so a usage row belongs to the last onAsk.
export function keepRun(dir: string, world: string, environment?: string, untakenText = false) {
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
  // The state lock prevents another run from taking the same stretch.
  const state = openState(join(dir, 'state.sqlite'), world, environment);
  try {
    const stretch = `part${Math.max(0, ...names.map(name => { const found = STRETCH.exec(name); return found ? Number(found[1] ?? found[2]) : 0; })) + 1}`;
    const events = join(dir, `${stretch}.events.jsonl`), usage = join(dir, `usage-${stretch}.jsonl`), untaken = join(dir, `untaken-${stretch}.jsonl`);
    for (const path of [events, usage, untaken]) writeFileSync(path, '', { flag: 'wx' });
    let asked: { kind: string; who: string | null; name: string } | null = null, sent = 0;
    const onAsk: NonNullable<Live['onAsk']> = (kind, who, name) => { asked = { kind, who, name }; };
    const onUntaken: NonNullable<Live['onUntaken']> = (kind, cause, entry, answer) => appendFileSync(untaken, `${JSON.stringify({ n: sent, kind, cause,
      ...(untakenText && kind !== 'turn' && entry !== null ? { entry } : {}), ...(untakenText && answer !== null ? { answer } : {}) })}\n`);
    const count = (respond: Player['respond']): Player['respond'] => async request => {
      const row: { [field: string]: unknown } = { n: sent += 1, at: new Date().toISOString(), kind: asked?.kind ?? 'other', who: asked?.who ?? null, model: asked?.name ?? request.model };
      asked = null;
      const began = performance.now();
      try {
        const answer = await respond(request);
        Object.assign(row, { ms: Math.round(performance.now() - began), input: answer.usage?.inputTokens ?? null, cached: answer.usage?.cachedInputTokens ?? null, written: answer.usage?.writtenInputTokens ?? null,
          output: answer.usage?.outputTokens ?? null, reasoning: answer.usage?.reasoningTokens ?? null });
        if (answer.tries === 2) row.tries = 2;
        return answer;
      } catch (error) {
        // Usage logs must not contain the service's failure text.
        Object.assign(row, { ms: Math.round(performance.now() - began), error: error instanceof ModelError ? error.code : 'unexpected' });
        if (error instanceof ModelError) {
          if (typeof error.httpStatus === 'number') row.status = error.httpStatus;
          if (error.stage === 'connect' || error.stage === 'stream') row.stage = error.stage;
          if (error.tries === 2) row.tries = 2;
          if (error.code === 'declined' && ['event', 'filter', 'part'].includes(error.refusal ?? '')) row.refusal = error.refusal;
        }
        throw error;
      } finally { appendFileSync(usage, `${JSON.stringify(row)}\n`); }
    };
    return { state, stretch, count, onAsk, onUntaken, onEvent: (event: Event) => appendFileSync(events, `${JSON.stringify(event)}\n`), close: () => state.close() };
  } catch (error) {
    state.close();
    if (failed(error, 'EEXIST') || failed(error, 'EACCES')) throw new KeptError('The run directory cannot be made, read or written.');
    throw error;
  }
}
