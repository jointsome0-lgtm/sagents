# Live mechanisms

The rules for time, actions, things and memory are here.
[The world file](world-file.md) names their settings; [the requests](requests.md) say what models receive.

## The mechanisms

### Turn order and hearing

`next`, `apply`, `arrive`, `wake` and `attend` in `src/action.ts` keep residents taking turns in time order.
Arrivals come before waking and both before turns at one instant, so two who walk together are both there before
either looks around. [The arrival check](measured.md#arrivals-at-one-instant) covered this order on one model.
With deed ends one waking can come after a turn of its instant: the one that the answer to a deed cut short at
that instant brings, since that answer follows the turn that cut the deed; every later turn of the instant comes
after it.
The clock displays whole seconds and names the day from day 2. Everyone awake in the speaker's place hears a
`say` and is held until it ends. A `call` reaches its recipient anywhere, with only the caller's half heard by
those near the caller. A sleeper or traveller gets its waiting calls on waking or arrival.

### Action spans

`speechSeconds`, `wordLimit`, `travelSeconds` and `lasting` in `src/time.ts` give spans; `readAction` in `src/action.ts`
reads actions. Speech and a call are cut at 65 words and at the turn's limit, with the speaker's rate and a minimum
of two seconds. Notes and deeds are cut at 65, gestures at 12, words with a deed at 20 and the turn's limit.
A deed lasts at least as long as its words, and they hold listeners like speech.
`own` in `src/journal.ts` tells only the doer of a cut deed, on its own line like cut speech: `Your deed was longer than the limit: only its first words were done.`
[Speaker rates were checked with stand-ins](measured.md#speech-rates), with no changed instruction text.
The walking fields of [the world file](world-file.md#world) give the time. Walking hears nothing,
cannot stop and takes no turn on the way without `legMinutes`. With it, long walks take turns in parts;
speech leaves arrival unchanged, and a deed or wait stops the walker for its seconds before another part.
Vehicles, boarding and getting out keep their own rules.

A `do` or `wait` lasts chosen whole `seconds`, at most an hour, or `until` the next occurrence of a time of day such as `06:30`;
a `sleep` lasts at most 12 hours. `until` wins over seconds. An excessive span is capped without losing the turn;
the resident reads the seconds with no cut warning and the action record has `capped`, never sent in a request.
A deed's doer and a waiter get a turn early with speech, a call to the resident, leaving or arrival nearby, sound
next door, or a weather record reaching the place, even with unchanged text. Freedom waits for speaking and
listening to end. Without deed ends the deed is credited whole at once: the world answers its whole span.
A sleeper sees and hears nothing, interrupts nobody, and wakes early only by the world's `wakes`. Without deed
ends it wakes at the deed's intended end or its already earlier waking time; with deed ends it wakes when the
result is written, or at its already earlier waking time. Others see deeds, falling asleep and waking at their
own next turn; leaving and arrival also end their waits.

With `deedEnds: true`, `apply` in `src/action.ts`, `settlementDue` and `applied` in `src/journal.ts` and `runLive`
in `src/live.ts` keep at most one deed going per person. A `do` starts it without asking the world. `own` and
`perceived` in `src/journal.ts` tell the doer `You begin, for 600 s: TEXT`, or `You begin, until about 10:30: TEXT`,
and witnesses `X begins, for 600 s: TEXT`. At a turn before the end, `runLive` tells the doer
`You are still doing, 62 of 600 s so far: TEXT. To go on with it, answer wait: a do, a go or a sleep would stop it.`
and `doingOf` in `src/live.ts` tells others here `X is still doing: TEXT.` Speech, a call and a wait leave it
going. That wait lasts to the deed's end whatever span was asked: its event holds those seconds, its doer reads
`You wait (8 s).` with no `until about` form, and the action record keeps the span given. An answer that the rules
refuse or cannot use stops nothing, a refused `go` included: it costs 30 seconds or the seconds to the deed's end,
whichever is less, and its event holds them. Another `do`, `go` or `sleep` only stops the deed, without taking
that action, and the doer chooses again after its result. A doer who gets a turn at or past `spentHours` with a
deed going has it answered at that turn, cut short, and then falls asleep. `advance` in `src/journal.ts` has the
world answer a whole deed at exactly its end, even while its doer is speaking or listening; the doer's next turn
then waits for that speech to end. `deedOf` in `src/live.ts` and `stoppedOf` in `src/journal.ts` tell the world
`Now 10:30:00. X stopped after 600 of 600 s: TEXT`, or
`Now 10:21:02. X stopped after 62 of 600 s: TEXT. It was cut short.` Its answer takes effect then, including
moves, eating, finds, waking and sound next door. The doer remembers
`You stopped after 62 of 600 s: TEXT. It was cut short.` before the result. A deed stopped with no time spent
gets an empty result without a world request. `result` in `src/answer.ts` gives every result to everyone awake
in the place but the doer: they remember `X stopped after 62 of 600 s: TEXT. It was cut short.` before any
result lines, also when the result has no words and changes nothing and when no time was spent.
Without the setting the requests and journal stay unchanged.

### Walks in parts

`deedEnds` and `legMinutes` cannot be set together yet.

`walkAt`, `legAt` and `turnSeconds` in `src/time.ts`, with `together` in `src/action.ts`, keep a walk's progress and
company. Walkers on the same way in the same direction are together when their arrivals differ by at most a minute.
They hear speech and see deeds as people in one place do; a stop that puts the arrival farther apart leaves one behind.
`go` walks on or turns elsewhere, back in the time walked or by the shorter route through either endpoint.
Sleep is refused until arrival, and forced sleep waits for it. `roadDeedOf` in `src/live.ts` gives the world only
these walkers, what they carry and wear, the weather and the way's description; nothing can be taken from a place
or left on the way. `advance` in `src/journal.ts` keeps way lines in memories and an optional `onWay` in events,
and rebuilds progress from kept actions. Passing walkers in the other direction is not built.

### Time without a clock

`hasClock`, `timeFor`, `sensed` and `DRIFT` in `src/time.ts` keep clock knowledge local.
With a clock at hand a turn opens `Now 21:04:10.` and perceived lines keep clock times; without one it opens a
part of day, `Now evening, as far as you can tell: no clock is at hand.`, and a line begins `[evening]`. Nothing from the rules gives a clock time then; a time spoken aloud
stays speech. Memories keep the time as their owner could tell it when it happened, even after losing a clock.
Open-sky cues begin at 05:00 early morning, 07:00 morning, 10:00 late morning, 12:00 around midday,
14:00 afternoon, 16:00 late afternoon, 18:00 early evening, 20:00 late evening and 23:00 night.
Under a roof or on a walk without `legMinutes` they are 05:00 morning, 11:00 the middle of the day, 15:00 afternoon,
18:00 evening and 23:00 night. Later days are named. With a clock, `until` is an alarm at that time.
Without one, replayable drift is at most a tenth of the span and half an hour for sleep, a twentieth and three
minutes for deed or wait, never outside the action's allowed span. Its own line says `until about 06:00`.
The world always receives the clock.

### Refused turns

An unusable turn is a thirty-second wait. `REFUSALS` in `src/action.ts` and `refused` in `src/journal.ts`
keep its reason and the next turn's sentence of what to do instead. The original nine are a non-JSON object,
unknown action, missing text, invalid call recipient, this place or unknown place, bad time, output cut or service
decline. Vehicle refusals add unavailable, full, driving, unauthorised driver, out of reach, self-driven round
and insufficient fare. A decline uses the non-JSON sentence because no separate sentence was measured; the
journal distinguishes them.

### Vehicles and buses

`driveSeconds`, `busRound` and `busAt` in `src/time.ts` govern timing. `go` boards or gets out immediately,
holding the next turn ten seconds; boarding needs a free seat. Inside, `go` drives elsewhere immediately,
taking walk time divided by `faster`, rounded up, at least thirty seconds. The driver is busy ten seconds;
riders take turns en route. Ordinary journeys stay walks. There is no fuel, key, getting out, turning back or
changing destination on the way. Invalid journeys take a thirty-second wait and fixed refusal sentence;
driving a bus gives `This vehicle goes its round by itself.`
[Vehicle checks](measured.md#vehicles-on-the-main-line) and
[bus checks](measured.md#buses-on-the-main-line) showed drives and paid rides, without measuring their
effect on the story.

`pay` in `src/things.ts` takes directly carried money first, then contents, then their contents, in list
order. Too little takes nothing: `You need 30 rubles for the fare.` Only the payer reads `You pay 30 rubles.`
after boarding. Getting out gives no refund; staying another round costs no fare. A holder with id `fare` can
receive ordinary moves; deeds cannot use up money.

`vehicleView` and `standingAt` in `src/journal.ts` give `Here stands:` lines with free seats and a bus's next
departure: `Here stands: Blue car (car), 1 of 2 seats free.` or
`Here stands: Bus 4 (bus4), 19 of 20 seats free, leaving for Hill in 1 min 0 s.` A line is written on first
sight, arrival, pull-up or a change of seats, with the time left then; time alone adds no line. Outside,
`Bus 4 has driven off.` and `Bus 4 has pulled up.` name no occupants. At a stop a bus's pull-up frees only
those who wait, with the standing line at once; others get it at their next turn only if the bus remains, and
a long deed continues to its end. A driven vehicle's arrival frees everyone awake where it arrives. A departure
ends no wait; its line waits for the person's turn. Inside, arrival frees everyone awake and is told in the
vehicle's words; departure is only in the next `Now` position line. Bus sleepers get no notices, even on
waking; their `Now` gives position. Driven-vehicle sleepers get arrival on waking.

`vehicleDue` and `applied` in `src/journal.ts` give one bus arrival record only with someone awake at its stop
or inside beforehand. Other bus instants add no record, request or delay to the run or horizon; the timetable
restores position after a pause without witnesses. Replay refuses a `round` refusal without a round. Vehicle
arrivals follow weather and precede sleep at the limit, people's arrivals and turns at the same instant.
Without vehicles, requests and journals stay unchanged. This port keeps the main line's rebuilt turns and the
candidate's transport wording; it has no opening hours, places on demand, closed-place refusals or going by
words.

### Things and deeds

`settle`, `keep`, `stocked` and `sought` in `src/things.ts`, with `result` and `refusal` in `src/answer.ts`,
keep model prose from changing counts. A deed is an attempt, not a fact. The rules take an answer's moves in
order, the whole answer or none. A whole record keeps its label and contents; a part of a count or stock is
another record, the rest stays, and compatible counts at a holder merge. A stock is unchanged. Labels `t1`, `t2`
and on follow file order and are never reused or shown to residents. The world reads notation such as
`t8 parka [t9 cigarettes ×17, burns; t10 lighter, fire]`, under `Things here`, `Carries`, and brackets for contents.
With portions, `written` and `shown` in `src/things.ts` add `two thirds left` or `a third left`
after food in the world's notation and after the name and count for residents. Empty containers read `[empty]`;
residents see it only where they could see contents, through two levels of their own things or open things of others.
`written` in `src/things.ts`, with `prices`, adds `price 6 euro` for what one costs and `till` for where payment
goes, after the other marks; residents read neither. There is no model-maintained list or count.

An answer is refused for its first unknown or unfound hidden thing, fixed thing, excess count or more than 20
from stock, invalid holder, self-containment or nesting beyond four, non-food eaten, nonburnable burned or burning
without fire, money eaten or burned, more than 30 records on a person or 60 in a place, or invalid state.
With `portions`, `tasted` also refuses non-food or money and any `n` other than 1; a figure's reply has no sinks.
The id `tasted` is reserved with `eaten` and `burned` only with the setting.
Moves all to their current holders refuse it because prose could claim a move that did not happen; beside an
actual move they are passed over. A refusal changes nothing and is not journalled. The world gets the same
request once more with a sentence naming the entry and cause in its instructions' words. After the second,
nothing comes of the deed or speech; totals count `refused` and `void`. One second answer is not lost: when the
world's answer to a deed was refused because all its moves named where the things already were and its second
answer again lists only such moves, that answer is taken without them and with whatever else it holds, if the rest
passes the rules, and the totals count it as `unmoved`. Such an answer is taken to say where things already are,
and losing the deed to it made a resident repeat the deed; its prose is not compared with the lists, so a result
that tells of a move the lists did not make is kept as told. A figure's reply keeps the refusal, since a figure
hands things over.
`runLive` in `src/live.ts` passes each
untaken attempt to `Live.onUntaken` for [the kept file](live.md#files-and-continuation). The closed list `UNTAKEN_CAUSES`
in `src/live.ts` is `cut`, `declined`, `unread`, the rule codes of `CODES` in `src/things.ts` and `TRACE_CODES` in
`src/answer.ts`, then the words of `REFUSALS` not already in the list, each once; no untaken answer enters the journal.

With `prices`, `settle` also refuses a figure's answer with `price` when the one who spoke cannot pay,
using its first sale as the refused entry. After moves and before sets, it sums each money name's prices,
subtracts the money its moves carried from that person's possessions into the till, less what they carried back.
Possessions include contents at any depth; money given to or received from anyone else counts neither way.
It moves a positive balance into the till from the money held after the moves, taking directly carried money first,
then contents, then their contents, in list order, as `pay` does. These are ordinary postings, marked `price` only for the
printed line's ` (price)`; replay derives them again. A deed pays nothing and keeps a thing's price.

Only stock creates things; only eating, burning and fares remove them. With `portions`, tasting the last third
also removes a thing; tasting stock takes nothing from it. A thing with a part left still counts as one,
and a third tasted from a pile splits off one record beside it without merging; moves merge only equal parts.
For each name, what remains plus what was eaten, burned or paid, minus stock additions, equals what the file gave. Money plus fares never changes.
With portions the balance counts food in thirds: remaining food uses `(left ?? 3) × (n ?? 1)`, eating and
tasting use `thirds` or three times the count, and burning uses the part before the move. Stock additions
use the same units, including a third tasted from stock.
Events hold `moved` postings with source, destination and amount, `set` and `found`; eaten postings name the eater,
and only with hunger keep calories and drink. With portions, `Posting` in `src/things.ts` adds `thirds`
for a tasting or eating what is left, and `left` after tasting non-stock. `listed` in `src/journal.ts`
keeps the label of a split part; tasted lines say how much is left, without a count.
Residents receive one line from postings with names and no labels;
`told` in `src/journal.ts` leaves out a move whose two ends it names alike, such as into the doer's own pocket,
which the world's earlier-deed line keeps. The invariant checks count from these postings.

### Search

`result` in `src/answer.ts` adds a searching deed's seconds to a time kept per person and place, across deeds and
after leaving; `sought` in `src/things.ts` reads it and says what a search finds now. The world's `search` credits
the whole deed's seconds without deed ends, and the seconds actually spent with it, so a ten-minute hidden
backpack can be found in one search or several. The request separates what this deed finds if a search from what no search finds yet; the model does not count time.
Alternatively `finds` judges a deed straight to the named spot, however short, not merely the thing's name or
another spot. Found things and contents become visible to all; only an answer finding one can move it or its
contents. Nobody is told search progress or that more is hidden. Nothing checks the model's judgement of search
or direct reach, nor that its result does not mention something still hidden.

### Earlier deeds

`earlierOf` in `src/live.ts` and `advance` in `src/journal.ts` keep the latest 400 words of deeds in each place,
and always its newest line. A line has the result's clock, doer, deed, credited span, `Result:` words and
`In the lists:` postings, including things found, eaten, burned or changed. Each move names its label and the destination exactly as a
request names that holder, never its source (`t38 camera went to t1 long table.`, `t15 key to the shed went to
 t33 hiking jacket.`). Names alone made a weak model mistake a jacket for its owner. Entries without prose still
leave a line; neither entries nor prose leaves none. Feelings and sound next door leave none of it in that
history. [Stale-list checks](measured.md#earlier-deeds-and-stale-lists) explain why these lines were added;
their effect on a whole run was not measured.

### World retries

`runLive` in `src/live.ts` and `advance` in `src/journal.ts` require a result immediately after its deed without
deed ends, and after a stop with it; replies immediately follow addressed speech. No other record can intervene
at those points. Unreadable or cut world answers are asked once more; unreadable replies leave silence, deeds leave nothing. Retries are local to a start: a pause
at the call cap resets the two-ask count and loses the refusal explanation. Declines follow the separate stop
rule above. The doer and awake witnesses get the result on their next turns, without interruption; a sleeper
woken here learns who woke it and by what deed.

### Sound next door

`result` in `src/answer.ts` names who hears `beyond` next door and `applied` in `src/journal.ts` writes their lines.
It gives sound, not the doer's identity unless a voice carries words. Awake people next door receive
`From <place name>, next door: <text>` and stop waiting. It reveals no deed, result, pose, move or feeling.
A named sleeper wakes with `Something from <place name>, next door, woke you: <text>`, or `… woke you.` if null,
because a weak world may fill `wakes` before `beyond`. Others asleep or travelling get nothing, nor anyone in the
deed's place, including its doer. With no neighbour, any returned sound is made null, saved and printed nowhere,
without refusal or retry. The world is told to use null then; the transcript labels it `heard next door: …`. [The sound check](measured.md#sound-next-door)
did not count it separately from the other request changes.

### Feeling during a deed

`readResult` and `result` in `src/answer.ts` read a bodily feeling and `applied` in `src/journal.ts` gives it to its
owner alone and keeps it out of the world's later history. Its transcript label is `private feeling of …`.
A deed touching another body asks for feelings of both toucher and touched; looking, listening, speaking,
watching and ordinary handling of a thing ask for none. Each text begins with what is felt, naming nobody,
since it follows `You feel:`. [Feeling checks](measured.md#feelings-during-a-deed) led to narrower wording;
its separate effect was not counted. This is the first of three planned layers: feeling during a deed is built;
feeling from bodily state over time, such as an arm tired after carrying, and a body that changes are not.

### Touches

`readTouches` and `touched` in `src/touch.ts` keep one touch per ordered pair, allowing mutual touch. With
`touch: true`, a list is required; otherwise requests and saved form stay unchanged and older journals replay.
Entries precede waking and feelings so those agree. Continuing entries name two different people here,
sleepers allowed; `kind` is `touch`, `press`, `squeeze`, `hold`, `embrace`, `rub`, `lean` or `none` to end;
`force` is `light`, `firm` or `hard`; `text` says with what body part and where on the other body, naming
neither, at most 15 words. A touch that holds needs no entry. `MAX_TOUCHES` is 8 per place. Entries run in
order; endings make room; later per pair wins. Invalid ids, kind, force, empty text, endings without a touch
and ninth beginnings are dropped. A changed kind or force restarts the touch at the result's moment; otherwise its
start stays and only the text changes. Leaving, boarding or getting out
ends touches in `applied` in `src/journal.ts`; sleep, driving and arrival keep them. Holding someone back or
keeping touch while walking together is not built.

Deed requests list `Touches that hold now:` after people, with
`- of <id> to <id>: <kind>, <force>, for <time>: <text>`, or `Touches that hold now: none.`. Time is seconds,
whole minutes from two minutes; figure replies omit them. `runLive` in `src/live.ts` shows participants, under
their poses, `You touch <name> (<kind>, <force>, for <time>): <text>` or `<name> touches you (…): <text>`;
awake witnesses here see only `<name> touches <name> (<kind>): <text>` after other people. Nobody elsewhere
sees it. Residents are told no renewal is needed; a deed lets go or leaving ends it. Result records and events
keep `touches`; transcripts say `touch of … on …`. Leaving adds no touch entry; the next turn lacks it. Touch
adds no memory line; result and feeling tell its beginning.
[The body port check](measured.md#body-mechanisms-on-the-main-line) left the story effect unmeasured.

### Lasting feelings

`readLingers`, `marked` and `marksAt` in `src/marks.ts` keep a person's feeling per zone and kind.
With marks on, `lingers` is required; without it the request and saved form stay unchanged. It uses the initial
mark's fields plus `of`, a person here, `minutes`, null or a whole number from 1 to 1440, and `level` also allows
`none`. Text has 15 words; none needs no text. Null lasts indefinitely; a number lasts that many minutes after
the deed's intended end without deed ends, or its result's moment with it, then restores what was there,
including an older temporary layer. Up to 3 layers (`MAX_LAYERS`) keep relief or worsening; layers expiring before the new one are dropped. A change to a part already feeling
something needs an entry, such as cream on a burn, cold water, a muscle rub or a blow on a bruise.
Invalid person, zone, kind, level, minutes, empty text except none, ending a missing mark, a fourth layer or a
seventh mark is dropped. Later entry per person, zone and kind wins. No entry leaves it unchanged; only entries
and time change it, and it follows its owner asleep or awake.

Expiry writes no record. Entries stay in result records and events; transcript lines are
`private lasting feeling of …`. A turn gives only its owner `Your <zone> (<kind>, <level>): <text>` after sleep
debt, `Your whole body` for body, no time or temporarily absent mark, and no memory line. The deed request has
`Feelings that last now:` after people and touches, with `- of <id>, <zone>: <kind>, <level>, for <time>: <text>` and `, <time> left` when temporary,
or `Feelings that last now: none.`. Times are seconds, whole minutes from two minutes, whole hours from two hours. An unchanged
initial mark has no `for <time>`; temporarily gone is none with no text. Figure replies omit it. The name `lingers`
avoids confusion with the marks after things in the world's notation. [The body port check](measured.md#body-mechanisms-on-the-main-line) left the story effect unmeasured.

### Traces

`marked`, `retraced` and `refusal` in `src/answer.ts` keep traces on people, independent of looks and pose.
The labels `m1`, `m2` and on follow file order and are never reused. The world reads `Traces: m1 …; m2 …` or
`Traces: none`; residents read only `On you: …` or `On them: …` after looks and pose, without labels, as they are
now. Past lines never retell appearances. Deeds alone leave or wipe traces; a figure answer has neither field.
Wipes precede additions; unknown person, empty text or unknown local label is dropped, a duplicate text is passed
over, and a ninth trace refuses the whole answer with a retry, like a thirty-first carried record. Both lists
are required. Records keep them and events `traced` and `wiped` with owner, label and text; earlier-deed lines
name traces left or removed. Optional instructions and schema sentences appear only when traces are on.
[The first trace checks](measured.md#traces-first-checks) were on an earlier engine, and
[the example comparison](measured.md#traces-unchanged-examples) checked unchanged worlds without the setting.
Trace state survives continuation; formats are listed with [the files](live.md#files-and-continuation). Traces on things or places, clothing
or pose hiding them, and fading with time are not built: a wet sleeve stays wet until a deed dries it.

### Ways by deeds

`waysOf` in `src/action.ts` and `wayDue` in `src/journal.ts` let a deed begin the journey of a `go`. Without ways,
the world is told to leave doers here by the way out. Poses never name another place. With ways, `leads` names here or an
allowed id, even when travel outlasts the deed. Only the doer goes; results say only what happens here before
leaving. Unlisted parts, upstairs rooms, yards or steps towards doors stay here. The schema lists available
ways and told refusals, full, fare, driver, reach or round, including standing vehicles and this vehicle's
stop. The other-place line is ``Other places, which a deed reaches only through `leads`: ...``, replacing
`Other places, which nobody reaches by a deed: ...`. The last sentence names here and any standing vehicle:
``What comes of it? This place is `cafe`, and `leads` is `cafe` unless the deed is the way to another place or into a vehicle that stands here.``
Inside, `This vehicle stands at ...` gives the stop's id. This avoids mistaking similar names for neighbours'
ids. [The six wordings](measured.md#ways-by-deeds) tested mistaken departures and missed ways; their
limits stay with that entry.

`worldInstructionsOf`, `worldTextOf` and `WORLD_INSTRUCTIONS` in `src/live.ts` give the exact texts with and
without ways. Only the world's fourth instruction paragraph, first-field point, other-place line and last
request sentence change; residents and figure requests do not. Result records and events keep the way as `goes`,
another place id or null, whatever the answer's field is called. `result` in `src/answer.ts` drops the doer's
pose for a named way; other entries work normally. At the doer's next free moment after the result, the rules
check and take that `go` without asking a model. Travel, notices, seats, drivers, fares and touch endings use ordinary `go` rules. A refusal leaves the deed as it was and takes the ordinary
thirty-second wait and refusal sentence; either way the pending way is used up. Clock laws and vehicle arrivals
precede it.
Action records and events have `fromDeed`, the result's sequence number, and null `by`. Rebuilding from
results preserves pauses before departure or during travel. Without ways, requests, records, events, stored
rows and format stay unchanged.

A world file with `stableFirst: true` uses `known` in `src/live.ts` to append a resident's memory and
closed blocks of 40 recent lines to the instructions, for turns and memory rewrites. The remaining lines and
the turn's changing end or the rewrite's question stay in one user message. This is for a provider whose cache
follows the instructions: their beginning stays whole and grows by a block until the next rewrite.

A world file with `fixedSchema: true` keeps the deed and figure reply schemas fixed for its run. The values
allowed now come last in the request text; `allowedOf` and `allowedTextOf` in `src/live.ts` list them, and
`allowedIn` in `src/answer.ts` rejects an answer outside them before anything happens, with the ordinary retry.
Without the setting, requests, records, events, stored rows and format stay unchanged.

### Clock laws

`Law`, `LAWS` and `beginLaws` in `src/laws.ts` give a clock law its settings and checks, state, due record,
turn line and request-size bound. Weather also supplies the world's line; sleep supplies how someone looks and
updates debt on sleep and waking; hunger updates counts from eating and sleep. Core laws have no model or disk
access.

### Sleep debt

`sleep` in `src/sleep.ts` grows debt while awake, including travel, and reduces it twice as fast in sleep,
never below zero, beginning at time since `dayStart`. The count is not told. Its four bodily steps are rested,
awake a long while from half `tiredHours`, tired from that threshold, and hardly able to stay awake in the last
quarter to `spentHours`. From tired on the owner is warned it will fall asleep where it is, and tiredness shows
to others here. At the limit sleep replaces a turn, where the
person is, for eight hours; it is an engine record, no model asked, witnessed as falling asleep.

### Hunger and thirst

`hunger` in `src/hunger.ts` accounts only for the doer's accepted `eaten` postings, never words or a figure's
answer. With `portions` it also counts `tasted`: a third gives a third of the calories and drink time;
eating a remaining part gives its remaining thirds. A part of a food whose whole has at least 100 calories
also lifts a negative fed count to zero. Everyone begins fed for 3 hours and not thirsty for 2. Both fall by a second per waking second, half per
sleeping second, below zero when needed. A deed's calories count together: at least 100 first lifts a negative
count to zero; each calorie then adds 36 seconds, up to 10 hours. Smaller meals add time without that lift.
Thus an awake hour uses 100 calories, 600 holds 6 hours from zero or less, and 400 after waking hungry holds 4.
Water with zero calories feeds nobody; each drink first lifts negative thirst to zero and adds 3 hours up to 6;
a drink with calories feeds too. Effects begin at the result's recorded moment and replay from the journal;
this law writes no record of its own. [The hunger checks](measured.md#hunger-and-thirst) explain why a fine
body adds no line: a resident used `You are not hungry.` to refuse an agreed supper.

Only its owner's turn receives the line after sleep debt. At zero to above minus 2 hours it says
`You are getting hungry.`, from minus 2 to above minus 8 `You are hungry.`, at minus 8 or below
`You are very hungry and feel weak.` Thirst at zero to above minus 6 says `You are thirsty.`, below that
`You are very thirsty.` Both sentences share one line with one space; above zero there is no sentence or line.
These are the only new model texts; world and figures are asked as before, and others never learn these counts.

### Weather

`weather` in `src/weather.ts` says which change is due and what it does; `runLive` in `src/live.ts` and `applied`
in `src/journal.ts` put it before actions, without a model request, and replay refuses a wrong or undue change.
Awake people in open places receive its text and end their waits, those under a roof do so only with indoors
text. Travellers and sleepers get nothing and are not told later. Turns give the local
text; the world always gets weather and roof or sky, with instructions to mention weather only when a deed
meets it. Nothing checks that instruction. Seeded weather is replayable and does not repeat a state consecutively.

### Folding memory

A world file with `oneSchema: true` uses the turn schema with `memory` last, a string or null, for both
turns and rewrites. `schemaOf` and `residentInstructionsOf` in `src/live.ts` give both requests the same
schema and fixed instructions; `known` puts memory before perceived lines in both. `readTurn` in `src/live.ts`
reads a turn as its action, drops any memory written in it and counts that turn in `Outcome.dropped`, even if
the action is refused. When the count is not zero, `live` prints `memory dropped in 18 turns` or
`memory dropped in 1 turn` after the closing line and `not taken: …` if present. A rewrite writes its memory,
sets `action` to `wait` and the rest to null, and only its memory is read by `readMemory` in `src/memory.ts`,
which rejects the wrong form with the existing retry.
Records keep their form. Without the setting, requests and stored rows stay unchanged.

`oldest`, `rewrite` and `idle` in `src/memory.ts` keep short memory as perceived lines with local times, own
actions and notes, and delivered waiting calls. On waking, everything before sleep is folded; waking and calls
start new lines. Sleep and waking alone since the last rewrite need no request. Before a turn over `shortWords`,
the oldest lines fold until about half remains. Long memory is the character's own summary of its old memory
and folded lines; omissions are forgotten and overlong text loses its end. `rewriteOf` in `src/live.ts` asks
for about 85% of the limit, beginning with wants and changes, then lasting obligations, promises, sums, times,
locations and knowledge of people, retaining the names and figures in the lines. Passing chores, small talk and
trivial prices go last or are omitted, so a cut loses least. It asks for sentences, no numbered list, sums and
times in figures, past tense without current location, and no deed result without one in the lines.

### Guarding a rewrite

`readMemory` and `sameScript` in `src/memory.ts` guard a rewrite without judging its truth.
With or without `language`, the guard compares scripts with the resident's sheet, so a change between two
languages of one script still passes it.
It ends before the first `}`, trims spaces before it and marks a cut; nothing before it is unusable.
[The ending check](measured.md#memory-endings) saw continuations inside the string and noise.
An unreadable rewrite gets one retry; after two the old memory stays but folded lines are lost, counted as `lost`.
A readable first answer in another script is set aside and retried only when a sheet has at least 20 letters,
at least four fifths in one script, and the cut answer has at least 10 letters with fewer than half in that script.
It counts unusable, but a failed, cut or declined retry, or a stop before retry, saves the first; a readable second
is kept unchecked, also after an unreadable first. The guard can cost one request and never a memory.
Only letters count, and letters of any script count towards these sizes and shares; the scripts told apart are
Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and Han/Hiragana/Katakana/Hangul together. A tie or
unclear sheet disables it; names and a few foreign words can stay, while a language with two scripts follows the
sheet. [This guard has stand-in checks](measured.md#memory-script-guard), no model measurement.
`requestLimit` in `src/live.ts` bounds requests by the world file, however long the story runs, using the text limits.

### The journal

`Record`, `advance` and `replay` in `src/journal.ts` make the append-only records the world's only state.
Actions or their refusal reasons, results, replies, arrivals, waking, sleep at the limit, weather and rewrites
are records, each with its derived event. With deed ends, a stopping action is an action record whose event is
`stop`; a result event holds `ofDeed`, the deed's record number, and `worked` and `planned`, seconds spent and
seconds chosen. An unanswered start remains pending when the run pauses. A drive records driver, vehicle,
departure, destination and arrival, with one engine arrival record. Every journal prefix rebuilds a whole world through the same rules that play it.
`LAWS` in `src/invariants.test.ts` gives each invariant in one sentence; `npm test` plays thirty characters for
thousands of steps with answers of every kind, checking laws from the journal alone, naming law and record on failure.

`npm run bench` uses an immediate stand-in in a synthetic town and prints step costs and request sizes;
`node src/bench.ts 1000 100 50` means 1000 characters, 100 places and 50 calls each.

## What the live world lacks

- There is no author above the characters; the world answers deeds and does nothing of its own accord.
- Counts are checked, but whether a deed should move a thing is the model's reading. Words can say a jacket was
  hung up while lists keep it on its owner. No check compares prose and moves; immutable facts do not adapt.
- Earlier-deed lines are history, not current location. A carrier leaving or a figure moving a thing writes no
  deed line; old prose can still name it. The lists are the truth, and the world is told so.
- Speech never passes a door, however loud. Calling through it needs a deed, and an answer another deed.
  Every neighbour hears the same `beyond`, the doer is not told who heard it, and hearing is the model's judgement.
- Doors have no open, shut or bolted state. Description is all the world knows, every `go` passes, and sound does
  not depend on doors. There is no shop or manufacture, or taking, giving and eating without the world. Prices serve only a figure's
  answer: deeds do not pay, a resident who sells has no payment rule, and nothing in a vehicle or on a person is priced.
- Walking is at one pace for everyone, whatever terrain or tiredness. Without `legMinutes` it cannot be interrupted
  and perceives nothing. Walkers receive no later weather notices between turns. Carried things go along regardless of size.
  A resident names a thing in words, and the world must find its label.
- A handed-over, lost or stopped watch still tells its original owner time; a removed place clock stays there.
  Seconds are exact for all; an early-woken sleeper is not told by how much. Tiredness is one count, changes no
  ability before its limit, and a traveller falls asleep only on its turn after arrival.
- Figures have no private memory, hear no resident-to-resident speech, and share only local figure dialogue
  history plus their facts. A crowd cannot answer. Only a deed or addressed figure speech asks the world;
  claims in speech or notes are unchecked.
- Nothing checks invented facts in a memory summary. The character cannot retrieve what it forgot from the
  journal. Waiting calls have no count limit; repeated rewrites fold the oldest before the next turn if needed.
- The journal cannot branch. A checkpoint fork needs a copy of its prefix. The project's checks ask stand-ins alone.
