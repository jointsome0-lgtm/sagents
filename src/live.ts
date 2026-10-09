import { createHash } from 'node:crypto';

import { ENDPOINT, ModelError, OTHER_ENDPOINT } from './chatgpt.ts';
import type { Request, Result } from './chatgpt.ts';
import { advance, memoryStore, replay, RESULT_WORDS, standingAt, SAID_WORDS, vehicleDue, vehicleView, worldOf } from './journal.ts';
import type { Record, State, Store } from './journal.ts';
import { idle, oldest, readMemory } from './memory.ts';
import type { Line, Mind } from './memory.ts';
import { LAWS } from './laws.ts';
import { closed } from './reading.ts';
import { next, readAction, sleepersNear } from './action.ts';
import { labelsOn, readReply, readResult, refusal } from './answer.ts';
import type { Answer, Rejected } from './answer.ts';
import { all, MAX_IN_PLACE, MAX_MOVES, MAX_ON_PERSON, MAX_SETS, MAX_STOCK, NAME_WORDS, RECORD, shown, SINKS, sought, written } from './things.ts';
import type { Thing } from './things.ts';
import { FORCES, KINDS, MAX_TOUCHES, NONE } from './touch.ts';
import type { Touch } from './touch.ts';
import { KINDS as MARK_KINDS, LEVELS, MARK_WORDS, marksAt, MAX_MARKS, MAX_MINUTES, ZONES } from './marks.ts';
import type { Mark } from './marks.ts';
import { clockAt, driveSeconds, DRIFT, hasClock, sensed, SENSED, travelSeconds, wordLimit } from './time.ts';
import { CHARS_PER_WORD, GESTURE_WORDS, LIMITS, MAX_SECONDS, MAX_SLEEP, MAX_TRACES, MAX_WORDS, namesOf, SAYS_WORDS } from './world.ts';
import type { Event, Person, Place, World } from './world.ts';

// The `live` mode: every character of a world is played by a model, one call for one action, under the story's clock.
// A character is sent its own sheet, what it remembers and what it perceived since, and nothing else: no other
// character's sheet, note or memory and no event it did not hear or see. There is no author above the characters.
// Everything that happens is a record in the journal (`journal.ts`), and a request is built from what the journal
// amounts to, so it has the same largest size however long the world has run.
// `traces` says that the world keeps traces: only then is anything said of them, and the text of any other world is
// what it was.
const residentInstructionsOf = (traces: boolean) => `You are one person in a story that several people live through together. You are that person and not a narrator.

Each turn you take exactly one action and answer with one JSON object. Every field is there; a field the action does not use is null.
- note: with any action, and written before you choose it, a private line you keep for yourself: not a plan, but what is going on in you right now, what you notice in those with you, what your body feels, what you want and, when something holds you back, what it is. Nobody else ever reads it. Null when you have none.
- say: you speak \`text\` aloud. Everyone in your place hears it. With \`to\`, the id of one of the people of the place that a turn lists, you speak to that person, who may answer.
- call: you speak \`text\` to one person, \`to\` (that person's id), by the world's means of remote contact, if it has one. That person hears it wherever they are, and those in your place hear your half.
- go: you walk to another place of the list, \`place\` (its id). Moving about inside the place you are in is a do. On the way you hear and see nothing and cannot act.
- do: you do something others can see, \`text\`, for \`seconds\` (1 to ${MAX_SECONDS}). Write what you do, not what comes of it: the world tells you that. A do never takes you to another place: only a go does.
- wait: you stay silent and attentive for \`seconds\` (1 to ${MAX_SECONDS}). The wait ends at once when someone speaks near you, comes or leaves, or when something is heard from next door, so a long wait loses nothing: do not wait in short steps.
- sleep: you sleep for \`seconds\` (1 to ${MAX_SLEEP}), or \`until\` a time of day. Asleep you hear and see nothing, and only someone's deed can wake you before that time. A call to you, like a call to someone on the way, waits until you can hear it.
- until: for do, wait and sleep, in place of \`seconds\`: a time of day like 06:30, the next moment the clock shows it. It must fall within the action's span.
- gesture: with a say, what your face, hands or body do while you speak, in ${GESTURE_WORDS} words at most: a look, a smile, a nod, a shrug. Those in your place see it. It moves no thing, changes no pose and touches nobody: such things are a do.
- says: with a do, words you say aloud while you do it, ${SAYS_WORDS} words at most and never more than the turn allows for \`text\`. Everyone in your place hears them.

Speak the way people speak: briefly, one thought at a time, and leave room for an answer. Words cost the story's time: each takes part of a second, and those who listen are held until you finish. Each turn says how many words \`text\` may hold; a longer speech is cut there. A note, and the \`text\` of a do, keep their first ${MAX_WORDS} words.

Each turn says the time. With a clock at hand, your own or one in the place you are in, it is the clock's time, and an action \`until\` a time of day ends at that time. With none you know only the part of the day, and such an action ends when you guess that the time has come: up to ${DRIFT.wait.most / 60} minutes early or late after an hour's wait, up to ${DRIFT.sleep.most / 60} after a night's sleep.

Each turn says how your body feels. People need sleep: an hour of it makes up for two awake, and one who stays awake too long falls asleep on the spot.

Each turn also says the weather as it reaches you where you are, what you see of those who are with you, how you are placed and what you carry: what you have in your hands or wear, and in square brackets after a thing what is in it or in its pockets, with \`×\` and a number where there are several. Of others you see what they carry and not what is inside it, unless it lies open. What you carry and how you are placed do not change by themselves or by words: to take, give, put down or hide a thing, to sit or lie down, do it, and the world tells you what came of it and what went from where to where.${traces ? ' After `On them:`, and after `On you:` for yourself, a turn says what is on a body or on clothes for now and in plain sight, such as a smear of food, a stain or wet hair. It stays there, wherever its owner goes, until it is wiped, washed or brushed off, which is a do, and a turn no longer says what is gone.' : ''} A line that begins \`You feel:\` is what your own body tells you, and nobody else is told it.

Speech is heard only in your own place and does not pass a door: a knock or a shout is a do, and the world says whether it is heard in the places next door, which the list of places names. A line \`From …, next door:\` is what you hear of such a deed done there, and it does not say who did it.

A turn may also list people of the place you are in: those around, and some by name with an id. They are not among the people of the list above and cannot be called. They stay where they are and do nothing unless someone speaks to them: to speak to one, say with \`to\`. What one of them answers, everyone in the place hears.

You know only your sheet, what you remember and what you perceived since, which is what a turn lists. Nothing else is known to you. You may keep things to yourself, and you need not say what you want.

Your memory is a text you write yourself. When you wake, and when much has happened, you are asked to write it anew from what it held and what happened since. What you leave out of it then is forgotten.

Do not describe what other people do, feel or answer, and do not decide for them. They act on their own turns.

Write \`note\`, \`text\`, \`gesture\`, \`says\` and your memory in the language of your sheet.`;
export const INSTRUCTIONS = residentInstructionsOf(false);
const traced = (world: World) => world.characters.some(character => character.traces !== null);

// What a resident of a world with `touch` is told besides, right after the sentence about `You feel:`. This candidate
// was played on real models over an earlier engine and still awaits measurement over 0.1.1.
const FELT = 'A line that begins `You feel:` is what your own body tells you, and nobody else is told it.';
const TOUCH_TOLD = 'A line `You touch …` or `… touches you` is a touch that holds now between you and someone here: its kind, how hard, for how long, and with what and where. It lasts until one of the two lets go, by a do, or leaves the place, so nobody has to renew it.';
// What a resident of a world with `marks` is told besides, after those. This candidate was played on real models
// over an earlier engine and still awaits measurement over 0.1.1.
const MARK_TOLD = 'A line like `Your back (burn, strong): …` is a feeling that stays in that part of your body: what kind it is, how strong it is now, and where exactly and what it is like. It is told again on every turn, as it then is, until something that is done to it or time changes it, and nobody else is told it.';
const instructionsOf = (world: World) => {
  let text = residentInstructionsOf(traced(world)).replace(FELT, [FELT, ...(world.touch ? [TOUCH_TOLD] : []), ...(world.marks ? [MARK_TOLD] : [])].join(' '));
  if (world.vehicles?.length) text = text.replace('\n- do:', `\n${vehicleRule(world)}\n- do:`);
  return text;
};

