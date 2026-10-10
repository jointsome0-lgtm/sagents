import { createChatgpt } from './chatgpt.ts';
import type { Controls, Request, Result } from './chatgpt.ts';
import { createCompatible } from './compatible.ts';

const API = 'api:';

export type Respond = (request: Request, controls?: Controls) => Promise<Result>;
type Options = NonNullable<Parameters<typeof createChatgpt>[0]> & NonNullable<Parameters<typeof createCompatible>[0]>;

export function modelFor(name: string, options: Options = {}): { respond: Respond; model: string } {
  return name.startsWith(API) ? { respond: createCompatible(options).respond, model: name.slice(API.length) }
    : { respond: createChatgpt(options).respond, model: name };
}
