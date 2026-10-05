import { createChatgpt } from './chatgpt.ts';
import type { Controls, Request, Result } from './chatgpt.ts';
import { createCompatible } from './compatible.ts';

// Which connection a model's name asks for. `api:<id>` is the server that SAGENTS_API_URL names, and every other name
// is a model of the ChatGPT plan, with its `@<effort>` if it has one. The id that comes back is the one to put into
// the request for the function that comes with it.
const API = 'api:';

export type Respond = (request: Request, controls?: Controls) => Promise<Result>;
type Options = NonNullable<Parameters<typeof createChatgpt>[0]> & NonNullable<Parameters<typeof createCompatible>[0]>;

export function modelFor(name: string, options: Options = {}): { respond: Respond; model: string } {
  return name.startsWith(API) ? { respond: createCompatible(options).respond, model: name.slice(API.length) }
    : { respond: createChatgpt(options).respond, model: name };
}
