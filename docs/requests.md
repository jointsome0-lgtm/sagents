# Live requests

What residents, the world and figures receive and answer is here.
[The mechanisms](mechanisms.md) apply those answers; [the live commands](live.md) run the world.

## What a model is sent

`sharedOf`, `systemOf` and `runLive` in `src/live.ts` build a resident's request anew: its fixed instructions,
name and sheet, and one message of memory, perceived lines and current surroundings. No earlier request or
answer is resent, and no resident receives another's sheet, note or memory, or an unperceived event.
The fixed opening gives the world's title and public description, the ordinary places with ids, descriptions
and neighbours, the played people's names and the means of remote contact. With vehicles it lists their name,
id, description, seats and allowed drivers by name, or anyone; a bus instead gives route, times and fare.
The list opens `Vehicles:`. It never gives their position and stays fixed; the action schema names vehicles from the first turn, even as they move.
Only worlds with vehicles add the vehicle rule line, with the round and automatic fare clauses only when relevant.

A turn lists figures here under ``People of this place, who answer when you say with `to`:`` only when some are here,
then names any away figures with their hours. Without another resident here, the choice of nobody or no played people
counts only figures here and the crowd. `runLive` in `src/live.ts` builds these lists. It lists the crowd as
`Around you: …`. It gives its owner its pose, traces and carried things three levels deep with counts. For people in its place
it gives looks, pose, traces and visibly carried things. Open containers show contents; closed ones conceal them.
It gives figures' names and looks, the crowd, sleep debt, its owner's hunger and thirst when needed, local weather,
its own lasting feelings and touches it holds or sees. It gives current place and walking times to ordinary places
when outside a vehicle. Inside it gives the stop or destination and minutes and seconds to departure or arrival,
never an arrival clock time. A vehicle elsewhere is not revealed. A place's things are learned by a deed and its
answer; hidden things and all facts are withheld. Its own looks are in the system text.

