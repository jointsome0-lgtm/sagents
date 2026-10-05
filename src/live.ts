import { ModelError } from './chatgpt.ts';
import type { Request, Result } from './chatgpt.ts';
import { advance, memoryStore, replay } from './journal.ts';
import type { Record, Store } from './journal.ts';
import { oldest, readMemory } from './memory.ts';
import type { Line, Mind } from './memory.ts';
import { CHARS_PER_WORD, clockAt, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, next, readAction, travelSeconds, wordLimit } from './world.ts';
import type { Event, World } from './world.ts';

// The `live` mode: every character of a world is played by a model, one call for one action, under the story's clock.
// A character is sent its own sheet, what it remembers and what it perceived since, and nothing else: no other
// character's sheet, note or memory and no event it did not hear or see. There is no author above the characters.
// Everything that happens is a record in the journal (`journal.ts`), and a request is built from what the journal
// amounts to, so it has the same largest size however long the world has run.
export const INSTRUCTIONS = `You are one person in a story that several people live through together. You are that person and not a narrator.

Each turn you take exactly one action and answer with one JSON object. Every field is there; a field the action does not use is null.
- say: you speak \`text\` aloud. Everyone in your place hears it.
- call: you speak \`text\` to one person, \`to\` (that person's id), by the world's means of remote contact, if it has one. That person hears it wherever they are, and those in your place hear your half.
- go: you walk to another place of the list, \`place\` (its id). Moving about inside the place you are in is a do. On the way you hear and see nothing and cannot act.
- do: you do something others can see, \`text\`, for \`seconds\` (1 to ${MAX_SECONDS}). Write what you do, not what comes of it.
- wait: you stay silent and attentive for \`seconds\` (1 to ${MAX_SECONDS}). Speech near you, or someone coming or leaving, ends the wait early.
- sleep: you sleep for \`seconds\` (1 to ${MAX_SLEEP}), or \`until\` a time of day. Asleep you hear and see nothing, and nothing and nobody wakes you before that time. A call to you, like a call to someone on the way, waits until you can hear it.
- until: for do, wait and sleep, in place of \`seconds\`: a time of day like 06:30, the next moment the clock shows it. It must fall within the action's span.
- note: with any action, a private line you keep for yourself. Nobody else ever reads it. Null when you have none.

Speak the way people speak: briefly, one thought at a time, and leave room for an answer. Words cost the story's time: each takes part of a second, and those who listen are held until you finish. Each turn says how many words \`text\` may hold; a longer speech is cut there. A note, and the \`text\` of a do, keep their first ${MAX_WORDS} words.

You know only your sheet, what you remember and what you perceived since, which is what a turn lists. Nothing else is known to you. You may keep things to yourself, and you need not say what you want.

Your memory is a text you write yourself. When you wake, and when much has happened, you are asked to write it anew from what it held and what happened since. What you leave out of it then is forgotten.

Do not describe what other people do, feel or answer, and do not decide for them. They act on their own turns.

Write \`text\`, \`note\` and your memory in the language of your sheet.`;

const text = { type: ['string', 'null'] };
const schemaOf = (world: World) => ({ type: 'object', additionalProperties: false, required: ['action', 'text', 'to', 'place', 'seconds', 'until', 'note'],
  properties: { action: { type: 'string', enum: ['say', ...(world.remote === null ? [] : ['call']), 'go', 'do', 'wait', 'sleep'] }, text, to: text, place: text,
    seconds: { type: ['integer', 'null'] }, until: text, note: text } });
const MEMORY_SCHEMA = { type: 'object', additionalProperties: false, required: ['memory'], properties: { memory: { type: 'string' } } };

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
const tagged = ({ id, name }: { id: string; name: string }) => `${name} (${id})`;

// The system text has the part every character shares first, so that a server's prefix cache serves them all.
const sharedOf = (world: World) => `${INSTRUCTIONS}

The world: ${world.title}
${world.about}

Places:
${world.places.map(place => `- ${tagged(place)}: ${place.about}`).join('\n')}

People:
${world.characters.map(character => `- ${tagged(character)}`).join('\n')}

${world.remote === null ? 'There is no means of remote contact: to reach someone, go where they are.' : `Means of remote contact: ${world.remote}.`}`;
const systemOf = (world: World, shared: string, id: string) => {
  const self = world.characters.find(character => character.id === id)!;
  return `${shared}

You are ${tagged(self)}.
${self.sheet}`;
};

// What a character knows beyond its sheet, as a request opens with it: the long-term text, then the given lines.
const known = (mind: Mind, lines: Line[]) => [...(mind.long ? ['What you remember:', mind.long, ''] : []),
  ...(lines.length ? [mind.long ? 'Since then:' : 'So far:', ...lines.map(line => line.text), ''] : [])];
