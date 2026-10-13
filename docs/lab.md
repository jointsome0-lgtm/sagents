# The lab

The command line of `sagents lab` is in [README](../README.md#the-lab). This page says the rest.

## The folders, the address and its key

`lab` shows in a browser the experiments that lie under the directories it is given: under those that `SAGENTS_LAB`
names, separated as in `PATH`, when it is given none, and under the current directory when that is not set either.
It asks no model and writes nothing into those directories. It prints its address, which is on this computer only,
and asks the system opener to open it in the default browser unless `--no-open` is given. The usual address is `http://127.0.0.1:4747/`;
when that port is taken and no port was asked for, it takes a free one and says so. `--port` asks for a whole number
from 0 to 65535; 0 lets the system choose. Ctrl+C stops it.

`lab/open.ts` writes the one temporary file that takes the browser there with the key after `#`.
The browser gets the data key after `#` in the first address, keeps it in its origin's storage and removes it from
the address. When the system opener exits successfully, the printed address has no key. With `--no-open` or when
that command cannot start or exits unsuccessfully, it prints the first address with the key; open it once in the browser you read in.

## The page's language

The page is in English or in Russian: in the language that `--lang` names, or `SAGENTS_LAB_LANG` when the flag is
not given, or else the language it remembers, and with none in Russian for a browser set to Russian and in English
for any other. Any other flag or environment value is refused. The chosen language goes in the first address as
`?language=ru`; the page remembers it and removes it from the address. Its RU or EN button changes that choice.

## The experiments and the page

A directory is looked into six levels deep. Names that begin with a dot and `node_modules` are passed over, a link is
followed only where it stays inside the directory given, and a `*.sqlite` is never opened: only its name is looked at.
On a system without `/proc`, the lab trusts that nobody rewrites the given folders while it reads them.
An experiment has one of three shapes:

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

`listed`, `grouped` and `listOf` in `lab/core.js` filter, group and order the list. `/` is the whole list and opens
no experiment. Each line gives its name, its world's title or the first line of `about.txt` when it has one, its
kind, when its event and usage files were last written, or its transcripts when it has no events, the number of
model requests, the span of story time, the number of residents and the models recorded in usage rows. The residents'
models come first, the world's after the word "world"; a model is never guessed from a name. Missing numbers stay
empty, and a run being written says so. Entries start newest first within each folder; folders are ordered by their newest entry.
Clicking a column head orders by that column, and clicking again reverses
it. Entries stand in groups by folder, with a count and a button to fold each group. With several roots, an empty
root has a group saying so.

The filters above the list take words, a least number of requests, a day since which a file was written and a
kind, and say how many entries are shown of how many. Each word must occur in the id, name, world title or a model
name, without regard to case; `/` puts the cursor in that box. A rehearsal, whose name begins with `dry-` or whose
requests reported no input or output tokens, is hidden at first; a button counts the hidden rehearsals and shows
them. The filters and order are in the address. Browser Back or "the list" beside an open experiment returns to
the list as it was left, at the same place.

`linkOf` and `addressOf` in `lab/core.js` read and write the view's address. An experiment is at `/view/` followed
by its id as the list gives it. Reloading or pasting an address opens the same list or view:

```
/?words=otter+night&requests=150&since=2026-10-01
/view/runs/2026-10-08/evening/cafe-a?moment=22:23:27
/view/runs/2026-10-08/seaside?stretch=part2&moment=day2-08:15:00&who=nina
/view/runs/2026-10-08/seaside?show=map&moment=13:40:00
```

Absent query names mean the ordinary state:

| Where | Name | What it holds |
| --- | --- | --- |
| `/` | `words` | Words that each entry must have. |
| `/` | `requests` | The least number of requests. |
| `/` | `since` | The day since which a file was written, `2026-10-01`. |
| `/` | `kind` | `world`, `run` or `transcript`. |
| `/` | `order` | `name`, `kind`, `written`, `requests`, `time`, `residents` or `model`; `written` when absent. |
| `/` | `reverse=yes` | The order reversed. |
| `/` | `rehearsals=shown` | Include rehearsals. |
| `/view/…` | `stretch`, `alone=yes` | A stretch, omitted when there is only one; `alone` shows it by itself. |
| `/view/…` | `moment` | The story clock, `22:23:27` or `day2-08:15:00`; a count of seconds also reads. |
| `/view/…` | `show` | `numbers`, `story`, `transcript` or `map`; the feed when absent. |
| `/view/…` | `who`, `place` | Resident and place ids, separated by commas. |
| `/view/…` | `search`, `found=only` | Search text; show only matches. |
| `/view/…` | `thoughts=hidden`, `lists=hidden` | Turn off the feed's private notes or extra lines. |
| `/view/…` | `chapter` | The chapter at the top of the story. |
| `/view/…` | `step` | Seconds per row in a comparison. |
| `/view/…` | `compare`, `compare-stretch` | The experiment beside this one and its stretch; a named stretch on either side reads by itself. |
| any | `language` | Override the remembered language for any address; see [the page's language](#the-pages-language). |

An address naming an experiment the lab cannot find says so and links to the list. A browser without the data key
or with a key from an earlier start says how to get it. An open page reconnects its streams whenever its key changes,
and reloads after receiving a new key if it was locked. Restart the original lab command with its original directories
and options, adding `--no-open`, to get a recovery address. `localhost` with the port redirects to `127.0.0.1`.

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
starts it, until that event. The moment is the address's `moment`, as in the feed; `J` and `K` step forward and
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

- It listens on `127.0.0.1` alone and has no option for another address. `Host` must name that address and port;
  page and asset requests under `localhost` with the port redirect there. Any other host gets 404, including a
  name another site has bound to `127.0.0.1`.
- The page at `/` and `/view/…` and its five files hold no experiment data and need no key. `list`, `stretch`,
  `story`, `text`, `map` and `stream` under `/data/` need the key made at start in `X-Lab-Key`, a header a page of
  another origin cannot send. The stream also accepts it in its own query, since `EventSource` cannot send that
  header. A wrong or missing key, an unknown path and every method but GET get 404.
- The key is in no process's arguments or cookie. The browser gets a file that only you can read in a temporary
  directory that only you can open. The CLI removes the file on normal process exit or when the opener cannot start
  or exits unsuccessfully; abrupt termination can leave it behind. A successful opener exit does not prove a browser opened.
  Another origin, including another port, cannot read the page's stored key.
  Once app.js runs, it replaces the current history entry with an address without the key.
- Bookmarks and browser history name experiments, stretches and filters. Another user's program listening on the
  port while the lab is stopped receives those names when a bookmark is opened then.
  A replacement service on this origin can receive keys from surviving tabs and read the stored key; addresses can also disclose search text.
  An open page closes its streams, drops its stored key and stops sending it after a shutdown message or a list response
  saying the key is unknown or the lab is gone. This does not cover abrupt termination before such an answer.
  Visiting a replacement service can install a service worker on this loopback origin; it can intercept a later lab's page and keyed requests.
  Host checks do not distinguish successive owners of the same origin.
- No name from a request builds a path: an experiment is looked up among those the walk found.
- Of a world file there leave the lab its `title`, the ids and names of characters and places and what the map is drawn from: of
  the world `travelMinutes` and `walkMetresPerMinute`; of every place `at`, `minutesTo`, `nextDoor`, `open`, `about`
  and the ids and names of its `figures`; of every character the `place` it starts in; of every vehicle its id,
  name, `at`, `faster`, and, for a bus, `route`, `leaves` and `stands`. Nothing else of it: never a
  sheet, a memory, looks, facts or things of anyone or anything, never `crowd`, never the description or the facts
  of the world. Of a chapter it sends `n`, `stretches`, `title`, `span`, `text` and `model`; of a usage row the counted fields; of a failure its code.
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
