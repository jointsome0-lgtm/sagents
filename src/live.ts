import { ModelError } from './chatgpt.ts';
import type { Request, Result } from './chatgpt.ts';
import { advance, memoryStore, replay, RESULT_WORDS, SAID_WORDS } from './journal.ts';
import type { Record, State, Store } from './journal.ts';
import { idle, oldest, readMemory } from './memory.ts';
import type { Line, Mind } from './memory.ts';
import { LAWS } from './laws.ts';
import { closed } from './reading.ts';
import { next, readAction, sleepersNear } from './action.ts';
import { readReply, readResult, refusal } from './answer.ts';
import type { Answer } from './answer.ts';
import { all, MAX_IN_PLACE, MAX_MOVES, MAX_ON_PERSON, MAX_SETS, MAX_STOCK, NAME_WORDS, RECORD, shown, SINKS, sought, written } from './things.ts';
import type { Refused, Thing } from './things.ts';
import { clockAt, DRIFT, hasClock, sensed, SENSED, travelSeconds, wordLimit } from './time.ts';
import { CHARS_PER_WORD, LIMITS, MAX_SECONDS, MAX_SLEEP, MAX_WORDS, namesOf } from './world.ts';
import type { Event, Person, Place, World } from './world.ts';

// The `live` mode: every character of a world is played by a model, one call for one action, under the story's clock.
// A character is sent its own sheet, what it remembers and what it perceived since, and nothing else: no other
// character's sheet, note or memory and no event it did not hear or see. There is no author above the characters.
// Everything that happens is a record in the journal (`journal.ts`), and a request is built from what the journal
// amounts to, so it has the same largest size however long the world has run.
export const INSTRUCTIONS = `You are one person in a story that several people live through together. You are that person and not a narrator.

Each turn you take exactly one action and answer with one JSON object. Every field is there; a field the action does not use is null.
- say: you speak \`text\` aloud. Everyone in your place hears it. With \`to\`, the id of one of the people of the place that a turn lists, you speak to that person, who may answer.
- call: you speak \`text\` to one person, \`to\` (that person's id), by the world's means of remote contact, if it has one. That person hears it wherever they are, and those in your place hear your half.
- go: you walk to another place of the list, \`place\` (its id). Moving about inside the place you are in is a do. On the way you hear and see nothing and cannot act.
- do: you do something others can see, \`text\`, for \`seconds\` (1 to ${MAX_SECONDS}). Write what you do, not what comes of it: the world tells you that. A do never takes you to another place: only a go does.
- wait: you stay silent and attentive for \`seconds\` (1 to ${MAX_SECONDS}). The wait ends at once when someone speaks near you, comes or leaves, or when something is heard from next door, so a long wait loses nothing: do not wait in short steps.
- sleep: you sleep for \`seconds\` (1 to ${MAX_SLEEP}), or \`until\` a time of day. Asleep you hear and see nothing, and only someone's deed can wake you before that time. A call to you, like a call to someone on the way, waits until you can hear it.
- until: for do, wait and sleep, in place of \`seconds\`: a time of day like 06:30, the next moment the clock shows it. It must fall within the action's span.
- note: with any action, a private line you keep for yourself. Nobody else ever reads it. Null when you have none.

Speak the way people speak: briefly, one thought at a time, and leave room for an answer. Words cost the story's time: each takes part of a second, and those who listen are held until you finish. Each turn says how many words \`text\` may hold; a longer speech is cut there. A note, and the \`text\` of a do, keep their first ${MAX_WORDS} words.

Each turn says the time. With a clock at hand, your own or one in the place you are in, it is the clock's time, and an action \`until\` a time of day ends at that time. With none you know only the part of the day, and such an action ends when you guess that the time has come: up to ${DRIFT.wait.most / 60} minutes early or late after an hour's wait, up to ${DRIFT.sleep.most / 60} after a night's sleep.

Each turn says how your body feels. People need sleep: an hour of it makes up for two awake, and one who stays awake too long falls asleep on the spot.

Each turn also says the weather as it reaches you where you are, what you see of those who are with you, how you are placed and what you carry: what you have in your hands or wear, and in square brackets after a thing what is in it or in its pockets, with \`×\` and a number where there are several. Of others you see what they carry and not what is inside it, unless it lies open. What you carry and how you are placed do not change by themselves or by words: to take, give, put down or hide a thing, to sit or lie down, do it, and the world tells you what came of it and what went from where to where. A line that begins \`You feel:\` is what your own body tells you, and nobody else is told it.

Speech is heard only in your own place and does not pass a door: a knock or a shout is a do, and the world says whether it is heard in the places next door, which the list of places names. A line \`From …, next door:\` is what you hear of such a deed done there, and it does not say who did it.

A turn may also list people of the place you are in: those around, and some by name with an id. They are not among the people of the list above and cannot be called. They stay where they are and do nothing unless someone speaks to them: to speak to one, say with \`to\`. What one of them answers, everyone in the place hears.

You know only your sheet, what you remember and what you perceived since, which is what a turn lists. Nothing else is known to you. You may keep things to yourself, and you need not say what you want.

Your memory is a text you write yourself. When you wake, and when much has happened, you are asked to write it anew from what it held and what happened since. What you leave out of it then is forgotten.

Do not describe what other people do, feel or answer, and do not decide for them. They act on their own turns.

Write \`text\`, \`note\` and your memory in the language of your sheet.`;

const text = { type: ['string', 'null'] };
// `place` is one of the world's places or null, so that a model held to the schema names no place that is not there.
const schemaOf = (world: World) => ({ type: 'object', additionalProperties: false, required: ['action', 'text', 'to', 'place', 'seconds', 'until', 'note'],
  properties: { action: { type: 'string', enum: ['say', ...(world.remote === null ? [] : ['call']), 'go', 'do', 'wait', 'sleep'] }, text, to: text, place: { ...text, enum: [...world.places.map(place => place.id), null] },
    seconds: { type: ['integer', 'null'] }, until: text, note: text } });
const MEMORY_SCHEMA = { type: 'object', additionalProperties: false, required: ['memory'], properties: { memory: { type: 'string' } } };

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
const tagged = ({ id, name }: { id: string; name: string }) => `${name} (${id})`;