const text = { type: ['string', 'null'] };
// `place` is one of the world's places or null, so that a model held to the schema names no place that is not there.
// `note` stands first: a model writes the fields in this order, so the note is written before the action is chosen and can lead it.
const schemaOf = (world: World) => ({ type: 'object', additionalProperties: false, required: ['note', 'action', 'text', 'to', 'place', 'seconds', 'until', 'gesture', 'says'],
  properties: { note: text, action: { type: 'string', enum: ['say', ...(world.remote === null ? [] : ['call']), 'go', 'do', 'wait', 'sleep'] }, text, to: text, place: { ...text, enum: [...world.places.map(place => place.id), ...(world.vehicles ?? []).map(place => place.id), null] },
    seconds: { type: ['integer', 'null'] }, until: text, gesture: text, says: text } });
const MEMORY_SCHEMA = { type: 'object', additionalProperties: false, required: ['memory'], properties: { memory: { type: 'string' } } };

const named = (list: { id: string; name: string }[], id: string | null) => list.find(item => item.id === id)?.name ?? '';
const tagged = ({ id, name }: { id: string; name: string }) => `${name} (${id})`;

// The system text has the part every character shares first, so that a server's prefix cache serves them all.
const VEHICLE_RULE = '- a vehicle is a place that moves: go to its id where it stands to get in; inside, go to the place it stands at to get out, or to another place to drive there if you may drive it. Everyone and everything inside rides along, and on the way you act as in any place.';
const BUS_RULE = 'A vehicle with a round goes by itself: you get out only where it stands.';
const vehicleRule = (world: World) => VEHICLE_RULE + (world.vehicles?.some(place => place.vehicle?.route) ? ` ${world.vehicles.some(place => place.vehicle?.route && place.vehicle.fare) ? BUS_RULE.replace('you get out', 'its fare is taken from what you carry as you get in, and you get out') : BUS_RULE}` : '');
const joined = (words: string[]) => words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
const busLine = (world: World, vehicle: NonNullable<Place['vehicle']>) => `Goes ${joined(vehicle.route!.map(id => named(world.places, id)))} and back to ${named(world.places, vehicle.route![0])}; leaves ${named(world.places, vehicle.route![0])} at ${joined(vehicle.leaves!)}.${vehicle.fare ? ` A ride costs ${vehicle.fare.n} ${vehicle.fare.name}.` : ''}`;
const sharedOf = (world: World) => `${instructionsOf(world)}

The world: ${world.title}
${world.about}

Places:
${world.places.map(place => `- ${tagged(place)}: ${place.nextDoor.length ? `${closed(place.about)} Next door: ${place.nextDoor.map(id => named(world.places, id)).join(', ')}.` : place.about}`).join('\n')}${world.vehicles?.length ? `\n\nVehicles:\n${world.vehicles.map(place => {
  const vehicle = place.vehicle!;
  return `- ${tagged(place)}: ${closed(place.about)} ${vehicle.seats} seat${vehicle.seats === 1 ? '' : 's'}. ${vehicle.route ? busLine(world, vehicle) : vehicle.drivers === null ? 'Anyone may drive it.'
    : vehicle.drivers.length ? `${vehicle.drivers.map(id => named(world.characters, id)).join(', ')} may drive it.` : 'Nobody may drive it.'}`;
}).join('\n')}` : ''}

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
const notationOf = (traces: boolean) => `Every thing here is listed once, under a label like t7. What a thing holds stands in square brackets after it: \`t8 parka [t9 cigarettes ×17; t10 lighter]\`. \`×17\` is how many there are, and a thing with no number is one. Empty brackets mean a thing that can hold others and holds nothing now; a thing with no brackets never holds anything. Under \`Things here\` is what stands or lies in the place. After \`Carries\` is what a person has in their hands or wears, in sight; what is in the brackets of such a thing is in its pockets or inside it, out of sight unless the thing is \`open\`. Marks after a thing: \`fixed\`, a part of the place, never moved; \`open\`, what it holds is in plain sight; \`stock\`, a supply with no count, which taking does not use up; \`food\`, it can be eaten or drunk; \`burns\`, it can burn up; \`fire\`, it can set things alight; \`state\`, how it is now, and in brackets the states it can have. After \`Facts:\`, in the line of the place, is what is true of the place and of the things here and is not seen at once.${
  traces ? ' After `Traces:` is what is on a person\'s body or clothes for now and in plain sight, such as a smear of food, a stain or wet hair, each under a label like m7; it is no thing, and it is never moved.' : ''}`;
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
const worldInstructionsOf = (traces: boolean) => `You are the world of a story: not a person in it and not a narrator. Someone does something, and you say what comes of it.

You are told what is there, and nothing else exists: a search for something you were not told of finds nothing of the kind. Say what is there as the world itself. Never speak of facts, of what was mentioned or listed, of labels and marks, or of your task.

You are told the weather so that you know it, not to report it. A result speaks of the weather only when the deed meets it: someone steps out into it, opens a door or a window to it, looks or listens for it.

You are told which other places there are. Nobody gets to another place by a deed: whoever tries is still here, by the way out, and the result says only that. A pose never names another place.

You may be told which places are next door, behind a door or a thin wall, and who is in each, awake or asleep. Those people are not here: they see nothing of the deed, no entry of \`poses\` or \`feels\` is for them, and what they hear of it goes to \`beyond\`.

${notationOf(traces)}

The lists are the truth about where each thing is, and what an earlier result says of a thing may be out of date. You keep no count and rewrite no list: you say which things the deed moved, by label, and the lists are kept from that. A thing never appears from nowhere and never vanishes: it stays where it is listed unless an entry of yours moves it. A deed that only looks, listens or speaks moves nothing. A deed that needs a thing that is not here moves nothing either, and the result says what was seen of that.${
  traces ? ' The traces listed with a person are the truth in the same way: a person has those and no others, and each stays on that person, wherever they go and however long, unless an entry of yours takes it off.' : ''}

Answer with one JSON object, its fields in this order.
- search: true when the deed is a search of the place: someone looks through it, under and behind what is there, for one thing or for whatever there is. False for any other deed, a look around included.
- finds: the labels of the hidden things that the deed goes straight to, or an empty list.
- moves: what the deed moved, or an empty list. An entry has \`what\`, \`n\` and \`to\`. It says where a thing ends up and not the way it went: money taken out of a pocket and handed over is one entry, to the one who got it. \`what\` is the label of the thing. \`n\` is how many of it go: 1 for a thing with no number; for a thing with a number, the part that the deed names, or the whole number when all of it goes; for a stock, how many are taken. \`to\` is where it ends up: the id of a person here, in that person's hands or on them; the id of this place, lying here in sight; the label of a thing with brackets, in it or on it; \`eaten\`, when the one who does the deed eats or drinks it up; \`burned\`, when it burns up, which takes a \`fire\` here. A thing goes with all that it holds, as one entry: never list what is inside a thing that moves. Never list a thing that stays where it is.
- sets: the things whose state the deed changed, or an empty list. An entry has \`what\`, the label of a thing with a \`state\` mark, and \`state\`, one of the states in its brackets.
- poses: the pose of each person here whose pose the deed changed, or an empty list. An entry has \`of\`, the id of the person, and \`text\`: how and where in the place the person now is, 20 words at most, in the language of the world's description. A pose names no thing that is held or worn: the lists say that.
- wakes: the ids of the sleepers here or next door whom the deed wakes, or an empty list. A sleeper breathes and is alive unless the facts say otherwise. Touch, shaking or a loud noise right by a sleeper wakes them; quiet steps do not. A sleeper next door is woken only by what \`beyond\` says is heard there, when it is loud enough to wake.
- feels: what the deed makes a person here feel in their own body, or an empty list. An entry has \`of\`, the id of a person who is awake, and \`text\`: what that body feels, 20 words at most, in the language of the world's description. Only that person is told it, right after the words \`You feel:\`, so the text begins with what is felt and never names the person or says that they feel. An entry is due where the deed does something to a body: effort, a pose held long, a blow, the touch of another body, heat, cold, food, drink, smoke. One who is touched feels it, and so does the one who touches. When hands feel a body or a thing to judge it, the entry of their owner says what they find, in keeping with what you were told of that body or thing. Name what the body registers, such as pressure, weight, warmth, cold, pain, stretch, tiredness, breath, heartbeat or taste, never what the person thinks or wants, whether they like it, or what they do next. A deed that only looks, listens or speaks gives no entry, and one who only watches gets none. The ordinary handling of a thing, taking it, carrying it, putting it down or handing it over, gives no entry either.
- beyond: what of the deed is heard in the places next door, in one sentence of ${LIMITS.beyond} words at most, in the language of the world's description, or null when nothing carries that far, as with most deeds, and always when you are told of no place next door. A knock at a door or on a wall, a shout, a crash or a door slammed is heard there; steps, quiet talk and the handling of things are not. It says the sound and not who made it, unless it is a voice, and then with its words.
- result: what the senses give as the direct result of the deed, in one or two plain sentences, in the language of the world's description. It never retells the deed: when there is nothing to notice beyond the deed itself, it is null. Say only what anyone here could see, hear or smell, never what one body alone feels, which goes to \`feels\`, and never what anyone thinks, says or does next: people who are awake answer on their own turns. It agrees with \`moves\` and \`sets\`: no thing changes hands, place or state in it without an entry there.${
  traces ? ' It agrees with `traces` and `wipes` as well: nothing in it gets onto a body or onto clothes and stays there, and nothing is wiped, washed or brushed off one, without an entry there.' : ''} It gives no numbers of things or of money.${traces ? `
