import { isObject, refuse, WorldError } from './reading.ts';
import { sleep } from './sleep.ts';
import type { Debt } from './sleep.ts';
import { weather } from './weather.ts';
import type { Skies } from './weather.ts';
import { hunger } from './hunger.ts';
import type { Fed } from './hunger.ts';
import { all } from './things.ts';
import { readCore } from './world.ts';
import type { Event, Person, Place, World } from './world.ts';

export type Fields = { readonly [field: string]: unknown };
export type Settings = Pick<World, 'sleep' | 'weather' | 'hunger'>;
export type Parts = { debts: Map<string, Debt>; skies: Skies | null; fed?: Map<string, Fed> };
export type LawRecord = { kind: 'spent'; who: string; at: number } | { kind: 'weather'; at: number; n: number };
// An idle line gives memory.ts nothing to fold after sleep and waking alone.
export type Put = { event: Event; lines: Map<string, { text: string; idle: boolean }> };

export type Law<Name extends keyof Settings, Part extends keyof Parts> = {
  kind?: LawRecord['kind'];
  fields: string[];
  read(file: Fields, clock: string): Pick<Settings, Name>;
  begin(world: World): Pick<Parts, Part>;
  // journal.ts must keep law records only where due() asks for them.
  due?(world: World, parts: Parts, actor: Person): LawRecord | null;
  put?(world: World, parts: Parts, people: Person[], record: LawRecord): Put;
  turn(world: World, parts: Parts, actor: Person, now: number): string | null;
  // requestLimit() in live.ts needs the largest addition in characters to bound a request.
  size(world: World): number;
  world?(world: World, parts: Parts, place: Place): string | null;
  seen?(world: World, parts: Parts, person: Person, now: number): string;
  after?(parts: Parts, event: Event): void;
};

// Weather changes must precede turns at the same instant.
export const LAWS: readonly (typeof weather | typeof sleep | typeof hunger)[] = [weather, sleep, hunger];
export const beginLaws = (world: World): Parts => ({ ...weather.begin(world), ...sleep.begin(world), ...hunger.begin(world) });

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The environment name becomes a filename in cli.ts.
export function environmentOf(value: unknown): string | null {
  if (!isObject(value) || value.environment === undefined || value.environment === null) return null;
  if (typeof value.environment !== 'string' || !NAME.test(value.environment)) throw new WorldError('The world file cannot be used: `environment` must be a name of lower-case letters, digits and `-`.');
  return value.environment;
}
export const isEnvironmentName = (name: string) => NAME.test(name);

export function readWorld(value: unknown, environment?: unknown): World {
  const core = readCore(value);
  const fields = [weather, sleep].flatMap(law => law.fields), own: Fields = isObject(value) ? value : {};
  // An environment must not enable hunger without the world file's format mark for kept runs.
  const settings = hunger.read(own, core.clock);
  if (settings.hunger) {
    const things = all([...core.places.flatMap(place => place.things), ...(core.vehicles ?? []).flatMap(place => place.things), ...core.characters.flatMap(person => person.carries)]);
    if (!things.some(thing => thing.food !== null && thing.food > 0)) return refuse('hunger', 'needs a thing with `food` above zero');
    if (!things.some(thing => thing.drink)) return refuse('hunger', 'needs a thing with `drink: true`');
  }
  const read = (file: Fields) => ({ ...weather.read(file, core.clock), ...sleep.read(file, core.clock), ...settings });
  if (environment === undefined) return { ...core, ...read(own) };
  try {
    if (!isObject(environment)) throw new WorldError('The world file cannot be used: `the file` must be a JSON object.');
    const unknown = Object.keys(environment).find(field => !fields.includes(field));
    if (unknown !== undefined) throw new WorldError(`The world file cannot be used: \`${unknown}\` is no setting of a law.`);
    // Check the environment on its own so a world override cannot hide an invalid setting.
    read(environment);
  } catch (error) {
    if (!(error instanceof WorldError)) throw error;
    throw new WorldError(error.message.replace('The world file', 'The environment'));
  }
  return { ...core, ...read({ ...environment, ...Object.fromEntries(fields.filter(field => own[field] !== undefined).map(field => [field, own[field]])) }) };
}