// The system text has the part every character shares first, so that a server's prefix cache serves them all.
const sharedOf = (world: World) => `${INSTRUCTIONS}

The world: ${world.title}
${world.about}

Places:
${world.places.map(place => `- ${tagged(place)}: ${place.nextDoor.length ? `${closed(place.about)} Next door: ${place.nextDoor.map(id => named(world.places, id)).join(', ')}.` : place.about}`).join('\n')}

People:
${world.characters.map(character => `- ${tagged(character)}`).join('\n')}

${world.remote === null ? 'There is no means of remote contact: to reach someone, go where they are.' : `Means of remote contact: ${world.remote}.`}`;
const systemOf = (world: World, shared: string, id: string) => {
  const self = world.characters.find(character => character.id === id)!;
  return `${shared}

You are ${tagged(self)}.
${self.sheet}${self.looks === null ? '' : `\nHow you look: ${self.looks}`}`;
};

// What a character knows beyond its sheet, as a request opens with it: the long-term text, then the given lines.
const known = (mind: Mind, lines: Line[]) => [...(mind.long ? ['What you remember:', mind.long, ''] : []),
  ...(lines.length ? [mind.long ? 'Since then:' : 'So far:', ...lines.map(line => line.text), ''] : [])];
// The request to write the long-term memory anew. It keeps or drops: a memory must not gain what did not happen.
// It names a size below the limit to aim at, since a model that aims at the limit runs past it and loses the end. It
// orders the text so that the cut takes what matters least: what the character wants first, since a weak model lost it
// when it came last, then what later turns hang on, then people. Sums and times are asked for in figures, since a weak
// model that spelled them out in words kept none of them whole. This text was measured as it stands, as the fourth
// wording of the check of 2026-10-05, on two weak models over 25 rewrites of three synthetic stories each.
const MEMORY_AIM = 0.85;
const rewriteOf = (world: World, time: string, waking: boolean) => `${time} This is not a turn and you take no action: ${
  waking ? 'you are waking, and what you lived through before your sleep stays with you only as your memory' : 'much has happened, and its oldest part stays with you only as your memory'}.
Write your memory anew as one running text of about ${Math.floor(world.longWords * MEMORY_AIM)} words, in the language of your sheet, from what you remember and the lines above. The limit is ${world.longWords} words: a text past it is cut there, and its end is lost. Begin with what you want and what has changed in you, in one or two sentences. Then what will be needed later, with the figures, names and places as the lines give them: what is owed and to whom, what was promised and by when, sums agreed, times set, where a thing was put. Then what you know about people. Leave out passing chores, small talk and the prices of trifles that nothing hangs on. Write sentences, not a list, and do not number them. Write every sum and every time of day in figures, as the lines give it, never in words. Write in the past tense, as what has happened up to now. Do not say where you are or what you are doing at this moment: a turn says that. Record a deed as what you did, with its result only where the lines show one. Keep or drop, and add nothing that is not above. What you leave out is forgotten.
Answer with one JSON object that has the single field \`memory\`.`;

