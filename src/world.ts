// The world of the `live` mode as its file gives it and as a run holds it, with no model in it: named places, who is
// where, and the events of a run. The rules are next to it: the clock and the distances in `time.ts`, what a
// resident does in `action.ts`, and what the world answers to a deed or for a figure in `answer.ts`.
import { boundedOf, amountOf, countOf, isObject, listOf, refuse, textOf, TIME } from './reading.ts';
import { all, MAX_IN_PLACE, MAX_ON_PERSON, readThings } from './things.ts';
import type { Posting, Thing } from './things.ts';
import type { Sleep } from './sleep.ts';
import type { Weather } from './weather.ts';

export { CHARS_PER_WORD, cut, sizeOf, wordsOf, WorldError } from './reading.ts';

export const MAX_WORDS = 65;
export const MAX_SECONDS = 3600;
export const MAX_SLEEP = 43_200;
// The most words one `facts` of a world file may hold, so that the request to the world has a largest size.
export const MAX_FACTS = 300;
// What an answer that cannot be used becomes: a wait of this many seconds.
export const LOST_SECONDS = 30;

// `facts` is what is true of the world, of a place or of a person and is not seen at once. It is for the world's own
// answers to what people do and never for a character: no character is sent any of it.
// `things` are the records of what stands and lies in a place, and `carries` those of what a person has in hand or
// wears, each with all that it holds (`things.ts`). Of a person, `looks` is what anyone near sees and never changes,
// the body and the face and no clothes, and `pose` how and where in the place it is. The world file gives how these
// begin; the things and the pose then belong to the run's state and change only by the world's answer. A thing of a
// place that is `hidden` is not found without a search of its minutes, or by a deed that goes straight to its spot.
// `memory` is what a person remembers when the story begins: what it owes and is owed today, where things lie. The
// sheet says who the person is, and this text ages as a memory does. A place that is `open` lies under the open sky.
// `crowd` is the people of a place whom nobody plays, as anyone there sees them, and `figures` those of them who
// have a name: each with `looks` and `facts` as a character has them, and with no sheet, memory or turn. A figure
// stays in its place and does nothing but answer a `say` addressed to it, in the words the world gives it.
// `at` is where a place lies, in metres east and north of any point the world file likes, or null.
// A place with a `clock` shows the time to everyone in it, and a character with one, a watch or a phone, reads it
// anywhere. Neither changes in a run: a clock is not yet a thing that can be handed over.
export type Figure = { id: string; name: string; looks: string | null; facts: string | null };
export type Place = { id: string; name: string; about: string; facts: string | null; things: Thing[]; open: boolean; clock: boolean;
  crowd: string | null; figures: Figure[];
  at: [number, number] | null; minutesTo: { [place: string]: number } };
export type Character = { id: string; name: string; place: string; sheet: string; memory: string | null; facts: string | null; looks: string | null; pose: string | null;
  carries: Thing[]; clock: boolean };
// The most words each of these texts may hold, in the world file and in the world's answer alike.
export const LIMITS = { looks: 60, pose: 20, crowd: 60 };
// `remote` names the means by which people reach each other from afar; a world with null has none.
// `walkMetresPerMinute` is the pace at which everyone walks between places that say where they lie.
// `shortWords` and `longWords` are the sizes of a character's two memories, which `memory.ts` keeps. `sleep` and
// `weather` are the settings of the laws the clock drives (`laws.ts`), as the world file and its environment give them.
export type World = { title: string; about: string; facts: string | null; clock: string; wordsPerMinute: number; remote: string | null;
  travelMinutes: number; walkMetresPerMinute: number; shortWords: number; longWords: number; sleep: Sleep; weather: Weather | null; places: Place[]; characters: Character[] };

