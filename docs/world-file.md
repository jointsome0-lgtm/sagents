# World file reference

The fields and checks of a world file are here.
[The live commands](live.md) run it; [README](../README.md#a-live-world) introduces the live world.

## The world file

The reader is `readWorld` in `src/laws.ts`, with `readCore` in `src/world.ts`. The file is a JSON object.
The tables below list the fields the reader uses. Unknown fields of a world object are ignored; an environment
refuses unknown fields. Required fields have no default. Text must be nonempty unless its entry allows null.
Boolean settings use forms such as `"clock": true`, `"open": true`, `"touch": true`, `"marks": true`
and `"ways": true`; hunger and fixed schemas use `hunger: true` and `fixedSchema: true`. All numeric settings must be finite. Durations derived from them must fit whole seconds from 1 to
1,000,000,000,000; this excludes worlds of 0.1.0 with longer durations, over thirty thousand years.
The check covers settings and derived durations, not seconds accumulated over a long story.

A word limit also limits characters to ten per word, so a text without spaces cannot evade it.
Optional bounded texts accept absence or null; an empty or overlong text is refused, rather than cut.
The texts are in the world's language. The public descriptions should name only what does not move.
Private `facts` belong to the world model alone. They never reach residents and do not change during a run.
`boundedOf`, `sizeOf` and `durationOf` in `src/reading.ts` hold these checks.

An `id` of a place, character, figure or vehicle is a string of 1 to 40 Latin letters, digits, `_` and `-`,
beginning with a letter, unique across those four lists. It cannot be `eaten`, `burned`, a thing label such as
`t7`, or an inherited JavaScript name such as `constructor`. When traces are on it cannot look like `m7` either.
`idOf` in `src/world.ts` holds this rule. Things and traces receive labels from the rules, not ids from the author.

### World

`World` in `src/world.ts` describes what the core keeps. The law fields are read separately.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `title` | Required text. | The world's name, known to everyone. |
| `about` | Required text. | The description everyone knows. |
| `facts` | Text or null, absent for none; at most 300 words. | What is true but not public. |
| `clock` | Required `HH:MM`, from `00:00` to `23:59`. | The starting time on day 1. It does not give everyone a clock. |
| `places` | Required nonempty list of place objects. | The places anyone can go to. |
| `characters` | Required nonempty list of character objects. | The people whom models play, in their starting order. |
| `wordsPerMinute` | Number above zero, default 130. A 65-word speech, rounded up with a two-second minimum, must fit the duration bound. | The speech rate when a character or figure has no rate of its own. |
| `travelMinutes` | Number above zero, default 5; rounded seconds with a one-second minimum must fit the duration bound. | The walk time when neither a listed time nor coordinates give one. |
| `legMinutes` | Whole number from 1 to 60, absent for off. | A turn after each part of a walk, when at least one minute remains. |
| `walkMetresPerMinute` | Number above zero, default 80. | The pace used with coordinates. Every unlisted pair's distance must be finite and its walk fit the duration bound. |
| `remote` | Nonempty text or null, absent for none. | The means of remote contact, such as a telephone. Without it there is no `call`. |
| `shortWords` | Positive safe whole number, default 2000. | The recent-memory limit that starts a rewrite; waiting calls may require several rewrites. |
| `longWords` | Positive safe whole number, default 400. | The limit of a character's first memory and each rewrite. |
| `vehicles` | List of at most 6 vehicle objects, absent or empty for none. | Moving places. An empty list still selects the vehicle state format. |
| `touch` | Boolean, default false. | Keeps touches between two people as state. Sleep does not end them; crossing a place's boundary does. |
| `marks` | Boolean, default false. | Keeps lasting feelings of a body, including temporary relief. It changes no body or ability. |
| `deedEnds` | Boolean, default false. | Gives deeds a start and an end, as described under Action spans. |
| `portions` | Boolean, default false. | Lets food be eaten or drunk in thirds, with parts and empty containers shown in the lists. Works without hunger. |
| `prices` | Boolean, default false. | Prices on things of a place let a figure's answer move their payment into its till. |
| `ways` | Boolean, default false. | Lets the world name a deed's way to another place; the rules then take an ordinary `go`. |
| `fixedSchema` | Only true or absent, default off. | Keeps deed and figure reply schemas fixed for this world, with the values allowed now in the request text and checked by the engine. |
| `hunger` | Only true or absent, default off. | Turns on hunger and thirst together. The world must contain a thing with `food` above zero and a thing with `drink: true`, anywhere in its lists. It causes no fainting, illness or death. |
| `stableFirst` | Boolean, default false. | Moves a resident's memory and closed blocks of recent lines to the instructions. |
| `oneSchema` | Only true or absent, default off. | Uses one response schema for resident turns and memory rewrites. |
| `environment` | Name or null, absent for none; 1 to 40 lower-case letters, digits and `-`, first a letter or digit. | `"environment": "<name>"` reads `environments/<name>.json`. The command's choice wins over this name. |
| `dayStart` | `HH:MM`, default `07:00`; null uses the default. | The daily start from which the first sleep debt is counted. |
| `tiredHours` | Number above zero, default 16; rounded-up seconds must fit the duration bound. | When tiredness is named to the character and others nearby. |
| `spentHours` | Number above zero, default 24; at least `tiredHours`, with the same duration bound. | At this debt a turn becomes eight hours of sleep, without a request. |
| `weather` | Weather object or null, absent for none. | A schedule or a seeded series of perceptions. It does not slow, chill or wake anyone. |

### Place

`Place` in `src/world.ts` is an ordinary place, with no hours or door state.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | The destination of a walk and holder of its things. |
| `name` | Required text. | Its public name. |
| `about` | Required text. | What everyone knows of it; use only what does not move. |
| `facts` | Text or null, absent for none; 300 words at most. | Truth for the world model alone. |
| `things` | List of things, default empty; at most 60 records including all contents. | What the rules can find, move, eat, burn and change here. |
| `open` | Boolean, default false. | True for open sky, otherwise a roof; selects weather and cues to time. |
| `clock` | Boolean, default false. | A clock at hand for anyone here. It is not a movable thing. |
| `crowd` | Text or null, absent for none; 60 words at most. | Who is around as anyone sees them. The crowd answers nobody. |
| `figures` | List of figure objects, default empty. | Named people who answer a speech addressed to them. |
| `at` | Two finite numbers `[x, y]`, east and north in metres, or null; absent for none. | When both ends have coordinates and neither lists a time, the straight-line walk at the world's pace, in whole minutes above ten or tenths up to ten, with a one-second minimum. |
| `minutesTo` | Object from another place's id to a number above zero, default empty; rounded seconds with a one-second minimum must fit the duration bound. | Overrides coordinates and the world's fallback time. The departing place's value wins if both ends list the pair. This can make the two directions differ. |
| `alongTo` | Object from another ordinary place's id to nonempty text of at most 60 words, absent for none. | What the world reads for a deed along that way with `legMinutes`. Either end supplies it; the departing end wins when both list it. |
| `nextDoor` | List of other ordinary place ids, default empty. | A door or thin wall that can carry a deed's sound. Either end listing the pair makes it mutual. Speech itself never passes it. |

### Character

`Character` in `src/world.ts` separates a sheet, which stays true, from a memory, which ages.
Put today's debt, a sum owed or where something was put in memory, rather than in the sheet.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | The person whom the model plays; also a holder and a call's recipient. |
| `name` | Required text. | Its public name. |
| `place` | Required ordinary place id. | Where it starts, awake. A character cannot start inside a vehicle. |
| `sheet` | Required text. | Who it is. No other resident or world model receives it. |
| `memory` | Text or null, absent for none; at most `longWords` words. | What it remembers at the start: what it saw, owes or knows. |
| `facts` | Text or null, absent for none; 300 words at most. | Unchanging truth for the world model alone. |
| `looks` | Text or null, absent for none; 60 words at most. | The body and face, which never change. Clothes belong among things that can be taken off. The owner has it in its system text; people nearby see it. |
| `pose` | Text or null, absent for none; 20 words at most. | How and where within its place it is. Going and falling asleep clear it; waking keeps a pose given during sleep. |
| `carries` | List of things, default empty; 30 records at most including all contents. | What it carries or wears, which goes with it. |
| `clock` | Boolean, default false. | A watch or phone at hand, not a thing that can be handed over. |
| `wordsPerMinute` | Number above zero, absent for the world's rate; same speech-duration bound. | The rate for this person's `say`, `call`, words with a deed, and turn's speech limit. |
| `traces` | List of at most 8 different nonempty texts, 12 words each, absent for none. Whitespace is joined and trailing `.` or `;` removed before checking for repeats. | Temporary visible marks on body or clothes, such as `pink pudding on the upper lip and the tip of the nose` or wet hair. Even an empty list turns traces on for the world. They do not fade or pass to anything by themselves. |
| `marks` | List of at most 6 initial mark objects (`MAX_MARKS`), default empty; no repeated zone and kind. | Lasting feelings from the start, permanent until changed. A nonempty list needs the world's `marks: true`; an empty list does not. |

### Figure

`Figure` in `src/world.ts` is a named person of one place whom no model plays.
Each figure is `{ id, name, looks, facts, wordsPerMinute, hours }`. It has no sheet, memory, turn or carried things, never speaks first, wakes nobody and follows nobody.
A call cannot reach it. Asking it to answer costs a request even when it says nothing.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | A `say` with this `to` addresses it when it is in the speaker's place. |
| `name` | Required text. | Its public name. |
| `looks` | Text or null, absent for none; 60 words at most. | What anyone in the place sees. |
| `facts` | Text or null, absent for none; 300 words at most. | What the world knows when speaking for it, never sent to residents. |
| `wordsPerMinute` | Number above zero, absent for the world's rate; same speech-duration bound. | The rate of its answer. |
| `hours` | Two different times read with `TIME` in `src/reading.ts`, like `["07:00", "12:00"]`; absent for always here. | Its daily hours, from the first time up to the second, the second excluded; an earlier second time runs over midnight. |

`figureHere` in `src/time.ts` decides presence from the world file and the moment alone. Outside its hours a figure
is away, cannot be seen or heard and does not answer. Requests give only its name and hours in the away line;
its looks and facts are withheld. A figure here with hours has `Here from F to T.` after its list line.
`hoursOf` and `awayOf` in `src/live.ts` build these additions. No arrival or departure is saved or asks a model.
A resident's wait in the place ends at the next coming or going if it would last longer, through `figureChangeIn`
in `src/time.ts` and `apply` in `src/action.ts`; a wait on a walk, in a vehicle or continuing a deed keeps its span.
A turn in the place at that moment says who has just come or has just left, through `figureChangesOf` in `src/live.ts`.
Past speech and answers keep the figure's name and speech rate, through `namesOf` and `figuresOf` in `src/world.ts`,
which still include every figure of the file. A file without hours keeps its requests and saved state unchanged.

### Thing

`readThings` and `Thing` in `src/things.ts` hold this form, whether in `things`, `carries` or another thing's `holds`.
The first level is 1; there are at most four levels. A thing has one holder, a place, a person or another thing.
Each thing is `{ name, … }`. A count holds nothing, so four mugs with contents need four records.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `name` | Required text, 8 words at most; none of `, ; [ ] ×`. | The name used in lists and postings. |
| `facts` | Text or null, absent for none; 300 words at most. | Truth of the thing itself, such as what a notebook says or what a bag does not hold. It goes with the thing; write sentences naming it, since the world reads them among the place's facts without labels, and word two like things so that their facts tell them apart. |
| `n` | Whole number from 1 to 1,000,000,000, absent for one uncounted record. | A count of things alike, such as money, cigarettes or logs. |
| `holds` | List of things, absent for no container. | A table, bag or coat with pockets. Even an empty list makes a container; it cannot also be counted, a stock, food or something that burns. |
| `open` | Boolean, default false; true needs `holds`. | Its contents are in plain sight. It does not open a door between places. |
| `fixed` | Boolean, default false; allowed only at a place's top level or inside a fixed thing. | A part of the place that cannot move. Never allowed on a character or inside something movable. |
| `price` | Object `{ name, n }`, absent for none; needs `prices`. | One costs `n` units of the counted money named by `name`, with the bounds of a fare. Only on movable things of an ordinary place, never money or things carried by a character. |
| `till` | Boolean, default false; needs `prices`, `holds` and `fixed`. | Where prices are paid. Never hidden or inside a hidden thing, on a character, in a vehicle or at the fourth level, where it could hold nothing. A place has at most one at any depth, and exactly one when it has priced things. |
| `stock` | Boolean, default false; cannot have `n` or be money. | A supply with no count; taking from it does not use it up. |
| `food` | Finite number, zero or above, absent for none. | Calories of one, and permission to eat it. Only hunger accounts for the calories. |
| `drink` | Boolean, default false; true needs `food`, zero for water. | Each one is a drink, including what comes from a stock. Read but does nothing without hunger; never shown in requests or thing notation. |
| `burns` | Boolean, default false. | Permission to burn it up, when there is fire. |
| `states` | 2 to 4 different strings, default none; each 1 to 30 characters with no whitespace, `/`, `(`, `)` or the signs forbidden in a name. | The states it can be in. Not allowed on a count or stock. |
| `state` | One of `states`, default the first; absent when there are no states. | Its starting state. Needs `states`. |
| `fire` | Boolean, default false, or one of `states`. | True can set things alight; a named state can do so only while it is current. |
| `money` | Boolean, default false; true needs `n`. | Counted money, which a deed neither creates nor uses up. A bus fare can use it up. |
| `hidden` | Object `{ spot, minutes }`, absent for visible; only on a place's or vehicle's top-level thing. | What lies unfound, with its contents. Finding makes it visible to everyone. |

### Hidden thing

`readThings` in `src/things.ts` reads these required fields of `hidden`, with no defaults.

| Field | Type and bounds | What it means |
| --- | --- | --- |
| `spot` | Nonempty text, at most 20 words. | The exact spot a deed may go straight to. |
| `minutes` | Number above zero; rounded-up seconds fit the duration bound. | A person's accumulated search time here. A short deed straight to the spot can find it sooner. |
The earlier text forms of a character's `holds` or `has`, a text of `things`, and a place-level list `hidden`
are refused. They are not silently lost.

### Vehicle and fare

`Vehicle` and the vehicle part of `readCore` in `src/world.ts` describe a moving place.
It has no hours, figures, crowd, clock or coordinates. People and things stay inside its place throughout a drive,
with speech, deeds, sleep and the weather as in an ordinary place. The world's weather holds on the way.
A standing vehicle and its stop are next door; a driving one has no neighbour.

| Field | Type, default and bounds | What it means |
| --- | --- | --- |
| `id` | Required id. | Its place id, named in a `go` to get in. |
| `name` | Required text. | Its public name. |
| `about` | Required text, 60 words at most. | Its unchanging description. |
| `at` | Required ordinary place id; for a bus the first route stop. | Where a driven vehicle starts. A bus's position follows its timetable and the starting clock. |
| `faster` | Required whole number from 2 to 30. | Divides the walk time, rounded up to seconds with a thirty-second minimum. |
| `seats` | Required whole number, 1 to 12; for a bus 1 to 60. | The number of people allowed inside. |
| `drivers` | List of distinct character ids, absent for anyone, empty for nobody. | Who may drive. Refused with a route. |
| `reach` | List of distinct ordinary place ids, absent for all, empty for none. | Where it may drive. Refused with a route. |
| `open` | Boolean, default false. | An inside under open sky, rather than a roof. |
| `things` | A place's list of things, default empty; 60 records including contents. | What is inside, which goes with the vehicle. |
| `route` | List of 2 to 12 ordinary place ids, absent for a driven vehicle; no consecutive repeat, including last to first. | A bus that nobody drives, going around these stops. It takes the place of `drivers` and `reach`. |
| `leaves` | Required with a route, 1 to 48 `HH:MM` times in strictly rising order. | Daily departures from the first stop. The round must finish strictly before the next, including over midnight. Ignored without a route. |
| `stands` | Whole seconds from 30 to 1800, default 60 with a route. | The pause at each stop after the first. At the first it waits for the next departure. Ignored without a route. |
| `fare` | Object `{ name, n }`, absent for free. | The price of boarding a bus; ignored without a route. |

### Fare

`readCore` in `src/world.ts` reads these required fields of `fare`, with no defaults.

| Field | Type and bounds | What it means |
| --- | --- | --- |
| `name` | Nonempty text. | Names a counted thing of money in the world file. |
| `n` | Whole number from 1 to 1,000,000,000. | The price of one ride. |

For example, a synthetic bus is:

`{ "id": "bus4", "name": "Bus 4", "about": "A yellow town bus.", "at": "pier", "faster": 4,
  "seats": 20, "route": ["pier", "market", "hill"], "leaves": ["08:00", "08:30"],
  "stands": 60, "fare": { "name": "rubles", "n": 30 } }`

A driven car could instead have `{ "id": "blue", "name": "Blue car", "about": "A small blue car.",
"at": "pier", "faster": 4, "seats": 3 }`.

### Initial mark

`readGiven` and `Given` in `src/marks.ts` read each entry of a character's `marks`.
Each is `{ zone, kind, level, text }`. Every field is required, with no default.

| Field | Type and bounds | What it means |
| --- | --- | --- |
| `zone` | `head`, `face`, `neck`, `shoulders`, `chest`, `back`, `belly`, `hips`, `arms`, `hands`, `legs`, `feet` or `body`. | The part of the body; `body` is the whole of it. |
| `kind` | `itch`, `burn`, `ache`, `pain` or `numb`. | The kind of feeling. |
| `level` | `faint`, `clear` or `strong`. | Its strength. |
| `text` | Nonempty text, 15 words at most. | Where exactly and what it feels like. |

### Environment and weather

An environment holds only `dayStart`, `tiredHours`, `spentHours` and `weather`, in the forms above and below.
The world file's explicit value of any of these wins over the environment's, including null where allowed.
The environment is checked on its own, so an override cannot hide an invalid setting. Hunger belongs to the world
file alone. `environmentOf` and `readWorld` in `src/laws.ts` hold the choice and the merge.
The CLI reads the files; the core reads none. The three supplied environments are `mountain-winter`, for
«A Night on the Pass», `sea-summer` and `village-summer`, synthetic texts in English.

`readWeather` and `skyOf` in `src/weather.ts` read either of these weather forms.
A seeded series takes precedence when `seed` is present; otherwise a schedule needs `start`.

| Object | Field | Type, default and bounds | Meaning |
| --- | --- | --- | --- |
| Weather schedule | `start` | Required sky object. | Weather at the story's start. |
| Weather schedule | `changes` | List of change objects, default empty. | Changes strictly after the start and one another, each elapsed time fitting the duration bound. |
| Weather series | `seed` | Required nonnegative safe whole number. | Determines state and duration by seed and change number alone; no state comes twice running. |
| Weather series | `states` | Required list of at least 2 sky objects. | States that must read true at any hour; the series knows no season or time of day. |
| Weather series | `minutes` | Required pair of positive safe whole numbers `[least, most]`, most at least least; both times in seconds fit the duration bound. | The shortest and longest span of one state. |
| Sky, or change | `text` | Required nonempty text, 40 words at most. | What is seen and felt under open sky. |
| Sky, or change | `indoors` | Text or null, absent for none; 40 words at most. | What reaches under a roof, or nothing. |
| Change | `day` | Required positive safe whole number. | Day 1 begins at the starting clock, later days at midnight as the clock counts them. |
| Change | `at` | Required `HH:MM`. | The time of day of the change. |