// How the world is told of things, for a deed and for a figure's answer alike.
const NOTATION = `Every thing here is listed once, under a label like t7. What a thing holds stands in square brackets after it: \`t8 parka [t9 cigarettes ×17; t10 lighter]\`. \`×17\` is how many there are, and a thing with no number is one. Empty brackets mean a thing that can hold others and holds nothing now; a thing with no brackets never holds anything. Under \`Things here\` is what stands or lies in the place. After \`Carries\` is what a person has in their hands or wears, in sight; what is in the brackets of such a thing is in its pockets or inside it, out of sight unless the thing is \`open\`. Marks after a thing: \`fixed\`, a part of the place, never moved; \`open\`, what it holds is in plain sight; \`stock\`, a supply with no count, which taking does not use up; \`food\`, it can be eaten or drunk; \`burns\`, it can burn up; \`fire\`, it can set things alight; \`state\`, how it is now, and in brackets the states it can have. Under \`Facts of things\`, after the lists, is what is true of a thing and is not seen at once, each line under the label of its thing.`;
// What the world is told to be when it is asked what came of a deed. It is sent facts, bodies and things and no
// person's sheet, note, memory or speech, and what it answers is held to the people, the place and the things the
// rules know. This text has changed since it was measured and is to be measured anew: it now tells of the facts of
// things, of the places next door and of the field `beyond`, `wakes` reaches next door, and the point on `feels` says
// how an entry begins and gives none for the ordinary handling of a thing. What was measured is
// form `A1f` of the check of 2026-10-05, the text without those, on a strong model and
// on two weak ones: over the deeds done to a body every entry of `feels` that was due was there in 25 answers of 25
// on each, none was for one who only watched, both deeds that only look or speak gave none, and the entries for
// things were no worse than without the field. It is form `A1` with that field, and of `A1` two forms with more
// hints did no better on a weak model and one did harm. A change of it is a new text to measure, and the harness of
// that check compares the two.
export const WORLD_INSTRUCTIONS = `You are the world of a story: not a person in it and not a narrator. Someone does something, and you say what comes of it.

You are told what is there, and nothing else exists: a search for something you were not told of finds nothing of the kind. Say what is there as the world itself. Never speak of facts, of what was mentioned or listed, of labels and marks, or of your task.

You are told the weather so that you know it, not to report it. A result speaks of the weather only when the deed meets it: someone steps out into it, opens a door or a window to it, looks or listens for it.

You are told which other places there are. Nobody gets to another place by a deed: whoever tries is still here, by the way out, and the result says only that. A pose never names another place.

You may be told which places are next door, behind a door or a thin wall, and who is in each, awake or asleep. Those people are not here: they see nothing of the deed, no entry of \`poses\` or \`feels\` is for them, and what they hear of it goes to \`beyond\`.

${NOTATION}

The lists are the truth about where each thing is, and what an earlier result says of a thing may be out of date. You keep no count and rewrite no list: you say which things the deed moved, by label, and the lists are kept from that. A thing never appears from nowhere and never vanishes: it stays where it is listed unless an entry of yours moves it. A deed that only looks, listens or speaks moves nothing. A deed that needs a thing that is not here moves nothing either, and the result says what was seen of that.

Answer with one JSON object, its fields in this order.
- search: true when the deed is a search of the place: someone looks through it, under and behind what is there, for one thing or for whatever there is. False for any other deed, a look around included.
- finds: the labels of the hidden things that the deed goes straight to, or an empty list.
- moves: what the deed moved, or an empty list. An entry has \`what\`, \`n\` and \`to\`. It says where a thing ends up and not the way it went: money taken out of a pocket and handed over is one entry, to the one who got it. \`what\` is the label of the thing. \`n\` is how many of it go: 1 for a thing with no number; for a thing with a number, the part that the deed names, or the whole number when all of it goes; for a stock, how many are taken. \`to\` is where it ends up: the id of a person here, in that person's hands or on them; the id of this place, lying here in sight; the label of a thing with brackets, in it or on it; \`eaten\`, when the one who does the deed eats or drinks it up; \`burned\`, when it burns up, which takes a \`fire\` here. A thing goes with all that it holds, as one entry: never list what is inside a thing that moves. Never list a thing that stays where it is.
- sets: the things whose state the deed changed, or an empty list. An entry has \`what\`, the label of a thing with a \`state\` mark, and \`state\`, one of the states in its brackets.
- poses: the pose of each person here whose pose the deed changed, or an empty list. An entry has \`of\`, the id of the person, and \`text\`: how and where in the place the person now is, 20 words at most, in the language of the world's description. A pose names no thing that is held or worn: the lists say that.
- wakes: the ids of the sleepers here or next door whom the deed wakes, or an empty list. A sleeper breathes and is alive unless the facts say otherwise. Touch, shaking or a loud noise right by a sleeper wakes them; quiet steps do not. A sleeper next door is woken only by what \`beyond\` says is heard there, when it is loud enough to wake.
- feels: what the deed makes a person here feel in their own body, or an empty list. An entry has \`of\`, the id of a person who is awake, and \`text\`: what that body feels, 20 words at most, in the language of the world's description. Only that person is told it, right after the words \`You feel:\`, so the text begins with what is felt and never names the person or says that they feel. An entry is due where the deed does something to a body: effort, a pose held long, a blow, the touch of another body, heat, cold, food, drink, smoke. One who is touched feels it, and so does the one who touches. When hands feel a body or a thing to judge it, the entry of their owner says what they find, in keeping with what you were told of that body or thing. Name what the body registers, such as pressure, weight, warmth, cold, pain, stretch, tiredness, breath, heartbeat or taste, never what the person thinks or wants, whether they like it, or what they do next. A deed that only looks, listens or speaks gives no entry, and one who only watches gets none. The ordinary handling of a thing, taking it, carrying it, putting it down or handing it over, gives no entry either.
- beyond: what of the deed is heard in the places next door, in one sentence of ${LIMITS.beyond} words at most, in the language of the world's description, or null when nothing carries that far, as with most deeds, and always when you are told of no place next door. A knock at a door or on a wall, a shout, a crash or a door slammed is heard there; steps, quiet talk and the handling of things are not. It says the sound and not who made it, unless it is a voice, and then with its words.
- result: what the senses give as the direct result of the deed, in one or two plain sentences, in the language of the world's description. It never retells the deed: when there is nothing to notice beyond the deed itself, it is null. Say only what anyone here could see, hear or smell, never what one body alone feels, which goes to \`feels\`, and never what anyone thinks, says or does next: people who are awake answer on their own turns. It agrees with \`moves\` and \`sets\`: no thing changes hands, place or state in it without an entry there. It gives no numbers of things or of money.

You may be told what is hidden here, each thing under its label. A hidden thing is seen by nobody, and no result, pose or entry of \`feels\` speaks of it or hints at it, whoever looks and wherever, until it is found. It is found in two ways. By a search that has lasted long enough: you are told which things this deed finds if it is a search, and you never decide whether a search has been long enough. Or by a deed that goes straight to the very spot named for it, however short the deed is: its label then goes into \`finds\`. A deed that names another spot, or names the thing and not the spot where it lies, does not go straight to it. When a thing is found either way, the result says where it turned up and what is seen of it, and from then on it lies in the place in sight. Only a deed that finds a hidden thing can move it or what it holds.`;
// What the world is told to be when it is asked what a figure answers: someone of a place whom nobody plays.
export const FIGURE_INSTRUCTIONS = `You are the world of a story: not a narrator and not one of the people who live in it. In a place there are people whom nobody plays: those around, and some with a name. Someone has spoken to one of them, and you say what that one answers.

You are told what is there, and nothing else exists. The one who answers knows what its own facts say, what anyone in the place sees and hears, and what was said to the people of the place before. It does not know what others carry out of sight or what their facts say: you are told those so that the answer does not go against them. Never speak of facts, of labels and marks, or of your task.

${NOTATION}

The people whom nobody plays carry nothing of their own: what they have at hand is among the things of the place. The lists are the truth about where each thing is. A thing never appears from nowhere and never vanishes: it stays where it is listed unless an entry of yours moves it.

Answer with one JSON object, its fields in this order.
- reply: what that person says aloud, as such a person would say it, in the language of the world's description, ${MAX_WORDS} words at most. Speech only: no gestures and no thoughts. It answers what was said, briefly, and starts nothing of its own; it does not leave, follow anyone or speak for anyone else. Null when it says nothing.
- moves: what the one who answers hands over or takes while speaking, or an empty list. An entry has \`what\`, \`n\` and \`to\`. \`what\` is the label of the thing. \`n\` is how many of it go: 1 for a thing with no number; for a thing with a number, the part that goes, or the whole number when all of it goes; for a stock, how many are taken. \`to\` is where it ends up: the id of a person here, in that person's hands or on them; the id of this place; the label of a thing with brackets, in it or on it. A thing goes with all that it holds, as one entry: never list what is inside a thing that moves.`;
// The one sentence an answer that the rules of things refused is asked again with: the entry and the cause, in the
// words of the text above and never as a code.
const CAUSES = {
  what: '`what` is not the label of a thing here',
  hidden: 'it names a hidden thing or what such a thing holds, and nothing in the answer finds that thing',
  fixed: 'a `fixed` thing is a part of the place and is never moved',
  n: `\`n\` is 1 for a thing with no number, no more than the number of a thing that has one, and ${MAX_STOCK} at most from a stock`,
  to: '`to` is not the id of a person here, the id of this place or the label of a thing with brackets, nor a way for a thing to leave the world that is open here; a thing left on the floor or the ground goes to the id of this place',
  inside: 'a thing cannot end up in itself or in what it holds, nor more than four things deep; a thing left on the floor or the ground goes to the id of this place',
  sink: 'only a thing marked `food` is `eaten`, and only a thing marked `burns` is `burned`, with a `fire` here',
  full: `a person carries ${MAX_ON_PERSON} things at most and a place holds ${MAX_IN_PLACE}, with all that they hold`,
  same: '`to` of this entry is where the thing already is, so nothing moved: an entry says where a thing ends up, and a thing that stays is not listed; a thing left on the floor or the ground goes to the id of this place',
  state: '`state` must be one of the states in the brackets of the `state` mark of that thing',
};
const againOf = ({ code, entry }: Refused) => `Your answer to this was not taken and nothing of it happened, because of the entry ${JSON.stringify(entry)}: ${CAUSES[code]}. Answer again.`;
export const worldSystemOf = (world: World) => `${WORLD_INSTRUCTIONS}

The world: ${world.title}
${world.about}${world.facts === null ? '' : `\nFacts: ${world.facts}`}`;
// The time as a request to a resident opens its last part with it: the clock when the resident has one at hand, and
// the part of the day otherwise.
const nowOf = (world: World, actor: Person, at: number) => hasClock(world, actor.id, actor.place) ? `Now ${clockAt(world, at)}.`
  : `Now ${sensed(world, at, world.places.some(place => place.id === actor.place && place.open))}, as far as you can tell: no clock is at hand.`;