- traces: what the deed leaves on the body or the clothes of a person here, to stay there in sight, or an empty list. An entry has \`of\`, the id of the person, and \`text\`: what it is and exactly where, ${LIMITS.trace} words at most, in the language of the world's description. An entry is due when something gets onto a body or onto clothes and stays there in sight, by accident or because someone puts it there: food, paint, mud, blood, sand, a cream or an oil spread on skin, water that leaves hair or clothes wet. The text names the exact spot, and the side where there are two: \`blue paint on the right sleeve, at the elbow\`, never just \`paint on the clothes\`. A person has ${MAX_TRACES} traces at most. Never list again a trace that a person already has.
- wipes: the labels of the traces that the deed takes off, or an empty list. One is due when a trace is wiped, washed or brushed away. A trace that the deed spreads, smears further or leaves smaller is taken off here and given in \`traces\` as it now is. No trace goes by itself or with time, and none passes to another person without an entry in \`traces\` for that person.` : ''}

You may be told what is hidden here, each thing under its label. A hidden thing is seen by nobody, and no result, pose or entry of \`feels\` speaks of it or hints at it, whoever looks and wherever, until it is found. It is found in two ways. By a search that has lasted long enough: you are told which things this deed finds if it is a search, and you never decide whether a search has been long enough. Or by a deed that goes straight to the very spot named for it, however short the deed is: its label then goes into \`finds\`. A deed that names another spot, or names the thing and not the spot where it lies, does not go straight to it. When a thing is found either way, the result says where it turned up and what is seen of it, and from then on it lies in the place in sight. Only a deed that finds a hidden thing can move it or what it holds.`;
export const WORLD_INSTRUCTIONS = worldInstructionsOf(false);
// What the world is told to be when it is asked what a figure answers: someone of a place whom nobody plays.
const figureInstructionsOf = (traces: boolean) => `You are the world of a story: not a narrator and not one of the people who live in it. In a place there are people whom nobody plays: those around, and some with a name. Someone has spoken to one of them, and you say what that one answers.

You are told what is there, and nothing else exists. The one who answers knows what its own facts say, what anyone in the place sees and hears, and what was said to the people of the place before. It does not know what others carry out of sight or what their facts say: you are told those so that the answer does not go against them. Never speak of facts, of labels and marks, or of your task.

${notationOf(traces)}

The people whom nobody plays carry nothing of their own: what they have at hand is among the things of the place. The lists are the truth about where each thing is. A thing never appears from nowhere and never vanishes: it stays where it is listed unless an entry of yours moves it.

Answer with one JSON object, its fields in this order.
- reply: what that person says aloud, as such a person would say it, in the language of the world's description, ${MAX_WORDS} words at most. Speech only: no gestures and no thoughts. It answers what was said, briefly, and starts nothing of its own; it does not leave, follow anyone or speak for anyone else. Null when it says nothing.
- moves: what the one who answers hands over or takes while speaking, or an empty list. An entry has \`what\`, \`n\` and \`to\`. \`what\` is the label of the thing. \`n\` is how many of it go: 1 for a thing with no number; for a thing with a number, the part that goes, or the whole number when all of it goes; for a stock, how many are taken. \`to\` is where it ends up: the id of a person here, in that person's hands or on them; the id of this place; the label of a thing with brackets, in it or on it. A thing goes with all that it holds, as one entry: never list what is inside a thing that moves.`;
export const FIGURE_INSTRUCTIONS = figureInstructionsOf(false);
// The one sentence an answer that the rules of things refused is asked again with: the entry and the cause, in the
// words of the text above and never as a code.
const CAUSES = {
  traces: `a person has ${MAX_TRACES} traces at most: take one off with \`wipes\`, or leave this entry out`,
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
const againOf = ({ code, entry }: Rejected) => `Your answer to this was not taken and nothing of it happened, because of the entry ${JSON.stringify(entry)}: ${CAUSES[code]}. Answer again.`;
// The point on `touches`, which the world of a world file with `touch` reads between those on `poses` and on `wakes`,
// so that what is written after it, `feels` above all, agrees with it. This candidate was played on real models
// over an earlier engine and still awaits measurement over 0.1.1.
const TOUCHES = `- touches: the touches between two people here that the deed began, changed or ended, or an empty list. An entry is due for a touch that goes on after the deed, not for a tap or a blow that is over with it. It has \`of\`, the id of the one who touches, and \`to\`, the id of the one touched; \`kind\`: \`touch\`, a part of the body rests on the other, \`press\`, \`squeeze\`, \`hold\`, keeps hold of a part, as a hand or a wrist, \`embrace\`, arms around the body, \`rub\`, moves over the skin, strokes, kneads or rubs in, or \`lean\`, rests their weight on the other; \`force\`: \`light\`, \`firm\` or \`hard\`; and \`text\`: with what of their body the one touches and where on the body of the other, ${LIMITS.touch} words at most, in the language of the world's description, naming neither of them. One entry says all that one of them does to the other, and a new one takes its place. A touch listed under \`Touches that hold now\` needs no entry unless the deed changes or ends it; when someone lets go, pulls away or is pushed off, its entry has the kind \`none\`.`;
// The point on `lingers`, which the world of a world file with `marks` reads between those on `feels` and on
// `beyond`: what a body feels during the deed is written first, as it was measured, and then what of it stays. The
// word `marks` is not in it, since the world's text calls so what stands after a thing. This candidate was played
// on real models over an earlier engine and still awaits measurement over 0.1.1.
const LINGERS = `- lingers: the feelings of a part of a body that outlast the deed, as the deed began, changed or ended them, or an empty list. What is felt only while the deed lasts stays in \`feels\`; an itch, a burn, an ache, a pain or a numbness that is still there after the deed gets an entry here, and so does one listed under \`Feelings that last now\` when the deed eases, worsens or ends it. An entry has \`of\`, the id of a person here; \`zone\`, the part of the body: ${ZONES.slice(0, -1).map(zone => `\`${zone}\``).join(', ')}, or \`${ZONES.at(-1)}\` for the whole of it; \`kind\`: ${MARK_KINDS.slice(0, -1).map(kind => `\`${kind}\``).join(', ')} or \`${MARK_KINDS.at(-1)}\`; \`level\`: \`${LEVELS[0]}\`, \`${LEVELS[1]}\` or \`${LEVELS[2]}\`, or \`none\` when it is gone; \`minutes\`; and \`text\`: where exactly and what it is like, ${MARK_WORDS} words at most, in the language of the world's description, naming nobody, and empty with \`none\`. There is one entry at most for a person, a zone and a kind. With \`minutes\` null the feeling is so from now on. With \`minutes\`, a whole number from 1 to ${MAX_MINUTES}, it is so for that long after the deed and is then, by itself, again as it was before the entry: a salve makes a burn \`faint\` for some minutes and the burn then returns as it was, and a stubbed toe is a \`pain\` for a minute or two where nothing was and is then gone. A feeling listed under \`Feelings that last now\` needs no entry unless the deed changes it: it stays as listed, and leaving it out does not end it. A deed that does something to the very part of the body where a listed feeling sits changes it, at least for a while, and so its entry is due: a cream spread on a burn, cold water on it, a rub of an aching muscle, a blow on a bruise.`;
// The world's text as the world of this world file reads it: the measured text, and with `touch` or `marks` those points in it.
const worldTextOf = (world: World) => [...(world.touch ? [['\n- wakes:', TOUCHES]] : []), ...(world.marks ? [['\n- beyond:', LINGERS]] : [])]
  .reduce((text, [before, point]) => text.replace(before, `\n${point}${before}`), worldInstructionsOf(traced(world)));
