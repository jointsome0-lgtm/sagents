# Measurements and decisions

These are the checks reported in the README before its reference was brought together.
They describe those runs and wordings, including their limits; they are not promises of later runs.

## Release 0.1.0, first command

```
12:50:00 [Café «Anchor»] Nina to Raya (a small smile and a wave of the hand): "Could I have a coffee, please?"
       private note of Nina: I'm early, but the wind is quite strong. I should get a drink before Oleg arrives so I'm settled.
12:50:00 [Café «Anchor»] Raya answers Nina: "Of course, dear. I'll bring it right over."
12:50:00 [Beach] Oleg leaves for Café «Anchor» (192 s)
       private note of Oleg: I should head to the cafe now so I'm not late for Nina. I'm really looking forward to that fish.
...
done (calls): 3.9 story minutes, 12 calls, 0 invalid, 0 of them cut at the output limit, 0 of them declined by the service, 0 memory rewrites, 0 lost, 0 answers of the world refused, 0 deeds left with nothing, 24134 input tokens, 3520 of them cached, 1281 output tokens
api:google/gemma-4-31b-it: 12 calls, 0 invalid, 0 of them cut at the output limit, 0 of them declined by the service, 24134 input tokens, 3520 of them cached, 1281 output tokens, answered by CoreWeave 8, ModelRun 1, Venice 1, DeepInfra 2
turns: 10 calls, 20383 input tokens, 3520 of them cached, 1173 output tokens
memory rewrites: 0 calls, 0 input tokens, 0 of them cached, 0 output tokens
answers of the world: 2 calls, 3751 input tokens, 0 of them cached, 108 output tokens
```