// One text under its name, closed as a sentence, or nothing when there is none.
const part = (name: string, value: string | null) => value === null ? '' : ` ${name}: ${closed(value)}`;
// What anyone in a person's place sees of its body.
const seen = (character: { looks: string | null }, person: Person) => `${part('Looks', character.looks)}${part('Pose', person.pose)}`;
// The things of a place as the world is told of them, each under its label with all that it holds, and what a
// person carries, after that person's looks and pose. The harness of the check that measured the world's text
// compares these two with its own.
export const thingsOf = (things: Thing[]) => things.length ? ['Things here:', ...things.map(thing => `- ${written(thing)}`)] : ['Things here: nothing.'];
export const carriedOf = (things: Thing[]) => ` Carries: ${things.map(written).join('; ') || 'nothing'}.`;

// What an answer may name in a place, in the order the request lists it: the things in sight, the hidden ones when
// the answer is a deed's, and what the people there carry. A thing that holds others is where a thing can be put.
// A deed's answer may wake a sleeper next door too. `facts` are the lines of what is true of those things, each
// under its label: the world is told the facts of every thing its request lists, wherever the thing has got to.
function namedOf(state: State, place: Place, deed: boolean) {
  const lies = state.things.places.get(place.id)!, people = state.people.filter(person => person.place === place.id);
  const things = all([...lies.filter(thing => !thing.hidden), ...(deed ? lies.filter(thing => thing.hidden) : []), ...people.flatMap(person => state.things.people.get(person.id)!)]);
  return { what: things.filter(thing => !thing.fixed).map(thing => thing.label),
    to: [...people.map(person => person.id), place.id, ...things.filter(thing => thing.holds).map(thing => thing.label),
      ...(deed ? SINKS.filter(sink => things.some(thing => sink === 'eaten' ? thing.food !== null : thing.burns)) : [])],
    stated: things.filter(thing => thing.states).map(thing => thing.label), states: [...new Set(things.flatMap(thing => thing.states ?? []))],
    of: people.map(person => person.id), awake: people.filter(person => !person.asleep).map(person => person.id), finds: lies.filter(thing => thing.hidden).map(thing => thing.label), wakes: sleepersNear(state.people, place).map(person => person.id),
    facts: things.flatMap(thing => thing.facts === null ? [] : [`- ${thing.label}: ${closed(thing.facts)}`]) };
}
// A string that is one of a list, or any string when the list is empty: a strict schema may refuse an empty list.
const oneOf = (list: string[]) => list.length ? { type: 'string', enum: list } : { type: 'string' };
const entries = (properties: object) => ({ type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } });
// The schema of the world's answer is made for each request, so that a model held to it names no label, id or
// state that is not there where a list has entries; an empty list takes any string, and the rules drop or refuse
// what the schema lets through. Its fields stand with the entries before the words, so that the words are written after them and cannot lead them;
// both orders passed the check of 2026-10-05 on the weak local model.
const resultSchemaOf = (state: State, place: Place) => {
  const names = namedOf(state, place, true);
  const properties = { search: { type: 'boolean' }, finds: { type: 'array', items: oneOf(names.finds) },
    moves: entries({ what: oneOf(names.what), n: { type: 'integer' }, to: oneOf(names.to) }), sets: entries({ what: oneOf(names.stated), state: oneOf(names.states) }),
    poses: entries({ of: oneOf(names.of), text: { type: 'string' } }), wakes: { type: 'array', items: oneOf(names.wakes) }, feels: entries({ of: oneOf(names.awake), text: { type: 'string' } }), beyond: text, result: text };
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
};
const replySchemaOf = (state: State, place: Place) => {
  const names = namedOf(state, place, false);
  return { type: 'object', additionalProperties: false, required: ['reply', 'moves'],
    properties: { reply: text, moves: entries({ what: oneOf(names.what), n: { type: 'integer' }, to: oneOf(names.to) }) } };
};

// Everyone of the list who is in a place, as the world is told of them: with all they carry and with facts.
const hereOf = (world: World, state: State, place: Place) => world.characters.flatMap((character, index) => {
  const person = state.people[index];
  return person.place !== place.id ? [] : [`- ${tagged(character)}, ${person.asleep ? 'asleep' : 'awake'}.${seen(character, person)}${
    carriedOf(state.things.people.get(person.id)!)}${part('Facts', character.facts)}`];
});
// What the world is reminded of when it answers in a place, for a deed and for a figure alike: what came of the
// latest deeds there, in its own words and in what the rules moved, and what was said to the figures of the place and answered.
const earlierOf = (state: State, place: Place) => {
  const results = state.results.get(place.id)!, said = state.said.get(place.id)!;
  return [...(results.length ? ['What came of earlier deeds here:', ...results.map(line => line.text)] : []),
    ...(said.length ? ['What was said to the people of this place before:', ...said.map(line => line.text)] : [])];
};
// The people of a place whom nobody plays, as the world is told of them.
const crowdOf = (place: Place) => [...(place.crowd === null ? [] : [`Around, played by nobody: ${closed(place.crowd)}`]),
  ...(place.figures.length ? ['Of this place, played by nobody:', ...place.figures.map(figure => `- ${tagged(figure)}.${part('Looks', figure.looks)}${part('Facts', figure.facts)}`)] : [])];