// The request to write the long-term memory anew. It keeps or drops: a memory must not gain what did not happen.
const rewriteOf = (world: World, clock: string, waking: boolean) => `Now ${clock}. This is not a turn and you take no action: ${
  waking ? 'you are waking, and what you lived through before your sleep stays with you only as your memory' : 'much has happened, and its oldest part stays with you only as your memory'}.
Write your memory anew as one text of at most ${world.longWords} words, in the language of your sheet, from what you remember and the lines above: what you know about people, what you want, what was promised and by whom, what has changed in you. Write in the past tense, as what has happened up to now. Do not say where you are or what you are doing at this moment: a turn says that. Record a deed as what you did, with its result only where the lines show one. Keep or drop, and add nothing that is not above. What you leave out is forgotten. A longer text is cut at the limit.
Answer with one JSON object that has the single field \`memory\`.`;

// No request of a world is longer than this many characters, system text and message together, however long the
// world has run. A line holds a speech, a note or a deed of `MAX_WORDS` words under a head of names and a clock, a
// character's own action is three lines at most, and the lines of one request are `shortWords` and one such action.
export function requestLimit(world: World): number {
  const longest = (texts: string[]) => Math.max(...texts.map(item => item.length));
  const people = world.characters.map(tagged), places = world.places.map(tagged);
  const system = sharedOf(world).length + longest(people) + longest(world.characters.map(character => character.sheet)) + 20;
  const head = 2 * longest(world.characters.map(character => character.name)) + longest(world.places.map(place => place.name)) + (world.remote?.length ?? 0) + 120;
  const lines = (world.shortWords + 3 * (head + MAX_WORDS)) * (CHARS_PER_WORD + 1);
  const now = [...people, ...places].reduce((sum, item) => sum + item.length + 30, 0) + longest(places) + 400;
  return system + world.longWords * CHARS_PER_WORD + lines + now + rewriteOf(world, '', true).length + 200;
}

// One event of a live run as lines for a person, or none for a wait that left no note. A note and a memory are the
// character's own and are marked as private: no other character was sent them.
export function linesOf(world: World, event: Event): string[] {
  const who = named(world.characters, event.who);
  const speech = `"${event.text}"${event.cut ? ' (cut)' : ''}`;
  const what = event.kind === 'say' ? `${who}: ${speech}`
    : event.kind === 'call' ? `${who} calls ${named(world.characters, event.to)}: ${speech}`
      : event.kind === 'go' ? `${who} leaves for ${named(world.places, event.to)} (${event.seconds} s)`
        : event.kind === 'arrive' ? `${who} arrives`
          : event.kind === 'sleep' ? `${who} falls asleep (${event.seconds} s)`
            : event.kind === 'wake' ? `${who} wakes`
              : event.kind === 'memory' ? `private memory of ${who}${event.cut ? ' (cut)' : ''}: ${
                event.text?.replaceAll('\n', '\n         ') ?? 'the rewrite was lost, and what it was to hold is forgotten'}`
                : event.kind === 'do' ? `${who} does (${event.seconds} s): ${event.text}` : `${who} waits (${event.seconds} s)`;
  return [...(event.kind === 'wait' && !event.note ? [] : [`${event.clock} [${named(world.places, event.place)}] ${what}`]),
    ...(event.note ? [`         private note of ${who}: ${event.note}`] : [])];
}

// `journal` is where the world's records are kept and read from: a run continues the world it finds there. `pause`
// says that this run's end is not the story's: then nobody is told how much is left and speech does not shorten
// towards the end. `minutes` count from where the world stands.
// A connection and the model to ask of it. `name` is the model's name as it was given, which the journal and the
// totals keep; it is `model` when it is not given.
export type Player = { respond: (request: Request) => Promise<Result>; model: string; name?: string };
// `respond`, `model` and `name` play everyone whom `cast` does not name by id. `onEvent` is given the event and the
// name of the model whose answer it came of, or null.
export type Live = Player & { world: World; cast?: { [id: string]: Player }; minutes?: number; calls?: number;
  onEvent?: (event: Event, by: string | null) => unknown; journal?: Store; pause?: boolean };
export type Tally = { calls: number; invalid: number; inputTokens: number; outputTokens: number };
// `reason` is `horizon` or `calls` for a run that ended as planned, and the failure's code for one that did not.
// `seconds` is the story time this run played. `rewrites` counts the memories written anew and `lost` those of them
// whose answer could not be used twice, so that the lines they were to keep are forgotten. `invalid` counts every
// answer that could not be used, whatever was asked. `models` holds the same counts for each model's name.
export type Outcome = Tally & { status: 'done' | 'failed'; reason: string; seconds: number; rewrites: number; lost: number;
  models: { [name: string]: Tally } };

