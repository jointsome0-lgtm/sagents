import { ModelError } from './chatgpt.ts';
import type { Message, Request, Result } from './chatgpt.ts';
import { apply, arrive, clockAt, LOST_SECONDS, MAX_SECONDS, next, readAction, start, travelSeconds, wordLimit } from './world.ts';
import type { Action, Event, World } from './world.ts';

// The `live` mode: every character of a world is played by a model, one call for one action, under the story's clock.
// A character is sent its own sheet and what it perceived, and nothing else: no other character's sheet or note and no
// event it did not hear or see. There is no author above the characters and no memory beyond one run.
export const INSTRUCTIONS = `You are one person in a story that several people live through together. You are that person and not a narrator.

Each turn you take exactly one action and answer with one JSON object. Every field is there; a field the action does not use is null.
- say: you speak \`text\` aloud. Everyone in your place hears it.
- call: you speak \`text\` to the person \`to\` (an id) by the world's means of remote contact, if it has one. That person hears it wherever they are, and those in your place hear your half.
- go: you walk to \`place\` (an id). On the way you hear and see nothing and cannot act.
- do: you do something others can see, \`text\`, for \`seconds\` (1 to ${MAX_SECONDS}). Write what you do, not what comes of it.
- wait: you stay silent and attentive for \`seconds\` (1 to ${MAX_SECONDS}). Speech or movement near you ends the wait early.
- note: with any action, a private line you keep for yourself. Nobody else ever reads it. Null when you have none.

Speak the way people speak: briefly, one thought at a time, and leave room for an answer. Words cost the story's time: each takes part of a second, those who listen are held until you finish, and the story ends at a fixed moment. Each turn says how many words \`text\` may hold; a longer speech is cut there.

You know only your sheet and what you perceived, which is what your turns list. Nothing else is known to you. You may keep things to yourself, and you need not say what you want.

Do not describe what other people do, feel or answer, and do not decide for them. They act on their own turns.

Write \`text\` and \`note\` in the language of your sheet.`;
// The fixed sentences a turn may open with.
const UNUSABLE = `Your last answer could not be used and counted as a wait of ${LOST_SECONDS} seconds.`;
const CUT = 'Your last speech was longer than the limit: the others heard only its first words.';

const text = { type: ['string', 'null'] };
const schemaOf = (world: World) => ({ type: 'object', additionalProperties: false, required: ['action', 'text', 'to', 'place', 'seconds', 'note'],
  properties: { action: { type: 'string', enum: ['say', ...(world.remote === null ? [] : ['call']), 'go', 'do', 'wait'] }, text, to: text, place: text,
    seconds: { type: ['integer', 'null'] }, note: text } });

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
const tagged = ({ id, name }: { id: string; name: string }) => `${name} (${id})`;

// The same for every turn of one character, so that a server's prefix cache holds.
const systemOf = (world: World, id: string) => {
  const self = world.characters.find(character => character.id === id)!;
  return `${INSTRUCTIONS}

The world: ${world.title}
${world.about}

Places:
${world.places.map(place => `- ${tagged(place)}: ${place.about}`).join('\n')}

People:
${world.characters.map(character => `- ${tagged(character)}`).join('\n')}

${world.remote === null ? 'There is no means of remote contact: to reach someone, go where they are.' : `Means of remote contact: ${world.remote}.`}

You are ${tagged(self)}.
${self.sheet}`;
};

// An event as one who perceived it is told of it. A note is never part of it.
function perceived(world: World, event: Event, viewer: string): string {
  const who = named(world.characters, event.who);
  const what = event.kind === 'say' ? `${who} says: "${event.text}"`
    : event.kind === 'call' ? `${who} calls ${event.to === viewer ? 'you' : named(world.characters, event.to)} (${world.remote}): "${event.text}"`
      : event.kind === 'go' ? `${who} leaves towards ${named(world.places, event.to)}.`
        : event.kind === 'arrive' ? `${who} arrives.` : `${who} does: ${event.text} (${event.seconds} s)`;
  return `${event.clock} ${what}`;
}

// One event of a live run as lines for a person, or none for a wait that left no note. A note is the character's own
// and is marked as private: no other character was sent it.
export function linesOf(world: World, event: Event): string[] {
  const who = named(world.characters, event.who);
  const speech = `"${event.text}"${event.cut ? ' (cut)' : ''}`;
  const what = event.kind === 'say' ? `${who}: ${speech}`
    : event.kind === 'call' ? `${who} calls ${named(world.characters, event.to)}: ${speech}`
      : event.kind === 'go' ? `${who} leaves for ${named(world.places, event.to)} (${event.seconds} s)`
        : event.kind === 'arrive' ? `${who} arrives`
          : event.kind === 'do' ? `${who} does: ${event.text} (${event.seconds} s)` : `${who} waits (${event.seconds} s)`;
  return [...(event.kind === 'wait' && !event.note ? [] : [`${event.clock} [${named(world.places, event.place)}] ${what}`]),
    ...(event.note ? [`         private note of ${who}: ${event.note}`] : [])];
}