// The place as the world is told of it, with the things that lie in it in sight.
const placeOf = (state: State, place: Place) => [`The place: ${tagged(place)}, ${place.open ? 'under the open sky' : 'under a roof'}. ${place.about}${part('Facts', place.facts)}`,
  ...thingsOf(state.things.places.get(place.id)!.filter(thing => !thing.hidden))];
// The facts of the things that a request lists, in lines of their own after the lists, so that a long text does not
// stand in the notation.
const factsOf = (state: State, place: Place, deed: boolean) => { const { facts } = namedOf(state, place, deed); return facts.length ? ['Facts of things:', ...facts] : []; };
// One speech to a figure as the world is asked what the figure answers: the place, who is there, the people of the
// place, the facts of the things listed, what came of earlier deeds there, what was said to the figures before and answered, and the speech.
function replyOf(world: World, state: State, said: Event): string {
  const place = world.places.find(item => item.id === said.place)!;
  return [...placeOf(state, place),
    ...LAWS.flatMap(law => law.world?.(world, state.laws, place) ?? []), 'Here:', ...hereOf(world, state, place), ...crowdOf(place),
    ...factsOf(state, place, false), ...earlierOf(state, place),
    `Now ${said.clock}. ${named(world.characters, said.who)} says to ${tagged(place.figures.find(figure => figure.id === said.to)!)}: "${said.text}"`,
    `What does ${named(place.figures, said.to)} answer?`].join('\n');
}

// One deed as the world is asked about it: the place and its things, what is hidden there, the other places by name,
// who is in each place next door, by name and awake or asleep and nothing more,
// who is there with what they carry, the facts of the things listed, what came of earlier deeds there, what was said to the figures of the place and
// answered, and the deed. The rules know how long the deed lasts, so they say which of the hidden things of the
// place it finds if the world calls it a search; whether the deed goes straight to one is the world's to say.
function deedOf(world: World, state: State, deed: Event): string {
  const place = world.places.find(item => item.id === deed.place)!;
  const { found } = sought(state.things, deed);
  return [...placeOf(state, place),
    ...state.things.places.get(place.id)!.filter(thing => thing.hidden).map(thing => `Hidden here (${thing.label}). This deed finds it ${found.includes(thing)
      ? 'if it is a search of the place, or if it goes straight to the spot named' : 'only if it goes straight to the spot named, and not by searching'}: ${thing.hidden!.spot}: ${written(thing)}`),
    ...(world.places.length > 1 ? [`Other places, which nobody reaches by a deed: ${world.places.filter(item => item !== place).map(tagged).join(', ')}.`] : []),
    ...(place.nextDoor.length ? ['Next door:', ...place.nextDoor.map(id => `- ${tagged(world.places.find(item => item.id === id)!)}: ${world.characters.flatMap((character, index) =>
      state.people[index].place === id ? [`${tagged(character)}, ${state.people[index].asleep ? 'asleep' : 'awake'}`] : []).join('; ') || 'nobody'}.`)] : []),
    ...LAWS.flatMap(law => law.world?.(world, state.laws, place) ?? []), 'Here:', ...hereOf(world, state, place), ...crowdOf(place),
    ...factsOf(state, place, true), ...earlierOf(state, place),
    `Now ${deed.clock}. ${named(world.characters, deed.who)} does, for ${deed.seconds} s: ${deed.text}`, 'What comes of it?'].join('\n');
}

// No request of a world is longer than this many characters, system text and message together, however long the
// world has run. A line holds a speech, a note or a deed of `MAX_WORDS` words under a head of names and a time, a
// character's own action is four lines at most with what came of it and a fifth of what its body felt, and the lines of one request are `shortWords` and one such action.
// A pose is as long as its limit of words lets it be, since the world's answer may make it so, a person carries and
// a place holds as many records as the rules of things let them, each as long as a record can be, and every law adds
// what it says it may. One answer of the world adds one line of what it moved, set and found, and one of what was heard next door.
// The facts of a thing are listed once wherever the thing is, and those of a counted thing or a stock go with every
// part taken off it, so each record that one request can list may have the longest of such facts.
export function requestLimit(world: World): number {
  const longest = (texts: string[]) => Math.max(...texts.map(item => item.length));
  const people = world.characters.map(tagged), places = world.places.map(tagged);
  const looks = (character: { looks: string | null }) => (character.looks?.length ?? 0) + 20;
  const system = sharedOf(world).length + longest(people) + longest(world.characters.map(character => character.sheet)) + Math.max(...world.characters.map(looks)) + 40;
  const head = 2 * longest(namesOf(world).map(character => character.name)) + longest(world.places.map(place => place.name)) + (world.remote?.length ?? 0) + SENSED + 140;
  const spots = Math.max(...world.places.map(place => place.things.reduce((sum, thing) => sum + (thing.hidden ? thing.hidden.spot.length + 160 : 0), 0)));
  const told = (MAX_MOVES + MAX_SETS) * (3 * NAME_WORDS * CHARS_PER_WORD + 80) + spots + MAX_IN_PLACE * NAME_WORDS * CHARS_PER_WORD;
  const lines = (world.shortWords + 4 * (head + MAX_WORDS) + head + LIMITS.feels + head + LIMITS.beyond) * (CHARS_PER_WORD + 1) + told;
  const laws = LAWS.reduce((sum, law) => sum + law.size(world), 0);
  const visible = LIMITS.pose * CHARS_PER_WORD + MAX_ON_PERSON * RECORD + 60;
  // The people of one place whom nobody plays, as a request lists them: for the world with their facts.
  const local = (withFacts: boolean) => Math.max(...world.places.map(place => (place.crowd?.length ?? 0) + 150
    + place.figures.reduce((sum, figure) => sum + tagged(figure).length + looks(figure) + (withFacts ? (figure.facts?.length ?? 0) + 20 : 0) + 20, 0)));
  const now = [...people, ...places].reduce((sum, item) => sum + item.length + 30, 0) + longest(places) + SENSED + 900
    + world.characters.reduce((sum, character) => sum + looks(character) + visible, 0) + laws + local(false);
  const resident = system + world.longWords * CHARS_PER_WORD + lines + now + rewriteOf(world, '', true).length + 200;
  // The world's request: every person could be in one place, each with its body, what it carries and facts, under the
  // things, what is hidden, the results and the exchanges with its figures that the place keeps, the newest result
// with what the rules moved, and the weather.
  // An answer that the rules refused is asked again with one sentence more.
  const facts = (item: { facts: string | null }) => (item.facts?.length ?? 0) + 40;
  const lore = all([...world.places.flatMap(place => place.things), ...world.characters.flatMap(character => character.carries)]).filter(thing => thing.facts !== null);
  const parted = lore.filter(thing => thing.n !== null || thing.stock);
  const ofThings = lore.reduce((sum, thing) => sum + facts(thing), 0) + (parted.length ? (MAX_IN_PLACE + world.characters.length * MAX_ON_PERSON) * Math.max(...parted.map(facts)) : 0);
  const deed = worldSystemOf(world).length
    + Math.max(...world.places.map(place => tagged(place).length + place.about.length + facts(place) + 40)) + spots
    + MAX_IN_PLACE * RECORD
    + 2 * places.reduce((sum, item) => sum + item.length + 20, 0) + people.reduce((sum, item) => sum + item.length + 12, 0) + 80 + ofThings
    + world.characters.reduce((sum, character) => sum + tagged(character).length + facts(character) + looks(character) + visible + 40, 0)
    + (RESULT_WORDS + SAID_WORDS + 4 * (head + 2 * MAX_WORDS)) * (CHARS_PER_WORD + 1) + told + laws + local(true) + 1200;
  // A figure's answer is asked for with the same place, people and reminders, without what is hidden.
  const answer = deed + FIGURE_INSTRUCTIONS.length - WORLD_INSTRUCTIONS.length;
  return Math.max(resident, deed, answer);
}