// What both texts of the world end with: the world as its file describes it, with its facts.
const aboutOf = (world: World) => `The world: ${world.title}
${world.about}${world.facts === null ? '' : `\nFacts: ${world.facts}`}`;
export const worldSystemOf = (world: World) => `${worldTextOf(world)}\n\n${aboutOf(world)}`;
// The time as a request to a resident opens its last part with it: the clock when the resident has one at hand, and
// the part of the day otherwise.
const nowOf = (world: World, actor: Person, at: number) => hasClock(world, actor.id, actor.place) ? `Now ${clockAt(world, at)}.`
  : `Now ${sensed(world, at, world.places.some(place => place.id === actor.place && place.open))}, as far as you can tell: no clock is at hand.`;
// One text under its name, closed as a sentence, or nothing when there is none.
const part = (name: string, value: string | null) => value === null ? '' : ` ${name}: ${closed(value)}`;
// What anyone in a person's place sees of its body.
const seen = (character: { looks: string | null }, person: Person) => `${part('Looks', character.looks)}${part('Pose', person.pose)}`;
// What is on a person for now, after its looks and pose, in a run that keeps traces: for a resident under `name`,
// with no label, and nothing when there is none; for the world under labels, and `none` said.
const onOf = (state: State, id: string, name: string | null) => {
  const traces = state.traces?.of.get(id);
  return !traces || (name !== null && !traces.length) ? ''
    : ` ${name ?? 'Traces'}: ${traces.map(trace => name === null ? `${trace.label} ${trace.text}` : trace.text).join('; ') || 'none'}.`;
};
// The things of a place as the world is told of them, each under its label with all that it holds, and what a
// person carries, after that person's looks and pose. The harness of the check that measured the world's text
// compares these two with its own.
export const thingsOf = (things: Thing[]) => things.length ? ['Things here:', ...things.map(thing => `- ${written(thing)}`)] : ['Things here: nothing.'];
export const carriedOf = (things: Thing[]) => ` Carries: ${things.map(written).join('; ') || 'nothing'}.`;

