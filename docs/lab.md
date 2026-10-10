# The lab

The command line of `sagents lab`, the folders it reads and the page's language are in
[README](../README.md#the-lab). This page says the rest.

A directory is looked into six levels deep. Names that begin with a dot and `node_modules` are passed over, a link is
followed only where it stays inside the directory given, and a `*.sqlite` is never opened: only its name is looked at.
On a system without `/proc`, the lab trusts that nobody rewrites the given folders while it reads them.
What is found is listed newest first, in groups by the folder it lies in, and typing a part of a name narrows the
list. An experiment has one of three shapes:

- A world: a directory with `world.json`, as `live --run` keeps one. Every `<name>.events.jsonl` in it is a stretch
  of that one world, with `usage-<name>.jsonl` or `<name>.usage.jsonl` beside it, and it may have `about.txt` and the
  chapters of a story, `story/chapter-NN.json`. The lab shows the stretches joined, as one story.
- A run: in a directory with no `world.json`, every `<name>.events.jsonl` is an experiment of its own, with the usage
  file and the transcript `<name>.txt` of its name. Names of residents and places come from a `*.json` of the same
  directory that reads as a world file and has the characters of the run's events, `<name>.json` first; with none,
  the ids are shown.
- A text: a transcript `<name>.txt` with no events file, taken for one when a state file or a usage file of its
  name lies beside it; `<name>-1.txt` and `<name>-2.txt` beside `<name>.sqlite` are one experiment. Only its text is
  shown. Any other `.txt` is passed over.

A rehearsal, a run whose name begins with `dry-` or in which no request reported a token, is listed apart, folded.
The page has the feed of events with filters by resident and a search, the numbers of the requests, a comparison of
two experiments side by side, the story's chapters and the transcript; `?` lists its keys. A field or a kind of
event that the page does not know is shown as a plain line, so a journal of a newer engine still reads.
[The browser checks](measured.md#lab-browser-checks) covered both languages.

`layoutOf`, `groupsOf` and `layGroup` in `lab/map.js` lay out the places; `sceneOf` and `peopleOf` in
`lab/map.js` draw them, and `whereAt` and `ridersAt` in `lab/map.js` give positions. An experiment with a
world file has a map (`P`). Each place is named, a room as a box, open sky with a rounded dashed edge,
unplayed people named below; a thick line joins `nextDoor` places. Nearby places form groups, each with its
own scale below. Links between groups give travel time and are not to scale. The shortest ways join places
into a tree; a way parts groups at five minutes or more and at least three times the middle of its part's
other ways. Within a group a place with `at` stands by its metres and one with minutes alone by its minutes, as
well as a plane allows. Coincident places and
overlapping boxes spread apart, so a few steps cannot be measured on the drawing.

Each person has a coloured mark at the control's moment, a ring asleep, or a mark on a dashed journey line
naming destination and arrival time. Directions have separate sides; beyond six travellers per direction, the
rest share a counted mark. When only a continuation is available, someone with no event yet is listed as not
yet known and has no mark, and so is someone whose first event finds it elsewhere than where the world file
starts it, until that event. The moment is the address's `t`, as in the feed; `J` and `K` step forward and
back through moves, falling asleep and waking. Following newest uses the newest moment. Pointing at a place
shows its description, occupants and times to every other place; clicking filters the feed by place. With two
experiments, the map says it shows only the left one. The same world file gives the same drawing at every
load.

With vehicles, the feed names drives, pull-ups and door crossings, marking fare postings as fares. Riders stay
in their vehicle, drawn at its stop or along its drive; the list names the vehicle too, and empty vehicles
have no mark. Buses follow timetables without arrival records. Times are hours and minutes; legs take
directional walk time divided by `faster`, rounded up to seconds, at least thirty seconds. Stops after the
first last `stands` seconds; at the first the bus waits for its next leaving.
[The map checks](measured.md#lab-map-checks) used the page's layout code.

`openInside` and `mapOf` in `lab/data.ts` keep paths within the roots and restrict world fields;
`openInBrowser` in `lab/open.ts` keeps the address out of process arguments.
What the lab may do with the files, and `lab/lab.test.ts` holds it to that:

- It listens on `127.0.0.1` alone and has no option for another address. Its address holds a token made at start,
  and every path without it, and every method but GET, is answered 404.
- The token is in no process's arguments. The browser is handed a file that only you can read, in a temporary
  directory that only you can open, which leads on to the address, as Jupyter does it; the file is removed when the
  lab stops.
- No name from a request builds a path: an experiment is looked up among those the walk found.
- Of a world file there leave the lab the ids and names of characters and places and what the map is drawn from: of
  the world `travelMinutes` and `walkMetresPerMinute`; of every place `at`, `minutesTo`, `nextDoor`, `open`, `about`
  and the ids and names of its `figures`; of every character the `place` it starts in; of every vehicle its id,
  name, `at`, `faster`, and, for a bus, `route`, `leaves` and `stands`. Nothing else of it: never a
  sheet, a memory, looks, facts or things of anyone or anything, never `crowd`, never the description or the facts
  of the world. Of a chapter everything but its `carry`; of a usage row the counted fields; of a failure its code.
- The list gives `mapKey`, the world file's modified time and size as one value, so that an edit refreshes the map.
- For the map the lab reads the events itself and gives the page where each one put someone (who, the place, where
  a way leads and how long it or a sleep takes), so a long world does not have to be loaded into the browser for it.
- The page loads its script and its style sheet from the lab and nothing from anywhere else.

The server and the reading of files are TypeScript as the rest (`lab/server.ts`, `lab/data.ts`, `lab/open.ts`). The
page is plain files that the browser loads as they are: `lab/page.html`, `lab/app.css`, `lab/app.js`,
`lab/strings.js` with the page's two languages, `lab/map.js`, which lays out and draws the map, and `lab/core.js`,
which the server's reading shares with the page.
`npm run check` reads `lab/core.js` for the types of what `lab/data.ts` imports from it and reports nothing in a
`.js` file: the page's scripts are not type-checked.