// One event of a live run as lines for a person, or none for a wait that left no note. A note, a memory and what a
// body feels are the character's own and are marked as private: no other character was sent them. What was heard
// next door is one line under the result.
export function linesOf(world: World, event: Event): string[] {
  const who = named(namesOf(world), event.who);
  const speech = `"${event.text}"${event.cut ? ' (cut)' : ''}`;
  const what = event.kind === 'say' ? `${who}${event.to === null ? '' : ` to ${named(namesOf(world), event.to)}`}: ${speech}`
    : event.kind === 'reply' ? event.text === null ? `${who} does not answer ${named(world.characters, event.to)}` : `${who} answers ${named(world.characters, event.to)}: ${speech}`
    : event.kind === 'call' ? `${who} calls ${named(world.characters, event.to)}: ${speech}`
      : event.kind === 'go' ? `${who} leaves for ${named(world.places, event.to)} (${event.seconds} s)`
        : event.kind === 'arrive' ? `${who} arrives`
          : event.kind === 'sleep' ? `${who} falls asleep (${event.seconds} s)`
            : event.kind === 'wake' ? `${who} wakes`
              : event.kind === 'memory' ? `private memory of ${who}${event.cut ? ' (cut)' : ''}: ${
                event.text?.replaceAll('\n', '\n         ') ?? 'the rewrite was lost, and what it was to hold is forgotten'}`
                : event.kind === 'weather' ? `the weather changes: ${event.text}${event.indoors == null ? '' : ` Under a roof: ${event.indoors}`}`
                : event.kind === 'result' ? `what came of what ${who} did: ${event.text ?? 'nothing that could be noticed'}${
                  event.wakes?.length ? ` (wakes ${event.wakes.map(id => named(world.characters, id)).join(', ')})` : ''}${event.search ? ' (a search)' : ''}`
                  : event.kind === 'do' ? `${who} does (${event.seconds} s): ${event.text}` : `${who} waits (${event.seconds} s)`;
  return [...(event.kind === 'wait' && !event.note ? [] : [`${event.clock} ${event.place ? `[${named(world.places, event.place)}] ` : ''}${what}`]),
    ...(event.found ?? []).map(thing => `         found: ${thing.what} ${thing.name} (${thing.spot})`),
    ...(event.moved ?? []).map(posting => `         moved: ${posting.what} ${posting.name}${posting.n === null ? '' : ` ×${posting.n}`}, ${posting.from} -> ${posting.to}${
      posting.as === null || posting.as === posting.what ? '' : ` as ${posting.as}`}`),
    ...(event.set ?? []).map(thing => `         state: ${thing.what} ${thing.name}, ${thing.state}`),
    ...(event.poses ?? []).map(pose => `         pose of ${named(world.characters, pose.of)}: ${pose.text || 'none'}`),
    ...(event.feels ?? []).map(feeling => `         private feeling of ${named(world.characters, feeling.of)}: ${feeling.text}`),
    ...(event.beyond == null ? [] : [`         heard next door: ${event.beyond}`]),
    ...(event.note ? [`         private note of ${who}: ${event.note}`] : [])];
}

// `journal` is where the world's records are kept and read from: a run continues the world it finds there. `pause`
// says that this run's end is not the story's: then nobody is told how much is left and speech does not shorten
// towards the end. `minutes` count from where the world stands.
// A connection and the model to ask of it. `name` is the model's name as it was given, which the journal and the
// totals keep; it is `model` when it is not given.
export type Player = { respond: (request: Request) => Promise<Result>; model: string; name?: string };
// `respond`, `model` and `name` play everyone whom `cast` does not name by id. `onEvent` is given the event and the
// name of the model whose answer it came of, or null. `worldPlayer` answers what came of a deed, and is the same
// player as everyone's when it is not given. `cutRun` is how many answers of one model cut short at its limit, one
// after another, end a run: 3 when it is not given.
export type Live = Player & { world: World; cast?: { [id: string]: Player }; worldPlayer?: Player; minutes?: number; calls?: number;
  onEvent?: (event: Event, by: string | null) => unknown; journal?: Store; pause?: boolean; cutRun?: number };