// What an answer may name in a place, in the order the request lists it: the things in sight, the hidden ones when
// the answer is a deed's, and what the people there carry. A thing that holds others is where a thing can be put.
// A deed's answer may wake a sleeper next door too. `facts` are the sentences of what is true of those things, in
// that order and each once, however many records have it: the world is told the facts of every thing its request
// lists, wherever the thing has got to.
function namedOf(state: State, place: Place, deed: boolean) {
  const lies = state.things.places.get(place.id)!, people = state.people.filter(person => person.place === place.id);
  const things = all([...lies.filter(thing => !thing.hidden), ...(deed ? lies.filter(thing => thing.hidden) : []), ...people.flatMap(person => state.things.people.get(person.id)!)]);
  return { what: things.filter(thing => !thing.fixed).map(thing => thing.label),
    to: [...people.map(person => person.id), place.id, ...things.filter(thing => thing.holds).map(thing => thing.label),
      ...(deed ? SINKS.filter(sink => things.some(thing => sink === 'eaten' ? thing.food !== null : thing.burns)) : [])],
    stated: things.filter(thing => thing.states).map(thing => thing.label), states: [...new Set(things.flatMap(thing => thing.states ?? []))],
    of: people.map(person => person.id), awake: people.filter(person => !person.asleep).map(person => person.id), finds: lies.filter(thing => thing.hidden).map(thing => thing.label), wakes: sleepersNear(state.people, place).map(person => person.id),
    facts: [...new Set(things.flatMap(thing => thing.facts === null ? [] : [closed(thing.facts)]))] };
}
// A string that is one of a list, or any string when the list is empty: a strict schema may refuse an empty list.
const oneOf = (list: string[]) => list.length ? { type: 'string', enum: list } : { type: 'string' };
const entries = (properties: object) => ({ type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } });
// The schema of the world's answer is made for each request, so that a model held to it names no label, id or
// state that is not there where a list has entries; an empty list takes any string, and the rules drop or refuse
// what the schema lets through. Except for traces, its fields stand with the entries before the words, so that the words are written after them and cannot lead them;
// both orders passed the check of 2026-10-05 on the weak local model.
// In a world with `touch` the touches stand after the poses: the fields before them are written as they were measured.
// In a world with `marks` the entries about the lasting feelings stand after `feels`, for the same reason.
// Traces and wipes stand last, after `result`, in that order, played on two models on the other line.
// This port onto the main line is played on no model.
const resultSchemaOf = (state: State, place: Place, { touch, marks }: World) => {
  const names = namedOf(state, place, true);
  const properties = { search: { type: 'boolean' }, finds: { type: 'array', items: oneOf(names.finds) },
    moves: entries({ what: oneOf(names.what), n: { type: 'integer' }, to: oneOf(names.to) }), sets: entries({ what: oneOf(names.stated), state: oneOf(names.states) }),
    poses: entries({ of: oneOf(names.of), text: { type: 'string' } }),
    ...(touch ? { touches: entries({ of: oneOf(names.of), to: oneOf(names.of), kind: oneOf([...KINDS, NONE]), force: oneOf([...FORCES]), text: { type: 'string' } }) } : {}),
    wakes: { type: 'array', items: oneOf(names.wakes) }, feels: entries({ of: oneOf(names.awake), text: { type: 'string' } }),
    ...(marks ? { lingers: entries({ of: oneOf(names.of), zone: oneOf([...ZONES]), kind: oneOf([...MARK_KINDS]), level: oneOf([...LEVELS, NONE]), minutes: { type: ['integer', 'null'] }, text: { type: 'string' } }) } : {}), beyond: text, result: text,
    ...(state.traces ? { traces: entries({ of: oneOf(names.of), text: { type: 'string' } }), wipes: { type: 'array', items: oneOf(labelsOn(state.traces, names.of)) } } : {}) };
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
  return person.place !== place.id ? [] : [`- ${tagged(character)}, ${person.asleep ? 'asleep' : 'awake'}.${seen(character, person)}${onOf(state, person.id, null)}${
    carriedOf(state.things.people.get(person.id)!)}${part('Facts', character.facts)}`];
});
// The touches of a place, where both of a touch are, and how long one has lasted at `now`, since it began or last
// changed its kind or its force: in seconds, and from two minutes on in whole minutes.
const touchesIn = (state: State, place: string) => state.touches.filter(touch => state.people.some(person => person.id === touch.of && person.place === place));
const lasted = (touch: Touch, now: number) => now - touch.since < 120 ? `${now - touch.since} s` : `${Math.floor((now - touch.since) / 60)} min`;
// The touches that hold in a place as the world is told of them when it answers a deed there, after the people: who
// on whom by id, under the names of the entry's fields, the kind, the force, how long it has lasted when the deed
// begins, and the text. A figure's answer is asked for without them.
const heldOf = (state: State, place: Place, now: number) => {
  const touches = touchesIn(state, place.id);
  return touches.length ? ['Touches that hold now:', ...touches.map(touch => `- of ${touch.of} to ${touch.to}: ${touch.kind}, ${touch.force}, for ${lasted(touch, now)}: ${closed(touch.text)}`)]
    : ['Touches that hold now: none.'];
};
// A span of the story's time as a line says it: in seconds, from two minutes on in whole minutes, from two hours on in whole hours.
const span = (seconds: number) => seconds < 120 ? `${seconds} s` : seconds < 7200 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h`;
// The marks of one person as they are at `now`, and of those the ones that are felt: a mark that is gone for a while is not.
const marksOf = (state: State, id: string, now: number) => marksAt(state.marks, now).filter(mark => mark.of === id);
const feltOf = (marks: Mark[]) => marks.filter(mark => mark.layers[0].level !== NONE);
// The lasting feelings of everyone in a place as the world is told of them when it answers a deed there, after the
// people and the touches: whose by id, the zone, the kind, the level, how long it has been so when the deed begins,
// unless it was so before the story began, how long it stays so when it is so only for a while, and the text. One that is gone for a while is listed with
// `none` and no text, so that the world knows it is to return. A figure's answer is asked for without them.
const lastingOf = (state: State, place: Place, now: number) => {
  const marks = state.people.filter(person => person.place === place.id).flatMap(person => marksOf(state, person.id, now));
  return marks.length ? ['Feelings that last now:', ...marks.map(({ of, zone, kind, layers: [{ level, text, since, until }] }) =>
    `- of ${of}, ${zone}: ${kind}, ${level}${since === null ? '' : `, for ${span(now - since)}`}${until === null ? '' : `, ${span(until - now)} left`}${level === NONE ? '.' : `: ${closed(text)}`}`)]
    : ['Feelings that last now: none.'];
};
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
// The facts of the things that the request lists stand after the place's own, as sentences with no label: a block
// of them under labels, after the lists, led a weak model to move things to where no deed had put them.
const placeOf = (state: State, place: Place, deed: boolean) => {
  const facts = [...(place.facts === null ? [] : [closed(place.facts)]), ...namedOf(state, place, deed).facts];
  return [`The place: ${tagged(place)}, ${place.open ? 'under the open sky' : 'under a roof'}. ${place.about}${facts.length ? ` Facts: ${facts.join(' ')}` : ''}`,
    ...thingsOf(state.things.places.get(place.id)!.filter(thing => !thing.hidden))];
};
// One speech to a figure as the world is asked what the figure answers: the place, who is there, the people of the
// place, the facts of the things listed, what came of earlier deeds there, what was said to the figures before and answered, and the speech.
function replyOf(world: World, state: State, said: Event): string {
  const place = world.places.find(item => item.id === said.place)!;
  return [...placeOf(state, place, false),
    ...LAWS.flatMap(law => law.world?.(world, state.laws, place) ?? []), 'Here:', ...hereOf(world, state, place), ...crowdOf(place),
    ...earlierOf(state, place),
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
  return [...placeOf(state, place, true), ...(place.vehicle ? [place.vehicle.heading
      ? `This vehicle is driving from ${tagged(world.places.find(item => item.id === place.vehicle!.heading!.from)!)} to ${tagged(world.places.find(item => item.id === place.vehicle!.heading!.to)!)}.`
      : `This vehicle stands at ${tagged(world.places.find(item => item.id === place.vehicle!.at)!)}.`] : []), ...standingAt(world, state.people, place.id, state.deed?.at ?? state.buses?.at ?? 0),
    ...state.things.places.get(place.id)!.filter(thing => thing.hidden).map(thing => `Hidden here (${thing.label}). This deed finds it ${found.includes(thing)
      ? 'if it is a search of the place, or if it goes straight to the spot named' : 'only if it goes straight to the spot named, and not by searching'}: ${thing.hidden!.spot}: ${written(thing)}`),
    ...(world.places.length > 1 ? [`Other places, which nobody reaches by a deed: ${world.places.filter(item => item !== place && !item.vehicle).map(tagged).join(', ')}.`] : []),
    ...(place.nextDoor.length ? ['Next door:', ...place.nextDoor.map(id => `- ${tagged(world.places.find(item => item.id === id)!)}: ${world.characters.flatMap((character, index) =>
      state.people[index].place === id ? [`${tagged(character)}, ${state.people[index].asleep ? 'asleep' : 'awake'}`] : []).join('; ') || 'nobody'}.`)] : []),
    ...LAWS.flatMap(law => law.world?.(world, state.laws, place) ?? []), 'Here:', ...hereOf(world, state, place),
    ...(world.touch ? heldOf(state, place, deed.at) : []), ...(world.marks ? lastingOf(state, place, deed.at) : []), ...crowdOf(place),
    ...earlierOf(state, place),
    `Now ${deed.clock}. ${named(world.characters, deed.who)} does, for ${deed.seconds} s: ${deed.text}`, 'What comes of it?'].join('\n');
}

// No request of a world is longer than this many characters, system text and message together, however long the
// world has run. A line holds a speech, a note or a deed of `MAX_WORDS` words under a head of names and a time, a
// character's own action is four lines at most with what came of it and a fifth of what its body felt, and the lines of one request are `shortWords` and one such action.
// The line of a speech holds a gesture besides, and the words said with a deed are one line more.
// A pose is as long as its limit of words lets it be, since the world's answer may make it so, a person carries and
// a place holds as many records as the rules of things let them, each as long as a record can be, and every law adds
// what it says it may. One answer of the world adds one line of what it moved, set and found, and one of what was heard next door.
// That line names, for each move, the thing and two holders at most, each a thing, a person or the place: a resident
// reads them by name, and the world, in the newest line its place keeps, under labels and with the id of a person or
// the place, after the name of the one whose deed it was. A name of a person or a place has no limit, so the longest counts.
// The facts of a thing are listed once wherever the thing is, and those of a counted thing or a stock go with every
// part taken off it, so each record that one request can list may have the longest of such facts.
export function requestLimit(world: World): number {
  if (world.vehicles?.length) {
    const places = [...world.places.filter(place => !place.vehicle), ...world.vehicles];
    const bound = requestLimit({ ...world, vehicles: undefined, places });
    const names = Math.max(...places.map(place => tagged(place).length));
    return bound + vehicleRule(world).length + world.vehicles.reduce((sum, place) => sum + place.about.length + tagged(place).length + (place.vehicle!.route ? busLine(world, place.vehicle!).length + (place.vehicle!.fare?.name.length ?? 0) + 200 : 0) + (place.vehicle!.drivers ?? []).reduce((sum, id) => sum + named(world.characters, id).length + 2, 0) + 3 * names + 300, 0);
  }
  const longest = (texts: string[]) => Math.max(...texts.map(item => item.length));
  const people = world.characters.map(tagged), places = world.places.map(tagged);
  const looks = (character: { looks: string | null }) => (character.looks?.length ?? 0) + 20;
  const system = sharedOf(world).length + longest(people) + longest(world.characters.map(character => character.sheet)) + Math.max(...world.characters.map(looks)) + 40;
  const head = 2 * longest(namesOf(world).map(character => character.name)) + longest(world.places.map(place => place.name)) + (world.remote?.length ?? 0) + SENSED + 140;
  const spots = Math.max(...world.places.map(place => place.things.reduce((sum, thing) => sum + (thing.hidden ? thing.hidden.spot.length + 160 : 0), 0)));
  const holder = Math.max(longest(people), longest(places), NAME_WORDS * CHARS_PER_WORD);
  const told = (MAX_MOVES + MAX_SETS) * (NAME_WORDS * CHARS_PER_WORD + 2 * holder + 80) + spots + MAX_IN_PLACE * NAME_WORDS * CHARS_PER_WORD + longest(people);
  const lines = (world.shortWords + 4 * (head + MAX_WORDS) + GESTURE_WORDS + head + SAYS_WORDS + head + LIMITS.feels + head + LIMITS.beyond) * (CHARS_PER_WORD + 1) + told;
  const laws = LAWS.reduce((sum, law) => sum + law.size(world), 0);
  // In a world that keeps traces a person is listed with as many as one may have, each as long as its limit lets it
  // be, under a label, and the newest line a place keeps names, after the person, each trace that one answer left
  // or took off: no more of either than everyone there may have.
  const trace = LIMITS.trace * CHARS_PER_WORD + 20, kept = traced(world) ? MAX_TRACES * trace + 20 : 0;
  const retold = traced(world) ? 2 * MAX_TRACES * people.reduce((sum, item) => sum + item.length + trace + 40, 0) : 0;
  const visible = LIMITS.pose * CHARS_PER_WORD + MAX_ON_PERSON * RECORD + 60 + kept;
  // The touches of one place, each one line of one request: two people, by name or by id, the text and the frame.
  const touches = world.touch ? MAX_TOUCHES * (2 * longest(people) + LIMITS.touch * CHARS_PER_WORD + 100) + 100 : 0;
  // The marks of one person, each one line of one request: a resident reads its own, and the world those of everyone in the place.
  const marks = world.marks ? MAX_MARKS * (MARK_WORDS * CHARS_PER_WORD + longest(world.characters.map(character => character.id)) + 100) : 0;
  // The people of one place whom nobody plays, as a request lists them: for the world with their facts.
  const local = (withFacts: boolean) => Math.max(...world.places.map(place => (place.crowd?.length ?? 0) + 150
    + place.figures.reduce((sum, figure) => sum + tagged(figure).length + looks(figure) + (withFacts ? (figure.facts?.length ?? 0) + 20 : 0) + 20, 0)));
  const now = [...people, ...places].reduce((sum, item) => sum + item.length + 30, 0) + longest(places) + SENSED + 900
    + world.characters.reduce((sum, character) => sum + looks(character) + visible, 0) + laws + local(false) + touches + marks;
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
    + (RESULT_WORDS + SAID_WORDS + 4 * (head + 2 * MAX_WORDS)) * (CHARS_PER_WORD + 1) + told + retold + laws + local(true) + touches + world.characters.length * marks + (world.marks ? 40 : 0) + 1200;
  // A figure's answer is asked for with the same place, people and reminders, without what is hidden.
  const answer = deed + figureInstructionsOf(traced(world)).length - worldTextOf(world).length;
  // Either text can set the bound without touches: its growth must cover the longer of the two additions.
  const residentText = instructionsOf(world).length - INSTRUCTIONS.length, worldText = worldTextOf(world).length - WORLD_INSTRUCTIONS.length;
  return Math.max(resident - residentText, deed - worldText, answer) + Math.max(residentText, worldText);
}

// One event of a live run as lines for a person, or none for a wait that left no note. A note, a memory and what a
// body feels are the character's own and are marked as private: no other character was sent them. What was heard
// next door is one line under the result. A gesture stands in brackets before the speech it came with, and the words
// said with a deed are one line under the deed.
export function linesOf(world: World, event: Event): string[] {
  const places = [...world.places, ...(world.vehicles ?? [])];
  const who = named(namesOf(world), event.who);
  const speech = `"${event.text}"${event.cut ? ' (cut)' : ''}`;
  const what = event.kind === 'drive' ? `${named(places, event.place)} has driven off towards ${named(places, event.to)}`
    : event.kind === 'park' ? `${named(places, event.who)} has pulled up`
    : event.kind === 'say' ? `${who}${event.to === null ? '' : ` to ${named(namesOf(world), event.to)}`}${event.gesture === undefined ? '' : ` (${event.gesture})`}: ${speech}`
    : event.kind === 'reply' ? event.text === null ? `${who} does not answer ${named(world.characters, event.to)}` : `${who} answers ${named(world.characters, event.to)}: ${speech}`
    : event.kind === 'call' ? `${who} calls ${named(world.characters, event.to)}: ${speech}`
      : event.kind === 'go' && event.transfer ? `${who} enters ${named(places, event.to)} (${event.seconds} s)`
      : event.kind === 'go' ? `${who} leaves for ${named(places, event.to)} (${event.seconds} s)`
        : event.kind === 'arrive' ? `${who} arrives`
          : event.kind === 'sleep' ? `${who} falls asleep (${event.seconds} s)`
            : event.kind === 'wake' ? `${who} wakes`
              : event.kind === 'memory' ? `private memory of ${who}${event.cut ? ' (cut)' : ''}: ${
                event.text?.replaceAll('\n', '\n         ') ?? 'the rewrite was lost, and what it was to hold is forgotten'}`
                : event.kind === 'weather' ? `the weather changes: ${event.text}${event.indoors == null ? '' : ` Under a roof: ${event.indoors}`}`
                : event.kind === 'result' ? `what came of what ${who} did: ${event.text ?? 'nothing that could be noticed'}${
                  event.wakes?.length ? ` (wakes ${event.wakes.map(id => named(world.characters, id)).join(', ')})` : ''}${event.search ? ' (a search)' : ''}`
                  : event.kind === 'do' ? `${who} does (${event.seconds} s): ${event.text}` : `${who} waits (${event.seconds} s)`;
  return [...(event.kind === 'wait' && !event.note ? [] : [`${event.clock} ${event.place ? `[${named(places, event.place)}] ` : ''}${what}`]),
    ...(event.says === undefined ? [] : [`         says with it: "${event.says}"${event.cut ? ' (cut)' : ''}`]),
    ...(event.found ?? []).map(thing => `         found: ${thing.what} ${thing.name} (${thing.spot})`),
    ...(event.moved?.some(posting => posting.sink === 'fare') ? [`         ${who} pays ${event.moved.reduce((sum, posting) => sum + posting.n!, 0)} ${event.moved[0].name}`] : []),
    ...(event.moved ?? []).map(posting => `         moved: ${posting.what} ${posting.name}${posting.n === null ? '' : ` ×${posting.n}`}, ${posting.from} -> ${posting.to}${posting.sink === 'fare' ? ' (sink)' : ''}${
      posting.as === null || posting.as === posting.what ? '' : ` as ${posting.as}`}`),
    ...(event.set ?? []).map(thing => `         state: ${thing.what} ${thing.name}, ${thing.state}`),
    ...(event.poses ?? []).map(pose => `         pose of ${named(world.characters, pose.of)}: ${pose.text || 'none'}`),
    ...(event.touches ?? []).map(touch => `         touch of ${named(world.characters, touch.of)} on ${named(world.characters, touch.to)}: ${
      touch.kind === NONE ? 'ended' : `${touch.kind}, ${touch.force}: ${touch.text}`}`),
    ...(event.traced ?? []).map(trace => `         trace on ${named(world.characters, trace.of)}: ${trace.label} ${trace.text}`),
    ...(event.wiped ?? []).map(trace => `         trace off ${named(world.characters, trace.of)}: ${trace.label} ${trace.text}`),
    ...(event.feels ?? []).map(feeling => `         private feeling of ${named(world.characters, feeling.of)}: ${feeling.text}`),
    ...(event.lingers ?? []).map(({ of, zone, kind, level, minutes, text }) => `         private lasting feeling of ${named(world.characters, of)}, ${zone}: ${kind}, ${level}${
      minutes === null ? '' : ` for ${minutes} min`}${text && `: ${text}`}`),
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
// after another, end a run: 3 when it is not given. `declinedRun` is how many requests that a service declined to
// answer end a run, wherever in it they came: 3 when it is not given. `invalidRun` is how many answers of one model's
// name that could not be used, with none of its answers used in between, end a run: 5 when it is not given. It counts
// cut and declined answers too. `cache` is a name of this world's journal that
// its keeper made up, the same for every run that continues it: each resident's requests and the world's then carry a
// name of their own made of it, as `cache` of a request, which says nothing of who that is. With none, no request has one.
// `onAsk` is told of every request just before it is sent: what it is for, where a figure's answer is told from the
// world's answer to a deed, whose it is, a resident's id or null for the world's, and the name of the model asked.
export type Live = Player & { world: World; cast?: { [id: string]: Player }; worldPlayer?: Player; minutes?: number; calls?: number; tokens?: number;
  onEvent?: (event: Event, by: string | null) => unknown; journal?: Store; pause?: boolean; cutRun?: number; declinedRun?: number; invalidRun?: number; cache?: string;
  onAsk?: (kind: Asked | 'reply', who: string | null, name: string) => unknown };
export type Tally = { calls: number; invalid: number; overlong: number; declined: number; unreported: number; inputTokens: number; cachedInputTokens: number; outputTokens: number };
// What a request was for: a resident's turn, a memory written anew, or an answer of the world, to a deed or for a figure.
export type Asked = 'turn' | 'memory' | 'world';
export type Spent = Pick<Tally, 'calls' | 'inputTokens' | 'cachedInputTokens' | 'outputTokens'>;
// `reason` is `horizon`, `calls` or `tokens` for a run that ended as planned, and the failure's code for one that did
// not, or `invalid` when `invalidRun` answers of one model's name could not be used in a row.
// `seconds` is the story time this run played. `rewrites` counts the memories written anew and `lost` those of them
// whose answer could not be used twice, so that the lines they were to keep are forgotten. `invalid` counts every
// answer that could not be used, whatever was asked, and `overlong` those of them that the model's own limit of one
// answer cut short, for which no tokens are known, and `declined` those of them that the service declined to write, for which none are known either. `unreported` counts the answers that arrived whole and came with no
// usage, so that the tokens are the sum over the others and not a total that looks whole. `cachedInputTokens` are those of the input tokens that the service says it read from its cache. `models` holds the same counts for each model's name,
// and `kinds` the calls and the tokens by what a request was for, so that a resident's turn is told from the world's answer when one model gives both.
// `refused` counts the answers of the world that could be read and that the rules of things did not take, and `void`
// the deeds and speeches to figures that nothing came of because neither of the two answers asked for could be used
// or taken, or because the service declined to write the one that was asked for. A run that a connection's failure ended keeps what the failure may say of itself besides its code: the
// HTTP status, and the service's own code and field name, when it had them. Never the service's words. `endpoints`
// counts, for a model whose connection says which endpoint of a router answered, the answers of each. No record
// keeps that: it is not of the story, and the same records give the same world whoever answered.
export type Outcome = Tally & { status: 'done' | 'failed'; reason: string; httpStatus?: number; providerCode?: string; param?: string;
  seconds: number; rewrites: number; lost: number; refused: number; void: number;
  models: { [name: string]: Tally }; kinds: { [kind in Asked]: Spent }; endpoints: { [name: string]: { [endpoint: string]: number } } };
// How many names of endpoints a run counts for one model; the answers of any further one are counted together.
const MAX_ENDPOINTS = 16;

const CUT = Symbol('cut'), DECLINED = Symbol('declined');
const spent = (): Spent => ({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
// Plays the world on from its journal until the horizon, the limit of model calls or tokens, or a failure.
// `calls` counts the answers that arrived or were cut short at the model's limit, a memory's as well as a turn's. Any
// other failure ends the run at once: nothing is tried again, and the journal holds everything up to it. `tokens`
// limits the reported input and output tokens before each request; the one that crosses it is the last.
export async function runLive({ world, respond, model, name, cast = {}, worldPlayer, minutes = 30, calls: most = 60, tokens, onEvent = () => {}, journal = memoryStore(),
  pause = false, cutRun = 3, declinedRun = 3, invalidRun = 5, cache, onAsk = () => {} }: Live): Promise<Outcome> {
  const given = world, state = replay(world, journal.entries());
  world = worldOf(given, state);
  const broughtFor = (actor: Person) => LAWS.map(law => law.due(world, state.laws, actor)).find(record => record !== null);
  const first = next(state.people);
  // Neither a vehicle's arrival nor what a law brings is due after the next person's free moment.
  const stands = state.deed?.at ?? Math.min(vehicleDue(world, state)?.at ?? first.freeAt, broughtFor(first)?.at ?? first.freeAt);
  const horizon = stands + Math.round(minutes * 60);
  const schema = schemaOf(given), shared = sharedOf(given);
  const outcome: Outcome = { status: 'done', reason: 'horizon', seconds: 0, calls: 0, invalid: 0, overlong: 0, declined: 0, unreported: 0, rewrites: 0, lost: 0, refused: 0, void: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    models: {}, kinds: { turn: spent(), memory: spent(), world: spent() }, endpoints: {} };
  // Who plays whom. Every request of a character, a turn or a memory, goes to its own connection under its own model.
  const everyone = { respond, model, name: name ?? model };
  const playerOf = (id: string) => { const player = Object.hasOwn(cast, id) ? cast[id] : everyone; return { ...player, name: player.name ?? player.model }; };
  // A tally is the totals' own property under the model's name, whatever the name: one like `constructor` finds nothing that every object has.
  const own = <Value>(under: { [name: string]: Value }, name: string, first: () => Value) => {
    if (!Object.hasOwn(under, name)) Object.defineProperty(under, name, { value: first(), enumerable: true, writable: true, configurable: true });
    return under[name];
  };
  // Whose request it is, for a service that keeps what it has read: a resident's turns and memories under one name,
  // the world's answers under another. A hash, so that the name holds no id of the story and not the journal's own name.
  const owned = (...whose: string[]) => cache === undefined ? {} : { cache: createHash('sha256').update(JSON.stringify([cache, ...whose])).digest('hex').slice(0, 32) };
  const tallyOf = (player: { name: string }) => own(outcome.models, player.name, () => ({ invalid: 0, overlong: 0, declined: 0, unreported: 0, ...spent() }));
  const invalids = new Map<string, number>();
  const unusable = (player: { name: string }) => {
    outcome.invalid += 1;
    tallyOf(player).invalid += 1;
    invalids.set(player.name, (invalids.get(player.name) ?? 0) + 1);
    if (invalids.get(player.name)! < invalidRun) return false;
    Object.assign(outcome, { status: 'failed', reason: 'invalid' });
    return true;
  };
  // The one way anything happens: the record goes through the rules, then to the journal, then to whoever watches.
  const happened = async (record: Record, by: string | null = null) => {
    const seq = state.seq;
    const event = advance(given, state, record);
    world = worldOf(given, state);
    journal.append([{ seq, record, event, by }]);
    await onEvent(event, by);
  };
  // One answer of a player's model, or null when the run ends here instead. Nobody is moved to another model.
  // An answer that the model's own limit cut short is `CUT`: it was asked for and counts as a call, it cannot be used,
  // and the run goes on as after any answer that cannot, until `cutRun` answers of one model's name have been cut
  // with none of its answers arriving whole in between: a model that only writes to its limit would spend every
  // call the run has. A request that the service declined to answer is `DECLINED`: it counts as a call, it is not
  // sent again, and what was asked for is let go as after answers that could not be used, until `declinedRun` of them
  // in the run: a service that keeps declining is not asked on. Every other failure of the connection ends the run.
  const cuts = new Map<string, number>();
  const ask = async (player: Required<Player>, kind: Asked, content: Omit<Request, 'model'>, who: string | null = null, asked: Asked | 'reply' = kind): Promise<string | typeof CUT | typeof DECLINED | null> => {
    if (outcome.calls >= most) {
      outcome.reason = 'calls';
      return null;
    }
    if (tokens !== undefined && outcome.inputTokens + outcome.outputTokens >= tokens) {
      outcome.reason = 'tokens';
      return null;
    }
    onAsk(asked, who, player.name);
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
      if (error.code === 'declined') {
        for (const tally of [outcome, tallyOf(player), outcome.kinds[kind]]) tally.calls += 1;
        for (const tally of [outcome, tallyOf(player)]) tally.declined += 1;
        unusable(player);
        if (outcome.declined < declinedRun) return outcome.status === 'failed' ? null : DECLINED;
      }
      Object.assign(outcome, { status: 'failed', reason: error.code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
        ...(error.providerCode ? { providerCode: error.providerCode } : {}), ...(error.param ? { param: error.param } : {}) });
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
    if (answer.endpoint !== undefined) {
      const counts = own(outcome.endpoints, player.name, () => ({}));
      const known = ENDPOINT.test(answer.endpoint) && (Object.hasOwn(counts, answer.endpoint) || Object.keys(counts).filter(name => name !== OTHER_ENDPOINT).length < MAX_ENDPOINTS);
      const endpoint = known ? answer.endpoint : OTHER_ENDPOINT;
      Object.defineProperty(counts, endpoint, { value: own(counts, endpoint, () => 0) + 1, enumerable: true, writable: true, configurable: true });
    }
    return answer.text;
  };

  // One record at a time, in the order of the story's clock, and each step looks only at what the journal amounts to,
  // so a run that stops between any two steps continues as if it had not. Characters in different places who are free
  // at the same moment cannot perceive each other's actions, apart from a call: their calls to the model could run in
  // parallel here.
  const judge = { ...(worldPlayer ?? everyone), name: worldPlayer ? worldPlayer.name ?? worldPlayer.model : everyone.name };
  const worldSystem = worldSystemOf(world), figureSystem = `${figureInstructionsOf(traced(world))}\n\n${aboutOf(world)}`;
  // The world's answer to a deed or for a figure: `read` gives it as it can be taken, or null. An answer that cannot
  // be used is asked for once more as it was, and one that the rules of things refuse once more with the sentence
  // that says why. After the second nothing came of the deed. A refused answer never reaches the journal.
  const answered = async <Came extends Partial<Answer> & { moves: Answer['moves'] }>(deed: Event, system: string, schema: object, content: string, read: (answer: string) => Came | null) => {
    let came: Came | null = null, again = '';
    for (let attempt = 0; attempt < 2 && !came; attempt += 1) {
      const answer = await ask(judge, 'world', { system, schema, ...owned('world'), messages: [{ role: 'user', content: `${content}${again}` }] }, null, system === figureSystem ? 'reply' : 'world');
      if (answer === null) return null;
      // The world is not asked again for what it declined to answer: nothing came of the deed.
      if (answer === DECLINED) break;
      came = answer === CUT ? null : read(answer);
      const refused = came && refusal(world, state.people, state.things, deed, came, state.traces);
      if (!came) { if (unusable(judge)) return null; }
      else if (!refused) invalids.delete(judge.name);
      if (refused) {
        outcome.refused += 1;
        [came, again] = [null, `\n${againOf(refused)}`];
      }
    }
    if (!came) outcome.void += 1;
    return { came };
  };
  for (;;) {
    world = worldOf(given, state, state.deed?.at ?? next(state.people).freeAt);
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
      const place = world.places.find(item => item.id === deed.place)!, here = state.people.filter(person => person.place === deed.place).map(person => person.id);
      const sleepers = sleepersNear(state.people, place).map(person => person.id), hidden = state.things.places.get(deed.place)!.filter(thing => thing.hidden).map(thing => thing.label);
      const held = world.touch ? touchesIn(state, place.id) : undefined;
      const lasting = world.marks ? { marks: here.flatMap(id => marksOf(state, id, deed.at)), at: deed.at, end: deed.at + deed.seconds } : undefined;
      const got = await answered(deed, worldSystem, resultSchemaOf(state, place, world), deedOf(world, state, deed), answer => {
        // What is heard next door of a deed in a place with no place next door is nothing, whatever the answer says.
        const came = readResult(answer, sleepers, here, hidden, held, lasting, state.traces ? labelsOn(state.traces, here) : undefined);
        return came && { ...came, beyond: place.nextDoor.length ? came.beyond : null };
      });
      if (!got) return outcome;
      // A deed that nothing came of changed no touch, mark or trace either.
      await happened({ kind: 'result', who: deed.who, at: deed.at, ...(got.came ?? { text: null, wakes: [], moves: [], sets: [], poses: [], feels: [], beyond: null, search: false, finds: [], ...(held ? { touches: [] } : {}), ...(lasting ? { lingers: [] } : {}),
        ...(state.traces ? { traces: [], wipes: [] } : {}) }) }, judge.name);
      continue;
    }
    const actor = next(state.people);
    const now = actor.freeAt, who = actor.id, mind = state.minds.get(who)!;
    // What the clock brings by a law comes first, and no model is asked: the weather changes before anyone acts at
    // that moment, and someone awake to the limit falls asleep at its turn.
    const brought = broughtFor(actor);
    const parked = vehicleDue(world, state);
    if (parked && parked.at < horizon && (!brought || parked.at < brought.at || (parked.at === brought.at && brought.kind !== 'weather'))) {
      await happened(parked);
      continue;
    }
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
      const request = { system, schema: MEMORY_SCHEMA, ...owned('resident', who),
        messages: [{ role: 'user' as const, content: [...known(mind, folding), rewriteOf(world, nowOf(world, actor, now), actor.asleep)].join('\n') }] };
      // An answer that cannot be used gets one more try. After that the old text stays and the lines are lost.
      let memory = null;
      for (let attempt = 0; attempt < 2 && !memory; attempt += 1) {
        const answer = await ask(player, 'memory', request, who);
        if (answer === null) return outcome;
        if (answer === DECLINED) break;
        memory = answer === CUT ? null : readMemory(answer, world.longWords);
        if (!memory) { if (unusable(player)) return outcome; }
        else invalids.delete(player.name);
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
        ? [`- ${tagged(character)}${person.asleep ? ', asleep' : ''}${LAWS.map(law => law.seen?.(world, state.laws, person, now) ?? '').join('')}.${seen(character, person)}${onOf(state, person.id, 'On them')}${carries('Carries', person.id, false)}`] : [];
    });
    const limit = pause ? MAX_WORDS : wordLimit(world, horizon - now);
    const spot = world.places.find(item => item.id === place)!;
    const body = `${part('Your pose', actor.pose)}${onOf(state, who, 'On you')}${carries('You carry', who, true)}`.slice(1);
    // The touches of the place, one line each. Each of the two is told its kind, its force and how long it has
    // lasted, under the line of their own pose; anyone else there sees that the two touch, how and where, after the
    // lines of the others. The text says with what the one touches and where on the other, from either side.
    const called = (id: string) => named(world.characters, id);
    const touches = touchesIn(state, place), mine = touches.filter(touch => touch.of === who || touch.to === who);
    const touching = mine.map(touch => `${touch.of === who ? `You touch ${called(touch.to)}` : `${called(touch.of)} touches you`} (${touch.kind}, ${touch.force}, for ${lasted(touch, now)}): ${closed(touch.text)}`);
    const watched = touches.filter(touch => !mine.includes(touch)).map(touch => `${called(touch.of)} touches ${called(touch.to)} (${touch.kind}): ${closed(touch.text)}`);
    // The lasting feelings of the resident's own body as they are now, one line each, after what the laws say of
    // it: the zone, the kind, the level and the text, and no time, since nobody feels how long a relief will last.
    const lasting = feltOf(marksOf(state, who, now)).map(({ zone, kind, layers: [{ level, text }] }) => `Your ${zone === 'body' ? 'whole body' : zone} (${kind}, ${level}): ${closed(text)}`);
    const answer = await ask(player, 'turn', { system, schema, ...owned('resident', who), messages: [{ role: 'user', content: [
      ...known(mind, mind.lines),
      `${nowOf(world, actor, now)} You are in ${tagged(spot)}${spot.vehicle ? spot.vehicle.heading
        ? `, on the way to ${tagged(world.places.find(place => place.id === spot.vehicle!.heading!.to)!)}, ${Math.floor((spot.vehicle.heading.at - now) / 60)} min ${(spot.vehicle.heading.at - now) % 60} s of the drive are left`
        : `, standing at ${tagged(world.places.find(place => place.id === spot.vehicle!.at)!)}${spot.vehicle.route ? `, leaving for ${named(world.places, spot.vehicle.departure!.to)} in ${Math.floor((spot.vehicle.departure!.at - now) / 60)} min ${(spot.vehicle.departure!.at - now) % 60} s` : ''}` : ''}. ${others.length ? 'Here with you:' : spot.figures.length || spot.crowd !== null ? 'None of the people of the list is here with you.' : 'Nobody else is here.'}`,
      ...others, ...watched,
      ...vehicleView(world, state, actor, now).map(([, text]) => text),
      ...(spot.figures.length ? ['People of this place, who answer when you say with `to`:', ...spot.figures.map(figure => `- ${tagged(figure)}.${part('Looks', figure.looks)}`)] : []),
      ...(spot.crowd === null ? [] : [`Around you: ${closed(spot.crowd)}`]),
      ...(body ? [body] : []), ...touching,
      ...LAWS.flatMap(law => law.turn(world, state.laws, actor, now) ?? []), ...lasting,
      ...(spot.vehicle ? [] : [`Minutes from here: ${world.places.filter(item => item.id !== place && !item.vehicle).map(item => `${tagged(item)} ${travelSeconds(world, place, item.id) / 60}`).join(', ') || 'there is no other place'}.`]),
      `This turn the \`text\` of a say or a call may hold ${limit} words at most.${
        pause ? '' : ` ${Math.floor((horizon - now) / 60)} min ${(horizon - now) % 60} s of the story are left.`}`,
    ].join('\n') }] }, who);
    if (answer === null) return outcome;
    const action = answer === CUT ? 'long' : answer === DECLINED ? 'declined' : readAction(world, actor, answer, state.people, state.things);
    if (typeof action === 'string' && answer !== DECLINED) { if (unusable(player)) return outcome; }
    else if (typeof action !== 'string') invalids.delete(player.name);
    const vehicle = spot.vehicle, drive = vehicle && typeof action !== 'string' && action.action === 'go' && action.place !== vehicle.at
      ? { vehicle: spot.id, from: vehicle.at!, to: action.place!, at: now + driveSeconds(world, vehicle.at!, action.place!, vehicle.faster) } : undefined;
    await happened({ kind: 'act', who, at: now, limit, action, ...(drive ? { drive } : {}),
      ...(action === 'fare' ? { place: JSON.parse(answer as string).place } : {}) }, player.name);
  }
}