export type Live = { world: World; respond: (request: Request) => Promise<Result>; model: string; minutes?: number; calls?: number;
  onEvent?: (event: Event) => unknown };
// `reason` is `horizon` or `calls` for a run that ended as planned, and the failure's code for one that did not.
export type Outcome = { status: 'done' | 'failed'; reason: string; seconds: number; calls: number; invalid: number; inputTokens: number;
  outputTokens: number; events: Event[] };

// Plays the world until the story's horizon, the limit of model calls or a failure of the connection. `calls` counts
// the answers that arrived. A failure ends the run at once with the events so far: nothing is tried again.
export async function runLive({ world, respond, model, minutes = 30, calls: most = 60, onEvent = () => {} }: Live): Promise<Outcome> {
  const horizon = Math.round(minutes * 60);
  const people = start(world);
  const schema = schemaOf(world);
  // What each character knows: its chat so far, to which a turn only adds, and what it perceived since its last turn.
  const minds = new Map(people.map(person => [person.id, { system: systemOf(world, person.id), messages: [] as Message[], news: [] as string[], opening: '' }]));
  const outcome: Outcome = { status: 'done', reason: 'horizon', seconds: 0, calls: 0, invalid: 0, inputTokens: 0, outputTokens: 0, events: [] };
  const happened = async (event: Event) => {
    outcome.events.push(event);
    for (const id of event.heard) minds.get(id)!.news.push(perceived(world, event, id));
    await onEvent(event);
  };

  // One turn at a time, in the order of the story's clock. Characters in different places who are free at the same
  // moment cannot perceive each other's actions, apart from a call: their calls to the model could run in parallel here.
  for (;;) {
    const actor = next(people);
    const now = actor.freeAt;
    outcome.seconds = Math.min(now, horizon);
    if (now >= horizon) return outcome;
    if (outcome.calls >= most) return { ...outcome, reason: 'calls' };
    const mind = minds.get(actor.id)!;
    if (actor.place === null) {
      const { event, missed } = arrive(world, people, actor, now);
      await happened(event);
      mind.news.push(...missed.map(call => perceived(world, call, actor.id)));
    }
    const place = actor.place as string;
    const others = world.characters.filter(character => people.some(person => person.id === character.id && person !== actor && person.place === place));
    const limit = wordLimit(world, horizon - now);
    mind.messages.push({ role: 'user', content: [
      ...(mind.opening ? [mind.opening, ''] : []),
      ...(mind.news.length ? ['Since your last turn:', ...mind.news, ''] : []),
      `Now ${clockAt(world, now)}. You are in ${tagged(world.places.find(known => known.id === place)!)}. ${others.length ? `Here with you: ${others.map(tagged).join(', ')}.` : 'Nobody else is here.'}`,
      `Minutes from here: ${world.places.filter(known => known.id !== place).map(known => `${tagged(known)} ${travelSeconds(world, place, known.id) / 60}`).join(', ') || 'there is no other place'}.`,
      `This turn the \`text\` of a say or a call may hold ${limit} words at most. ${Math.floor((horizon - now) / 60)} min ${(horizon - now) % 60} s of the story are left.`,
    ].join('\n') });
    Object.assign(mind, { news: [], opening: '' });
    let answer: Result;
    try { answer = await respond({ model, system: mind.system, messages: [...mind.messages], schema }); } catch (error) {
      return { ...outcome, status: 'failed', reason: error instanceof ModelError ? error.code : 'internal_error' };
    }
    outcome.calls += 1;
    outcome.inputTokens += answer.usage?.inputTokens ?? 0;
    outcome.outputTokens += answer.usage?.outputTokens ?? 0;
    // The answer is kept as the character gave it, usable or not.
    mind.messages.push({ role: 'assistant', content: answer.text });
    const action = readAction(world, actor, answer.text);
    if (!action) outcome.invalid += 1;
    const lost: Action = { action: 'wait', text: null, to: null, place: null, seconds: LOST_SECONDS, note: null };
    const event = apply(world, people, actor, action ?? lost, now, limit);
    mind.opening = !action ? UNUSABLE : event.cut ? CUT : '';
    await happened(event);
  }
}