// Plays the world on from its journal until the horizon, the limit of model calls or a failure of the connection.
// `calls` counts the answers that arrived, a memory's as well as a turn's. A failure ends the run at once: nothing is
// tried again, and the journal holds everything up to it.
export async function runLive({ world, respond, model, name, cast = {}, minutes = 30, calls: most = 60, onEvent = () => {}, journal = memoryStore(),
  pause = false }: Live): Promise<Outcome> {
  const state = replay(world, journal.entries());
  const stands = next(state.people).freeAt;
  const horizon = stands + Math.round(minutes * 60);
  const schema = schemaOf(world), shared = sharedOf(world);
  const outcome: Outcome = { status: 'done', reason: 'horizon', seconds: 0, calls: 0, invalid: 0, rewrites: 0, lost: 0, inputTokens: 0, outputTokens: 0,
    models: {} };
  // Who plays whom. Every request of a character, a turn or a memory, goes to its own connection under its own model.
  const everyone = { respond, model, name: name ?? model };
  const playerOf = (id: string) => { const player = Object.hasOwn(cast, id) ? cast[id] : everyone; return { ...player, name: player.name ?? player.model }; };
  const tallyOf = (player: { name: string }) => outcome.models[player.name] ??= { calls: 0, invalid: 0, inputTokens: 0, outputTokens: 0 };
  const unusable = (player: { name: string }) => {
    outcome.invalid += 1;
    tallyOf(player).invalid += 1;
  };
  // The one way anything happens: the record goes through the rules, then to the journal, then to whoever watches.
  const happened = async (record: Record, by: string | null = null) => {
    const seq = state.seq;
    const event = advance(world, state, record);
    journal.append([{ seq, record, event, by }]);
    await onEvent(event, by);
  };
  // One answer of a player's model, or null when the run ends here instead. Nobody is moved to another model.
  const ask = async (player: Required<Player>, content: Omit<Request, 'model'>): Promise<string | null> => {
    if (outcome.calls >= most) {
      outcome.reason = 'calls';
      return null;
    }
    let answer: Result;
    try { answer = await player.respond({ model: player.model, ...content }); } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      Object.assign(outcome, { status: 'failed', reason: error.code });
      return null;
    }
    for (const tally of [outcome, tallyOf(player)]) {
      tally.calls += 1;
      tally.inputTokens += answer.usage?.inputTokens ?? 0;
      tally.outputTokens += answer.usage?.outputTokens ?? 0;
    }
    return answer.text;
  };

  // One record at a time, in the order of the story's clock, and each step looks only at what the journal amounts to,
  // so a run that stops between any two steps continues as if it had not. Characters in different places who are free
  // at the same moment cannot perceive each other's actions, apart from a call: their calls to the model could run in
  // parallel here.
  for (;;) {
    const actor = next(state.people);
    const now = actor.freeAt, who = actor.id, mind = state.minds.get(who)!;
    outcome.seconds = Math.min(now, horizon) - stands;
    if (now >= horizon) return outcome;
    if (actor.place === null) {
      await happened({ kind: 'arrive', who, at: now });
      continue;
    }
    if (actor.asleep && !mind.lines.length) {
      await happened({ kind: 'wake', who, at: now });
      continue;
    }
    const system = systemOf(world, shared, who), player = playerOf(who);
    // A sleeper who is due to wake folds all it lived through before the sleep. Anyone else folds its oldest lines
    // while it holds more than the short-term memory may: this is what bounds a request whatever the model chooses.
    const folding = actor.asleep ? mind.lines : mind.size > world.shortWords ? oldest(mind, world.shortWords) : null;
    if (folding) {
      const request = { system, schema: MEMORY_SCHEMA,
        messages: [{ role: 'user' as const, content: [...known(mind, folding), rewriteOf(world, clockAt(world, now), actor.asleep)].join('\n') }] };
      // An answer that cannot be used gets one more try. After that the old text stays and the lines are lost.
      let memory = null;
      for (let attempt = 0; attempt < 2 && !memory; attempt += 1) {
        const answer = await ask(player, request);
        if (answer === null) return outcome;
        memory = readMemory(answer, world.longWords);
        if (!memory) unusable(player);
      }
      outcome.rewrites += 1;
      if (!memory) outcome.lost += 1;
      await happened({ kind: 'memory', who, at: now, text: memory?.text ?? null, upTo: folding.at(-1)!.seq, cut: memory?.cut ?? false }, player.name);
      continue;
    }
    const place = actor.place;
    // The people of a state stand in the world file's order.
    const others = world.characters.flatMap((character, index) => {
      const person = state.people[index];
      return person !== actor && person.place === place ? [`${tagged(character)}${person.asleep ? ', asleep' : ''}`] : [];
    });
    const limit = pause ? MAX_WORDS : wordLimit(world, horizon - now);
    const answer = await ask(player, { system, schema, messages: [{ role: 'user', content: [
      ...known(mind, mind.lines),
      `Now ${clockAt(world, now)}. You are in ${tagged(world.places.find(item => item.id === place)!)}. ${
        others.length ? `Here with you: ${others.join('; ')}.` : 'Nobody else is here.'}`,
      `Minutes from here: ${world.places.filter(item => item.id !== place).map(item => `${tagged(item)} ${travelSeconds(world, place, item.id) / 60}`).join(', ') || 'there is no other place'}.`,
      `This turn the \`text\` of a say or a call may hold ${limit} words at most.${
        pause ? '' : ` ${Math.floor((horizon - now) / 60)} min ${(horizon - now) % 60} s of the story are left.`}`,
    ].join('\n') }] });
    if (answer === null) return outcome;
    const action = readAction(world, actor, answer);
    if (typeof action === 'string') unusable(player);
    await happened({ kind: 'act', who, at: now, limit, action }, player.name);
  }
}