export type Kind = 'say' | 'call' | 'go' | 'do' | 'wait' | 'sleep';
// `place` is where it happened; `to` is the character called, the figure spoken to, or the place a `go` leads to; `heard` holds the ids of
// those who perceived it when it happened, without the one who did it. A `memory` is a character's long-term text
// written anew, which nobody else perceives: `text` is the new text, or null when the rewrite was lost.
// A `result` is the world's answer to the `do` before it, of the same `who`: `text` is what came of the deed, or null
// when nothing did that could be noticed, `wakes` the sleepers the deed wakes and `poses` the poses it changed. It
// says whether the world called the deed a `search` of the place and which hidden things it says the deed went
// straight to, `finds`. What the rules made of the answer is in `moved`, one posting for each thing that went from
// one holder to another or out of the world, where an `eaten` one is eaten by `who`; in `set`, the things put into
// another state; and in `found`, the hidden things found either way. A `reply` is what a figure answers to the `say`
// before it: `who` is the figure, `to` the speaker, `text` its words, or null when it says nothing, `seconds` how
// long they take from the end of that `say`, and `moved` what changed hands with them. A `weather` is a change of the
// weather, which nobody does and which has no place: `who` and `place` are empty, `text` is the new weather under the
// open sky and `indoors`, which only this kind has, what of it reaches someone under a roof, or null.
export type Event = { at: number; clock: string; kind: Kind | 'arrive' | 'wake' | 'memory' | 'result' | 'reply' | 'weather'; who: string; place: string; to: string | null;
  text: string | null; seconds: number; cut: boolean; heard: string[]; note: string | null; wakes?: string[];
  indoors?: string | null; search?: boolean; finds?: string[]; moved?: Posting[]; set?: { what: string; name: string; state: string }[];
  poses?: { of: string; text: string }[]; found?: { what: string; name: string; spot: string }[] };
// A character in the run. On the way it is in no place and `heading` names where it will arrive; asleep it stays in
// its place. `speaking` and `listening` are the ends of its own last speech and of the latest speech it heard; `began`
// is the start of its own last action. `pose` is how it is placed now.
export type Person = { id: string; place: string | null; heading: string | null; asleep: boolean; freeAt: number; began: number | null;
  speaking: number; listening: number; pose: string | null };

const ID = /^[A-Za-z][\w-]{0,39}$/;
const factsOf = (value: unknown, field: string) => boundedOf(value, field, MAX_FACTS);
function idOf(value: unknown, field: string, taken: string[]): string {
  if (typeof value !== 'string' || !ID.test(value)) return refuse(field, 'must be a short id of Latin letters, digits, `_` and `-`');
  return taken.includes(value) ? refuse(field, 'repeats an id') : value;
}