These are the first lines and the totals of a real run: the check of release 0.1.0 ran `node src/cli.ts live examples/seaside-cafe.json --model api:google/gemma-4-31b-it --calls 12` as it stands
on OpenRouter with Gemma 4 31B, with nothing set but the address and the key, from a copy of the repository with
nothing installed. The clone and the line of the key were not run in that check, and a model writes something else
every time. The model's own line is there because that router names the endpoint that answered. The four endpoints
are its choice for a run that is told nothing: [A server of your own](connection.md#a-server-of-your-own) says how one is named
and what share of a request was then read from a cache.

## Servers with no schema

A server refusing `response_format` and one answering plain text were played against a stand-in for such a server on the same computer.
When it answered HTTP 400, the totals began `failed (invalid_request 400 unsupported_parameter response_format)`,
the server's own code and field name after the status. When it answered in plain text, no answer could be used and
each counted as a wait of 30 seconds, which prints no line, so that check printed only its totals, `done (calls)` with
as many `invalid` as `calls`.

## Gestures, words and notes

Gestures with speech and words with deeds were measured together with the note's place in a rain scene of two, 160 requests: Gemma 4 31B gave a gesture with 11 speeches of 11 and words with 10 deeds of 13, GPT-6 Luna at low effort a gesture with 18 speeches of 18 and words with none of 7 deeds. The note is the first field of an answer, so that it is written before the action is chosen: in that measurement it was the first field written in 28 answers of 28 on Gemma and in 32 of 32 on Luna, where the action had been first before; whether an action now follows from its note was not counted.

## Translated examples

Every other measurement reported here was made on the Russian texts. The translated examples
were played for release 0.1.0 on Gemma 4 31B through OpenRouter, 132 requests in all: each example for 36, with the
model's reasoning off and one endpoint of the router named as the only one that may answer, and the station and the
café for 12 more each by the first command in the README, with nothing set but the address and the key. Every request
was answered, every answer could be used, and nothing was written in Russian. `examples/night-station.json` lists no
things, so in its two runs the world answered all 7 deeds, 6 of them searches, with nothing found; the other two
examples list theirs. Earlier that day, on the engine before its last two changes, the café was played once on a
rented card, by a small Gemma (E2B) under vLLM behind a gateway, as a stream: 16 requests, of which 15 were answered
before a failure of the connection ended the run, and 9 of the 15 answers could not be used.

## Arrivals at one instant

On GPT-6 Luna, in a scene where two leave together, 81 requests, both were in the place before anyone took a turn in 4 leavings of 4, against a turn between the two arrivals in 4 of 4 on the engine before; the rule changes no text that a model reads, so it was played on no second model.

## Speech rates

Individual speech rates are checked with stand-ins only and played on no model: no text that a model reads changes with it.

## Buses on the main line

These bus rules were checked with stand-ins on the other line; this port onto the main line was played in two runs with a bus, 38 requests by the smaller hosted model at low effort and 40 by the open model, and in both a pair paid the fare at boarding and rode.

## Vehicles on the main line

Those rules were checked with a stand-in on the other line; this port onto the main line was played in four runs of 79 requests each in a world with a car, one by the smaller hosted model at low effort and three by the open model, each with one drive and one parking, and in a line of 150 requests by the smaller model in a world with `ways`. Before those, two runs with a car, 38 and 40 requests, were played by the same two models, each with one drive and one parking.

## Hunger and thirst

In its first
form, with the body's line always there, `You are not hungry.` and `You are not thirsty.` among its sentences,
and a meal lifting a lower count to minus 2 hours, it was played in two lines of one synthetic week: 141 requests
by the smaller model at low effort and 685 by an open model of 31B. In both, residents who were awake drank and
ate within minutes to an hour and a half of a sentence that named a need, and had breakfast soon after waking
hungry; and in both a resident took `You are not hungry.` for a reason to refuse an agreed supper, which is why
the line now says only what is not fine. The form described in the README was played in the same week: 162 requests by
the smaller model, and three starts of 450, 257 and 250 requests by the open model. Three of the four reached a
supper, and all six residents ate at it; one start reached the next morning, where both had breakfast within
twenty minutes of waking. One start of the open model spent its 250 requests on a single story hour and reached no meal.

## Turn schemas

Going to an unknown place cost a resident played by a weak model
14 turns of 28 in one run and 3 of 23 in another.

Under `oneSchema` the field `memory` stands last in the turn schema. With it first, Gemma 4 31B through OpenRouter
filled it in ordinary turns of a walk of two: in 51 of 136 turns of three plays of 60 requests, in 15 of 123 on a
copy of that world mended of a contradiction, and in none of 35 on a copy whose short memory folds early. With it
last it filled it in none of 219 turns of five plays, and all 10 of its memory rewrites were read. The accepted engine
then played through the same router two walks of 60 requests, a folding copy of 50 and three starts that the router
cut short: it filled it in 1 of 131 turns, which was read as its action with the memory dropped, and all 9 of its
memory rewrites were read. GPT-6 Luna at low effort filled it in neither place: in none of 130 turns of three plays
with it first, and in none of 98 turns of three plays with it last, where all 13 of its memory rewrites were read.

## Facts of things

A block of these facts under
labels, after the lists, was tried first: next to the `In the lists:` tails of the earlier lines a weak model then
moved things to where no deed had put them. This layout as the engine writes it was then measured on a set of
62 deeds, 25 with things, 14 with facts of things, 8 with clothes and 15 after a line gone stale: Gemma 4 31B
gave exactly the due entries in 54 answers of the 60 that arrived and GPT-6 Luna at low effort in 49 of 62.

## Deed requests on the main line

A candidate played on real models over an earlier engine, still awaiting measurement over 0.1.1: the deed request lists traces under their labels after each person's looks and pose. Those notes describe the other line; the port is counted in [Body mechanisms on the main line](#body-mechanisms-on-the-main-line).

## Order of the world answer

Entries before result prose and result prose before entries both passed the check of 2026-10-05 on the weak
local model.

## Traces in the answer

This order was played on two models on the other line and is the one taken
here; the port is counted in [Body mechanisms on the main line](#body-mechanisms-on-the-main-line).

## Feelings during a deed

The text of `feels` passed the check of
2026-10-05 on a strong model and on two weak ones. In two whole runs of that day with the weak local model as the
world, 120 requests each, 9 deeds of 52 got a feeling and each was told to its doer alone: three where one was
due, cold, smoke and the heat of a stove, and six for the ordinary handling of a thing, such as keys taken into
the hand or boots pulled on. Nobody touched anybody in those runs, so entries for two bodies have been seen only
in single requests. The sentence of the field is narrower since those runs: it says that an entry is read right
after `You feel:`, so that it begins with what is felt and names nobody, that the touch is of another body, and
that the ordinary handling of a thing gives no entry. This wording has stood in the world's requests of every measurement since, but what it changed by itself was not counted.

## Body mechanisms on the main line

This candidate was played on real models over an earlier engine and still awaits
measurement over 0.1.1. Those notes describe the other line; this port onto the main line was played in eight runs of 79 requests each, two by the smaller hosted model at low effort and six by the open model. In them 20 touches began, 74 answers told what a body felt, 2 lasting feelings were set, 4 traces were written and 6 wiped: the mechanisms run, and what they change in a story is what still awaits measurement.

## Sound next door

The world's text with the facts of things, the places next door and `beyond` was measured as a
whole on the set of 62 deeds in [Facts of things](#facts-of-things); what is heard next door was not counted by itself.

## Ways by deeds

### Live line with the fourth wording

The `ways` setting was read in probes of one deed, where a scripted
resident does a deed and the world answers it, and played in one line of 300 requests by the smaller model at
low effort with the fourth of its wordings: the line's 52 deeds sent nobody on a way they did not take, and
only one of them was a way, whose answer the rules refused.

### The probe set

Six wordings were tried over 75 deeds: ways to
another place on foot, by a stair, through a door and by car, gestures towards another place, moves within a
place, and one drive that the rules bar. The smaller model at low effort read all six, in 906 requests over
their rounds.

### First four wordings on the smaller model

In one round each: the first, with `goes` and null, read 69 of the 75 as meant and sent four on a
way they did not take; the second, which added the places a told refusal would name, 72 and two; the third,
which asked where the doer is when the deed is done, 67 and none, for a driver was then still in the car and a
walker still on the way; the fourth, which is the final wording without the request's last sentence, 74 and
none, and over three rounds of the 25 oldest deeds 74 of the 75 trials.

### Fourth wording on the open model

An open model of 31B read
the fourth as well, in one round: every way and every move within a place as meant, and two gestures of 25, a
hand on a rail and a door held open, as the way out of a place named "Inside the lighthouse" to its neighbour
named "Lighthouse", whose id it took for the id of the place it stood in.

### Fifth wording

The fifth wording says this place's
id in the request's last sentence. With it the open model sent nobody away and missed one way of 33, in one
round, and the smaller model in three rounds sent nobody away and missed six ways of 99, five of them a seat
taken in a car that stood by, which the request does not list among the other places.

### Sixth wording

The sixth wording, adds
the vehicle to that sentence where one stands by: in two rounds and 62 deeds of a third, which a failure of
the service cut, the smaller model sent nobody away and missed three ways of 94, none of them a seat taken in
the car. The open model read the sixth in two rounds, 150 deeds: every one of the 66 ways as meant, and nobody
sent away.

### Limits of the fourth and fifth comparison

Of the fourth and the fifth wording it read one round each: its two gestures against none are too
few to prove the sentence.

### Live line with a car

A line of 150 requests by the smaller model in a world with a car had 14 deeds, one
of them a seat taken in the car, which was read as the way; nobody else was sent anywhere.

## Earlier deeds and stale lists

In two whole runs of 2026-10-05, when a place kept only the
deeds whose result had words, a weak model twice answered by an earlier line against the lists: money still on
a counter after it had been pocketed, and keys gone from a box after they had been put back. Whether a weak
model reads the lists better with the new lines has not been seen in a whole run.

## Traces, first checks

The trace candidate was played on real models over an earlier engine, still awaiting measurement over 0.1.1. Those notes describe the other line; this port onto the main line is played
on no model.

## Traces, unchanged examples

With no character's `traces` field, requests, records and events were unchanged, which a comparison of hashes over the three examples on the other line confirmed.

## Memory endings

In two plays on a hosted model at low effort three rewrites closed the
string with `»}` and went on inside it, with the model's own words or with noise in several scripts.

## Memory script guard

The memory script guard changes no text a model reads and was played on no model.

## Judge measurements

Earlier wordings of the instructions were measured on GPT-6 Luna at low effort over two synthetic journals
with planted faults. The checks use stand-ins.

### First check

The first check used 11 requests.

### Second check

The second check used 40 requests. No answer was unusable, and three of six runs ended before the records had been read:
one reported at once, one read only the index, and one stopped at 61 of 88 records, which is what the question
about an early report is for.

### Third check

A third measurement, 52 requests over
twelve readings, read every record in each.

### First readings of played runs

A first reading of the journals of seven played runs of invented
scenes, twice each by a small model at medium effort, led to showing what a rewrite folded and the memory it
replaced, and to `drop`.

### Fourth check

A fourth measurement, 63 requests after the eighth pass, saw findings about memory in the six readings of the
three journals with rewrites fall from about 18 to 3, all three still false.
The planted loss of a time set was found in none of three readings where it had been found in all three.
Of the planted faults at medium effort, 16 of 33 were found where 24 of 33 had been.
The sentences on what a rewrite is asked to keep and on what a person does not know come from this measurement.

### Fifth check

A fifth, 77 requests after the ninth pass on the same model at medium effort, found 27 of 55 planted faults and
the planted loss of a time set in 2 of 5 readings, and kept 5 findings about memory in the six readings of the
three journals with rewrites, all five false: those sentences changed little.

### Larger model, eighth pass

The eighth pass on a larger model,
gpt-6.1-sol at high effort, 36 requests over five readings, found 27 of 28 planted faults and handed in nothing
but faults those two journals are known to have: the small model, more than the wording, is what holds the judge
back.

### Sixth check

After the fifth, the sentence on what a person knows was narrowed, and the one on a rewrite names what it
is asked to begin with: a sixth measurement, 28 requests on the small model, found 17 of 33 planted faults, the
same half.

### Larger model, tenth pass

The larger model at high effort then read with the tenth pass the journals of five played runs and the
two with planted faults, 56 requests, one of which failed and left a reading without its summary. Of the 16
findings it handed in on the played runs, 11 held when checked by hand against the records, one of them about
memory, and 5 did not. Three of the five called it a fault that a person acted before the seconds of their deed
had passed: the instructions said that speech nearby ends a wait early and nothing of a deed, which ends early in
the same way. The other two came of a record this judge does not know, written by a candidate that makes places
on demand. In the two journals with planted faults it found 10 of 11, the two faults one of them is known to have
besides, and one more that held when checked.

### Changes after the tenth pass

The sentence on being busy now says when a deed, a wait and a
sleep end early, and the sentence on what a person knows was made longer twice more by reviews, which found the
world's title, the neighbours of the places and the people whom no model plays missing from it: in these forms
neither has been measured on any model yet.

### Fifteenth review

The review of the fifteenth pass, which read only what that pass
changed, was the first to ask for no change.

## Lab browser checks

In its review the page was
opened in Chrome over synthetic runs, in English: the list with its groups, the folded rehearsals, the narrowing, the
feed, the transcript and the numbers. The Russian page was opened in the review of the command too, over synthetic
runs: the list, the feed and the numbers.

## Lab map checks

The map was checked without a browser: its positions as tables and its drawings as SVG files made by the layout
code that the page uses, over the three example worlds and a synthetic one played by a stand-in for the model, and
the page's script was run through over a stand-in for the document.

## Router cache

- A router that is told nothing may spread the requests of one run over its endpoints, and then little of a request
is read from a cache. In the check of release 0.1.0, on OpenRouter with Gemma 4 31B, two runs of 12 requests with
nothing set but the address and the key were answered by three and by four endpoints, and 7 and 15 percent of their
input tokens were read from a cache. Three runs of 36 requests whose `SAGENTS_API_EXTRA` named a session and the one
endpoint that may answer, `{"reasoning":{"enabled":false},"session_id":"<a name of the run>","provider":{"quantizations":["fp4"],"order":["<endpoint>"],"allow_fallbacks":false}}`,
were each answered by that endpoint alone and read 71 to 75 percent, 64 to 71 in their first 12 requests. For the
café, the one world played both ways, that is 71 percent of 24,247 input tokens against 15 percent of 24,134. These
are OpenRouter's own fields, which of them made the difference was not taken apart, and nothing else was compared.

## Plan cache

The plan's route reads far more of a request from its cache with `prompt_cache_key`, `session-id` and `x-client-request-id`:
8 or 9 requests of 20 against 1 to 3 without.

## Connections used

The code's checks talked to stand-ins and nothing else. Beyond them it had been used with one account of a
ChatGPT plan and two chat completions servers, OpenRouter and vLLM behind a gateway on a rented card.
What another account or server does differently was not known.

## Numbers of kept runs

```sh
sagents numbers <dir>... [--json]
```

`numbers` reads directories kept by `live --run` and prints one table, a column under each directory's name.
It joins every stretch in numbered order, asks no model, sends nothing and writes nothing; SQLite is never
opened. `--json` gives one object keyed by those names, with the same row names and numbers, and null for `-`.
Repeated directory names get ` (2)`, ` (3)` and so on. A directory that is not a kept run is named on standard
error; the others are still printed, and the command ends with a code that is not 0.

The rows are:

- Requests, all and by the kinds of the usage rows, in their first appearance's order.
- Story minutes from the first event to the end of the last, and story minutes for 100 requests, both to one
  decimal.
- Actions of residents, all and by kind: `say`, `call`, `go`, `do`, `wait`, `sleep`. Driving counts as going.
  With deed ends a `stop` counts too and has its own `actions: stop` row.
- Actions that led somewhere, and their share of all actions as a whole percent: a speech or call somebody
  heard, a going that set out, or a deed with a result. Waiting, sleeping and stopping never count.
- Deeds without a result and their share of deeds as a whole percent, the longest row of them by one resident,
  and how many rows of two or more there were. A result has null text, nothing moved, set or found, and is no
  search for the deed to count as without a result. Another action of that resident or a deed with a result
  ends its row, including a `stop` with deed ends; another resident's action does not.
- Deeds cut short, only when result events carry `planned`; these have `worked` below `planned`.
- Places residents were in, including their starting places and door crossings, and how many the world has,
  including vehicles. Setting out alone does not count the destination as visited.
- Input tokens, cached input tokens and their share of input as a whole percent, output tokens, and mean input
  tokens per request as a whole number, all and for each run's two commonest kinds. A tie keeps the first
  appearance's order.
- Answers that could not be used, memory rewrites lost, and answers of the world refused by the rules, when
  the files hold them. Null text in a memory event counts a lost rewrite. The other two need `invalid` and
  `refused` in one total row without `kind` in each stretch's usage file; `live --run` does not write those totals.

Nothing is estimated: `-` means a missing number. A gap in the numbered stretches leaves their totals unknown.
Missing, unreadable, unfinished or damaged event files leave
the event counts unknown. Without deed ends, a deed at the very end, cut before its result, is left out of the
deed counts and of the two shares; any other deed without its following result leaves those counts unknown.
With deed ends, results pair by `ofDeed` when it names a start in the joined events, otherwise by the doer, who
has at most one deed going. Starts still going at the end are left out of the same counts and shares. Missing
counted result fields leave the deed counts and actions that led somewhere unknown. Missing or damaged usage
files leave requests and tokens unknown. A token total or mean is missing when any request in it has no count, including a failed
request; a zero denominator leaves a rate or share missing. A mean for a kind outside a run's two commonest is
missing in that column. A run with only its state file has no event or request counts here. To give those numbers
without opening SQLite it would need the kept event and usage files too. These numbers compare what a change of
wording or a rule did before a transcript is read; they cannot judge a scene, and a quiet good scene counts as
standing still.