The `action` is `say`, `call`, `go`, `do`, `wait` or `sleep`, with an optional private `note` written before the action.
The note is what goes on in the character now, what it notices, feels, wants and holds back, rather than a plan.
A `say` can have a `gesture`, what its face, hands or body do, seen with the speech but not sent to the world.
Only a figure here at the turn's moment can be its `to`; `readAction` in `src/action.ts` drops any other `to`,
saying the speech to the room without a reply request. A speech begun while the figure is here is answered.
A `do` can have `says`, spoken aloud
before the world answers; the world still receives the deed alone. [Gestures, words and note order were checked
together](measured.md#gestures-words-and-notes), without counting whether the action follows its note.
`schemaOf` in `src/live.ts` lists the world's actions and place ids, omitting `call` without remote contact.
The other fields are text or null, or a whole number or null for `seconds`. [The turn schema check](measured.md#turn-schemas)
compared invalid destinations; a server ignoring the schema can still write one, which the rules refuse.

`worldSystemOf`, `deedOf`, `placeOf` and `hereOf` in `src/live.ts` build a deed's request. It has the world's
description and facts, the place and its facts, listed and hidden things, ordinary other places, the clock, doer,
deed and span. For people here, awake or asleep, it has name, id, looks, pose, things and facts; for neighbours
only names, ids and whether awake or asleep, or nobody. `crowdOf` in `src/live.ts` gives the crowd and figures here
with looks and facts at the deed's moment, followed by the away line,
recent deeds, and recent speeches to figures and their answers. With deed ends it describes the place when the
answer is due, and `doingOf` in `src/live.ts` also lists other deeds still going here. A vehicle inside has its
description and the places between which it drives or the stop where it stands; a deed outside sees only vehicles standing there.
It has optional [traces](mechanisms.md#traces), [touches](mechanisms.md#touches) and [lasting feelings](mechanisms.md#lasting-feelings). It has no sheet, note, memory or speech
between residents. [The port's deed checks](measured.md#deed-requests-on-the-main-line) do not measure what
these mechanisms change in a story.

Every listed thing's facts reach the world, whether hidden, carried or nested, for deeds and figure replies.
They follow the place's facts as sentences without labels or headings, once per identical text at its first record:
`The place: Red room (red), under a roof. Red walls. Facts: FACT-RED. FACT-KEY.`
A part taken from a stock or count keeps its facts; counts merge only with identical facts.
In `examples/night-pass.json` the guest register, backpack, map and notebook carry their own texts.
This layout avoids a labelled facts block that led a weak model to move things against the lists;
[the combined check](measured.md#facts-of-things) did not isolate each part of the request.

`resultSchemaOf` in `src/live.ts` and `readResult` in `src/answer.ts` hold the world's answer and its checks.
The answer lists entries before its prose `result`, so words cannot lead the entries. [Both orders were checked](measured.md#order-of-the-world-answer).
With traces, `traces` and `wipes` come last, after `result`, in that order; [that order's checks](measured.md#traces-in-the-answer)
were on the earlier line. Each request's schema enumerates allowed labels, ids and states. An empty enum takes
any string because a strict schema may refuse an empty list; all states share one list, so it cannot hold a state
to its own thing. Code then drops out-of-place `finds`, `poses` and `feels`, or `wakes` naming no sleeper here or
next door. Invalid moves or states refuse the whole answer. More than 12 moves or 6 state entries makes it unusable.
Answer texts are cut at their word limits. An empty `beyond` is null, and an empty pose clears the pose.

| Answer field | Meaning and limit |
| --- | --- |
| `search` | Whether the deed searched the place. The rules count its seconds. |
| `finds` | Labels of hidden things whose exact spot the deed went straight to. Unknown labels are dropped. |
| `moves` | Entries `{ what, n, to }`: thing label, count and destination, a person here, this place, a container label, `eaten` or `burned`, and with portions `tasted` for a third of one food, with `n` 1. No `from`; the rules already know it. |
| `sets` | Entries `{ what, state }`, changing a thing to one of its states. |
| `poses` | Entries `{ of, text }`, where and how a person here is; 20 words. A pose names no other place. |
| `touches` | Only with touch, after `poses`, before `wakes`; entries `{ of, to, kind, force, text }` described under [Touches](mechanisms.md#touches). |
| `wakes` | Sleepers here or next door whom the deed wakes. |
| `feels` | Entries `{ of, text }`, bodily feeling, not a thought or wish; 20 words, later entry per person wins. Only that owner receives `You feel: …`, even with no result. No sleeper, including one woken by this deed, figure, traveller or person elsewhere gets it. Empty entries are dropped. |
| `lingers` | Only with marks, after `feels`, before `beyond`; entries `{ of, zone, kind, level, minutes, text }` described under [Lasting feelings](mechanisms.md#lasting-feelings). |
| `beyond` | Sound next door, text or null, at most 20 words. |
| `result` | One or two sentences anyone here could see, hear or smell, 65 words at most, or null for nothing noticeable. |
| `traces` | Only with traces, entries `{ of, text }` left on people here. |
| `wipes` | Only with traces, labels of traces removed from people here. |
| `leads` | Only with ways, first before `search`: this place's id to stay here, another id for the doer's way there. |

`replyOf`, `replySchemaOf` and `figureInstructionsOf` in `src/live.ts` build a figure's request. It has the deed
request's place and people, without hidden things, neighbours, touches or lasting feelings. It includes crowd,
figures here with looks and facts at the speech's moment and the away line through `crowdOf` in `src/live.ts`,
recent deeds, and the latest 300 words said to the figures of this place and answered.
These lines are shared by all figures, not a figure's private memory. The answer has `reply`, up to 65 words or
null, and `moves` for something handed over while speaking. A figure's things are among the place's things;
it cannot eat or burn through its answer. With `prices`, moving a priced thing that lies in the place sells it,
wherever it ends up; the one who spoke pays into the place's till, and what arrives has no price. A thing left
where it is sells nothing, and neither does a priced thing that a deed has put into someone's hands or into a
place with no till. `reply` in `src/answer.ts` starts the answer when the speech ends and
holds those who heard it as speech does; it wakes nobody, and `applied` in `src/journal.ts` writes it into their
memories at that time. A deed's request includes what figures promised, too.