// A world file as it was parsed from JSON, without the settings of the laws, which `readWorld` of `laws.ts` adds.
// The first thing wrong is one sentence that names the field.
export function readCore(value: unknown): Omit<World, 'sleep' | 'weather'> {
  if (!isObject(value)) return refuse('the file', 'must be a JSON object');
  if (typeof value.clock !== 'string' || !TIME.test(value.clock)) return refuse('clock', 'must be a time of day like `21:00`');
  if (value.remote !== undefined && value.remote !== null) textOf(value.remote, 'remote');
  const places: Place[] = [], labels = { next: 1 }, longWords = countOf(value.longWords, 'longWords', 400);
  const within = (things: Thing[], most: number, field: string) => all(things).length <= most ? things : refuse(field, `must hold ${most} things at most, with all that they hold`);
  for (const [index, place] of listOf(value.places, 'places').entries()) {
    const field = `places[${index}]`;
    if (!isObject(place)) return refuse(field, 'must be an object');
    if (place.open !== undefined && typeof place.open !== 'boolean') return refuse(`${field}.open`, 'must be true or false');
    if (place.clock !== undefined && typeof place.clock !== 'boolean') return refuse(`${field}.clock`, 'must be true or false');
    if (place.minutesTo !== undefined && !isObject(place.minutesTo)) return refuse(`${field}.minutesTo`, 'must be an object');
    // What the rules read as texts before they kept things as records is refused, so that no thing is lost unseen.
    if (place.hidden !== undefined) return refuse(`${field}.hidden`, 'is no longer read: a hidden thing is one of `things` with `hidden`');
    if (place.figures !== undefined && !Array.isArray(place.figures)) return refuse(`${field}.figures`, 'must be a list');
    const figures = ((place.figures ?? []) as unknown[]).map((figure, at): Figure => {
      const name = `${field}.figures[${at}]`;
      if (!isObject(figure)) return refuse(name, 'must be an object');
      return { id: figure.id as string, name: textOf(figure.name, `${name}.name`), looks: boundedOf(figure.looks, `${name}.looks`, LIMITS.looks),
        facts: factsOf(figure.facts, `${name}.facts`) };
    });
    const at = place.at === undefined || place.at === null ? null : place.at;
    if (at !== null && !(Array.isArray(at) && at.length === 2 && at.every(part => typeof part === 'number' && Number.isFinite(part)))) {
      return refuse(`${field}.at`, 'must be two numbers, the metres east and north');
    }
    const minutesTo: { [place: string]: number } = {};
    for (const [to, minutes] of Object.entries(place.minutesTo ?? {})) minutesTo[to] = amountOf(minutes ?? null, `${field}.minutesTo.${to}`, 0);
    places.push({ id: idOf(place.id, `${field}.id`, places.map(known => known.id)), name: textOf(place.name, `${field}.name`),
      about: textOf(place.about, `${field}.about`), facts: factsOf(place.facts, `${field}.facts`),
      things: within(readThings(place.things, `${field}.things`, labels, true), MAX_IN_PLACE, `${field}.things`), open: place.open === true, clock: place.clock === true,
      crowd: boundedOf(place.crowd, `${field}.crowd`, LIMITS.crowd), figures, at: at as [number, number] | null, minutesTo });
  }
  for (const [index, place] of places.entries()) {
    const unknown = Object.keys(place.minutesTo).find(to => to === place.id || !places.some(known => known.id === to));
    if (unknown !== undefined) return refuse(`places[${index}].minutesTo.${unknown}`, 'must name another place of the list');
  }
  const characters: Character[] = [];
  for (const [index, character] of listOf(value.characters, 'characters').entries()) {
    const field = `characters[${index}]`;
    if (!isObject(character)) return refuse(field, 'must be an object');
    if (!places.some(place => place.id === character.place)) return refuse(`${field}.place`, 'must name a place of the list');
    if (character.clock !== undefined && typeof character.clock !== 'boolean') return refuse(`${field}.clock`, 'must be true or false');
    const old = ['holds', 'has'].find(name => character[name] !== undefined);
    if (old) return refuse(`${field}.${old}`, 'is no longer read: what a person has is the list `carries`');
    characters.push({ id: idOf(character.id, `${field}.id`, characters.map(known => known.id)), name: textOf(character.name, `${field}.name`),
      place: character.place as string, sheet: textOf(character.sheet, `${field}.sheet`), memory: boundedOf(character.memory, `${field}.memory`, longWords), facts: factsOf(character.facts, `${field}.facts`),
      looks: boundedOf(character.looks, `${field}.looks`, LIMITS.looks), pose: boundedOf(character.pose, `${field}.pose`, LIMITS.pose),
      carries: within(readThings(character.carries, `${field}.carries`, labels), MAX_ON_PERSON, `${field}.carries`),
      clock: character.clock === true });
  }
  // An id names one thing: a figure's is no place's, no character's and no other figure's.
  const taken = [...places, ...characters].map(known => known.id);
  for (const [index, place] of places.entries()) {
    for (const [at, figure] of place.figures.entries()) taken.push(idOf(figure.id, `places[${index}].figures[${at}].id`, taken));
  }
  return { title: textOf(value.title, 'title'), about: textOf(value.about, 'about'), facts: factsOf(value.facts, 'facts'), clock: value.clock,
    wordsPerMinute: amountOf(value.wordsPerMinute, 'wordsPerMinute', 130), remote: typeof value.remote === 'string' ? value.remote : null,
    travelMinutes: amountOf(value.travelMinutes, 'travelMinutes', 5),
    walkMetresPerMinute: amountOf(value.walkMetresPerMinute, 'walkMetresPerMinute', 80), shortWords: countOf(value.shortWords, 'shortWords', 2000),
    longWords, places, characters };
}

// Everyone with a name whom nobody plays, and everyone a line may name: the characters and those.
export const figuresOf = (world: World) => world.places.flatMap(place => place.figures);
export const namesOf = (world: World) => [...world.characters, ...figuresOf(world)];