export type Tally = { calls: number; invalid: number; overlong: number; unreported: number; inputTokens: number; cachedInputTokens: number; outputTokens: number };
// What a request was for: a resident's turn, a memory written anew, or an answer of the world, to a deed or for a figure.
export type Asked = 'turn' | 'memory' | 'world';
export type Spent = Pick<Tally, 'calls' | 'inputTokens' | 'cachedInputTokens' | 'outputTokens'>;
// `reason` is `horizon` or `calls` for a run that ended as planned, and the failure's code for one that did not.
// `seconds` is the story time this run played. `rewrites` counts the memories written anew and `lost` those of them
// whose answer could not be used twice, so that the lines they were to keep are forgotten. `invalid` counts every
// answer that could not be used, whatever was asked, and `overlong` those of them that the model's own limit of one
// answer cut short, for which no tokens are known. `unreported` counts the answers that arrived whole and came with no
// usage, so that the tokens are the sum over the others and not a total that looks whole. `cachedInputTokens` are those of the input tokens that the service says it read from its cache. `models` holds the same counts for each model's name,
// and `kinds` the calls and the tokens by what a request was for, so that a resident's turn is told from the world's answer when one model gives both.
// `refused` counts the answers of the world that could be read and that the rules of things did not take, and `void`
// the deeds and speeches to figures that nothing came of because neither of the two answers asked for could be used
// or taken.
export type Outcome = Tally & { status: 'done' | 'failed'; reason: string; seconds: number; rewrites: number; lost: number; refused: number; void: number;
  models: { [name: string]: Tally }; kinds: { [kind in Asked]: Spent } };

