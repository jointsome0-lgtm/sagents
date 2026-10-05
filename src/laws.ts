// The laws of a live world that the clock drives, in one form, and a world file read with their settings. A law of
// this kind has settings, a part of the world's state that is its own, and a record that the rules put when the clock
// reaches its moment: no model is asked for it. Sleep debt and the weather are the two there are. No model and no
// disk here: an environment comes in as the command line read it.
import { isObject, WorldError } from './reading.ts';
import { sleep } from './sleep.ts';
import type { Debt } from './sleep.ts';
import { weather } from './weather.ts';
import type { Skies } from './weather.ts';
import { readCore } from './world.ts';
import type { Event, Person, Place, World } from './world.ts';

export type Fields = { readonly [field: string]: unknown };
// The settings of the laws, which a world holds, and their parts of a world's state.
export type Settings = Pick<World, 'sleep' | 'weather'>;
export type Parts = { debts: Map<string, Debt>; skies: Skies | null };
// The records the laws put: a person who could stay awake no longer falls asleep, and the weather changes to its
// state number `n`.
export type LawRecord = { kind: 'spent'; who: string; at: number } | { kind: 'weather'; at: number; n: number };
// A record of a law as it took effect: the event, and for those who remember it in the law's own words, the line.
// Anyone else who perceived the event remembers it as any event. An `idle` line is one its owner lived through nothing by.
export type Put = { event: Event; lines: Map<string, { text: string; idle: boolean }> };

export type Law<Name extends keyof Settings, Part extends keyof Parts> = {
  kind: LawRecord['kind'];
  // The names of its settings in a world file and in an environment.
  fields: string[];
  // Its settings from a world file's fields, checked: the first thing wrong is one sentence that names the field.
  read(file: Fields, clock: string): Pick<Settings, Name>;
  // Its part of the state when the story starts.
  begin(world: World): Pick<Parts, Part>;
  // The record the rules put now, before `actor`, the next to play, has its turn; or null. A journal holds this
  // record there and no other, and holds a record of this kind nowhere else.
  due(world: World, parts: Parts, actor: Person): LawRecord | null;
  put(world: World, parts: Parts, people: Person[], record: LawRecord): Put;
  // What it adds to a resident's turn, as one line, or null.
  turn(world: World, parts: Parts, actor: Person, now: number): string | null;
  // The most characters it adds to one request, a resident's or the world's.
  size(world: World): number;
  // What it adds to the world's request about a deed in `place`. The weather's alone.
  world?(world: World, parts: Parts, place: Place): string | null;
  // What it adds to what the others in a place are told of `person`. Sleep's alone.
  seen?(world: World, parts: Parts, person: Person, now: number): string;
  // Its part of the state kept up after an event of any kind. Sleep's alone: its count turns when someone falls
  // asleep or wakes.
  after?(parts: Parts, event: Event): void;
};

// In the order the rules ask them: a change of the weather that is due comes before anyone's turn at that moment.
export const LAWS: readonly (typeof weather | typeof sleep)[] = [weather, sleep];
export const beginLaws = (world: World): Parts => ({ ...weather.begin(world), ...sleep.begin(world) });

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The environment a world file names, or null. It is a file's name, so it is held to lower-case letters, digits and `-`.
export function environmentOf(value: unknown): string | null {
  if (!isObject(value) || value.environment === undefined || value.environment === null) return null;
  if (typeof value.environment !== 'string' || !NAME.test(value.environment)) throw new WorldError('The world file cannot be used: `environment` must be a name of lower-case letters, digits and `-`.');
  return value.environment;
}
export const isEnvironmentName = (name: string) => NAME.test(name);

// A world file as it was parsed from JSON, checked whole, with the settings of the laws. `environment` is the parsed
// file of the environment the world lives in, or nothing: it holds settings of the laws and nothing else, and a
// setting the world file gives itself takes the place of the environment's.
export function readWorld(value: unknown, environment?: unknown): World {
  const core = readCore(value);
  const fields = LAWS.flatMap(law => law.fields), own: Fields = isObject(value) ? value : {};
  const read = (file: Fields) => ({ ...weather.read(file, core.clock), ...sleep.read(file, core.clock) });
  if (environment === undefined) return { ...core, ...read(own) };
  try {
    if (!isObject(environment)) throw new WorldError('The world file cannot be used: `the file` must be a JSON object.');
    const unknown = Object.keys(environment).find(field => !fields.includes(field));
    if (unknown !== undefined) throw new WorldError(`The world file cannot be used: \`${unknown}\` is no setting of a law.`);
    // An environment must be usable by itself, whatever a world file changes in it.
    read(environment);
  } catch (error) {
    if (!(error instanceof WorldError)) throw error;
    throw new WorldError(error.message.replace('The world file', 'The environment'));
  }
  return { ...core, ...read({ ...environment, ...Object.fromEntries(fields.filter(field => own[field] !== undefined).map(field => [field, own[field]])) }) };
}