const CUT = Symbol('cut');
const spent = (): Spent => ({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
// Plays the world on from its journal until the horizon, the limit of model calls or a failure of the connection.
// `calls` counts the answers that arrived or were cut short at the model's limit, a memory's as well as a turn's. Any
// other failure ends the run at once: nothing is tried again, and the journal holds everything up to it.
export async function runLive({ world, respond, model, name, cast = {}, worldPlayer, minutes = 30, calls: most = 60, onEvent = () => {}, journal = memoryStore(),
  pause = false, cutRun = 3 }: Live): Promise<Outcome> {
  const state = replay(world, journal.entries());
  const stands = next(state.people).freeAt;
  const horizon = stands + Math.round(minutes * 60);
  const schema = schemaOf(world), shared = sharedOf(world);
  const outcome: Outcome = { status: 'done', reason: 'horizon', seconds: 0, calls: 0, invalid: 0, overlong: 0, unreported: 0, rewrites: 0, lost: 0, refused: 0, void: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    models: {}, kinds: { turn: spent(), memory: spent(), world: spent() } };
  // Who plays whom. Every request of a character, a turn or a memory, goes to its own connection under its own model.
  const everyone = { respond, model, name: name ?? model };
  const playerOf = (id: string) => { const player = Object.hasOwn(cast, id) ? cast[id] : everyone; return { ...player, name: player.name ?? player.model }; };
  // A tally is the totals' own property under the model's name, whatever the name: one like `constructor` finds nothing that every object has.
  const tallyOf = (player: { name: string }) => {
    if (!Object.hasOwn(outcome.models, player.name)) {
      Object.defineProperty(outcome.models, player.name, { value: { invalid: 0, overlong: 0, unreported: 0, ...spent() }, enumerable: true, writable: true, configurable: true });
    }
    return outcome.models[player.name];
  };
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
  // An answer that the model's own limit cut short is `CUT`: it was asked for and counts as a call, it cannot be used,
  // and the run goes on as after any answer that cannot, until `cutRun` answers of one model's name have been cut
  // with none of its answers arriving whole in between: a model that only writes to its limit would spend every
  // call the run has. Every other failure of the connection ends the run.
  const cuts = new Map<string, number>();
  const ask = async (player: Required<Player>, kind: Asked, content: Omit<Request, 'model'>): Promise<string | typeof CUT | null> => {
    if (outcome.calls >= most) {
      outcome.reason = 'calls';
      return null;
    }
    let answer: Result;
    try { answer = await player.respond({ model: player.model, ...content }); } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      if (error.code === 'output_limit') {
        for (const tally of [outcome, tallyOf(player)]) {
          tally.calls += 1;
          tally.overlong += 1;
        }
        outcome.kinds[kind].calls += 1;
        cuts.set(player.name, (cuts.get(player.name) ?? 0) + 1);
        if (cuts.get(player.name)! < cutRun) return CUT;
        // The cut that ends the run cannot be used either, and no caller is left to count it.
        unusable(player);
      }
      Object.assign(outcome, { status: 'failed', reason: error.code });
      return null;
    }
    cuts.delete(player.name);
    for (const tally of [outcome, tallyOf(player)]) if (!answer.usage) tally.unreported += 1;
    for (const tally of [outcome, tallyOf(player), outcome.kinds[kind]]) {
      tally.calls += 1;
      tally.inputTokens += answer.usage?.inputTokens ?? 0;
      tally.cachedInputTokens += answer.usage?.cachedInputTokens ?? 0;
      tally.outputTokens += answer.usage?.outputTokens ?? 0;
    }
    return answer.text;
  };

  // One record at a time, in the order of the story's clock, and each step looks only at what the journal amounts to,
  // so a run that stops between any two steps continues as if it had not. Characters in different places who are free
  // at the same moment cannot perceive each other's actions, apart from a call: their calls to the model could run in
  // parallel here.
  const judge = { ...(worldPlayer ?? everyone), name: worldPlayer ? worldPlayer.name ?? worldPlayer.model : everyone.name };
  const worldSystem = worldSystemOf(world), figureSystem = `${FIGURE_INSTRUCTIONS}\n\n${worldSystem.slice(WORLD_INSTRUCTIONS.length + 2)}`;
  // The world's answer to a deed or for a figure: `read` gives it as it can be taken, or null. An answer that cannot
  // be used is asked for once more as it was, and one that the rules of things refuse once more with the sentence
  // that says why. After the second nothing came of the deed. A refused answer never reaches the journal.
  const answered = async <Came extends Partial<Answer> & { moves: Answer['moves'] }>(deed: Event, system: string, schema: object, content: string, read: (answer: string) => Came | null) => {
    let came: Came | null = null, again = '';
    for (let attempt = 0; attempt < 2 && !came; attempt += 1) {
      const answer = await ask(judge, 'world', { system, schema, messages: [{ role: 'user', content: `${content}${again}` }] });
      if (answer === null) return null;
      came = answer === CUT ? null : read(answer);
      const refused = came && refusal(world, state.people, state.things, deed, came);
      if (!came) unusable(judge);
      if (refused) {
        outcome.refused += 1;
        [came, again] = [null, `\n${againOf(refused)}`];
      }
    }
    if (!came) outcome.void += 1;
    return { came };
  };
  for (;;) {
    const deed = state.deed;
    if (deed?.kind === 'say') {
      // A speech to a figure waits for the figure's answer, which the world gives, as a deed waits for its result.
      // When no answer could be taken, the figure says nothing.
      const place = world.places.find(item => item.id === deed.place)!;
      const got = await answered(deed, figureSystem, replySchemaOf(state, place), replyOf(world, state, deed), readReply);
      if (!got) return outcome;
      await happened({ kind: 'reply', who: deed.who, at: deed.at, figure: deed.to as string, text: got.came?.text ?? null, moves: got.came?.moves ?? [] }, judge.name);
      continue;
    }
    if (deed) {
      // A deed waits for the world's answer, and nothing else can happen before it.
      const place = world.places.find(item => item.id === deed.place)!, present = state.people.filter(person => person.place === deed.place);
      const sleepers = sleepersNear(state.people, place).map(person => person.id), hidden = state.things.places.get(deed.place)!.filter(thing => thing.hidden).map(thing => thing.label);
      const got = await answered(deed, worldSystem, resultSchemaOf(state, place), deedOf(world, state, deed), answer => {
        // What is heard next door of a deed in a place with no place next door is nothing, whatever the answer says.
        const came = readResult(answer, sleepers, present.map(person => person.id), hidden);
        return came && { ...came, beyond: place.nextDoor.length ? came.beyond : null };
      });
      if (!got) return outcome;
      await happened({ kind: 'result', who: deed.who, at: deed.at, ...(got.came ?? { text: null, wakes: [], moves: [], sets: [], poses: [], feels: [], beyond: null, search: false, finds: [] }) }, judge.name);
      continue;
    }
    const actor = next(state.people);
    const now = actor.freeAt, who = actor.id, mind = state.minds.get(who)!;
    // What the clock brings by a law comes first, and no model is asked: the weather changes before anyone acts at
    // that moment, and someone awake to the limit falls asleep at its turn.
    const brought = LAWS.map(law => law.due(world, state.laws, actor)).find(record => record !== null);
    if (brought && brought.at < horizon) {
      await happened(brought);
      continue;
    }
    outcome.seconds = Math.min(now, horizon) - stands;
    if (now >= horizon) return outcome;
    if (actor.place === null) {
      await happened({ kind: 'arrive', who, at: now });
      continue;
    }
    if (actor.asleep && idle(mind)) {
      await happened({ kind: 'wake', who, at: now });
      continue;
    }
    const system = systemOf(world, shared, who), player = playerOf(who);
    // A sleeper who is due to wake folds all it lived through before the sleep. Anyone else folds its oldest lines
    // while it holds more than the short-term memory may: this is what bounds a request whatever the model chooses.
    const folding = actor.asleep ? mind.lines : mind.size > world.shortWords ? oldest(mind, world.shortWords) : null;
    if (folding) {
      const request = { system, schema: MEMORY_SCHEMA,
        messages: [{ role: 'user' as const, content: [...known(mind, folding), rewriteOf(world, nowOf(world, actor, now), actor.asleep)].join('\n') }] };
      // An answer that cannot be used gets one more try. After that the old text stays and the lines are lost.
      let memory = null;
      for (let attempt = 0; attempt < 2 && !memory; attempt += 1) {
        const answer = await ask(player, 'memory', request);
        if (answer === null) return outcome;
        memory = answer === CUT ? null : readMemory(answer, world.longWords);
        if (!memory) unusable(player);
      }
      outcome.rewrites += 1;
      if (!memory) outcome.lost += 1;
      await happened({ kind: 'memory', who, at: now, text: memory?.text ?? null, upTo: folding.at(-1)!.seq, cut: memory?.cut ?? false }, player.name);
      continue;
    }
    const place = actor.place;
    // What a person carries as a resident is told of it. Someone who was given nothing in the world file and has
    // nothing is not spoken of as carrying; what was given and is gone is said as nothing.
    const carries = (name: string, id: string, own: boolean) => {
      const things = state.things.people.get(id)!;
      return things.length || world.characters.find(character => character.id === id)!.carries.length ? ` ${name}: ${shown(things, own) || 'nothing'}.` : '';
    };
    // The people of a state stand in the world file's order.
    const others = world.characters.flatMap((character, index) => {
      const person = state.people[index];
      return person !== actor && person.place === place
        ? [`- ${tagged(character)}${person.asleep ? ', asleep' : ''}${LAWS.map(law => law.seen?.(world, state.laws, person, now) ?? '').join('')}.${seen(character, person)}${carries('Carries', person.id, false)}`] : [];
    });
    const limit = pause ? MAX_WORDS : wordLimit(world, horizon - now);
    const spot = world.places.find(item => item.id === place)!;
    const body = `${part('Your pose', actor.pose)}${carries('You carry', who, true)}`.slice(1);
    const answer = await ask(player, 'turn', { system, schema, messages: [{ role: 'user', content: [
      ...known(mind, mind.lines),
      `${nowOf(world, actor, now)} You are in ${tagged(spot)}. ${others.length ? 'Here with you:' : spot.figures.length || spot.crowd !== null ? 'None of the people of the list is here with you.' : 'Nobody else is here.'}`,
      ...others,
      ...(spot.figures.length ? ['People of this place, who answer when you say with `to`:', ...spot.figures.map(figure => `- ${tagged(figure)}.${part('Looks', figure.looks)}`)] : []),
      ...(spot.crowd === null ? [] : [`Around you: ${closed(spot.crowd)}`]),
      ...(body ? [body] : []),
      ...LAWS.flatMap(law => law.turn(world, state.laws, actor, now) ?? []),
      `Minutes from here: ${world.places.filter(item => item.id !== place).map(item => `${tagged(item)} ${travelSeconds(world, place, item.id) / 60}`).join(', ') || 'there is no other place'}.`,
      `This turn the \`text\` of a say or a call may hold ${limit} words at most.${
        pause ? '' : ` ${Math.floor((horizon - now) / 60)} min ${(horizon - now) % 60} s of the story are left.`}`,
    ].join('\n') }] });
    if (answer === null) return outcome;
    const action = answer === CUT ? 'long' : readAction(world, actor, answer);
    if (typeof action === 'string') unusable(player);
    await happened({ kind: 'act', who, at: now, limit, action }, player.name);
  }
}
