# A judge of a live run

The command lines of `sagents eval` and a short account of it are in
[README](../README.md#a-judge-of-a-live-run). This page says the rest.

`eval` reads one finished live journal: `world.json` and `state.sqlite` from a directory that `live --run` made,
or an explicit state file and world file. It opens SQLite for reading only, including the committed records in a
killed run's write-ahead file, and refuses a file another run holds. It makes no table, changes no row and asks
for no checkpoint. SQLite may make its own `-shm` and `-wal` beside the file. SQLite's codes 8 and 14, for a file
or directory it cannot write or a file it cannot open, give a sentence naming a missing file and an unclosed run
whose directory cannot be written for its side files. The stored events are read as they are, without replay and
whatever the format mark: an unknown kind or field is shown by the same rule as a known one. The world file is read
leniently for its title, about, facts and every top-level list of objects with string ids, characters first. The head gives about and facts when they are
nonempty texts, each cut at 150 words, then each list under its own name with a line `id: name` for every item.
Its hash, with the text of the environment it names when this checkout has it, is compared with the saved hash.
A difference refuses nothing: the report says `world: "matches"` or `"unverified"`.

`--calls` and `--window` accept positive safe whole numbers.
The model name chooses the connection as in `live`. The questions file holds `{ "task": "what to look for",
"kinds": { "id": "what this kind of finding is" } }`, with 1 to 12 kinds whose ids are lower-case letters,
digits and `-`. [examples/eval-questions.json](../examples/eval-questions.json) asks about lost or invented
memories, contradictions, knowledge, repetition and character. The judge receives the task and these kinds with
its instructions, then the run's head and the first 30 memory rewrites, or `Memory rewrites: none.`, ending with
`You have <n> answers.` for the call cap, then `No record is in this message: ask for them with show.`
It answers one strict schema with its notes, findings, `drop`, a required list of integers empty when nothing is
taken back, and one tool.
`INSTRUCTIONS` in `src/eval.ts` gives the judge the live world's rules of perception, memory and time,
as described in [README](../README.md#what-a-model-is-sent). A lost obligation, promise, sum, time, location or knowledge that a
rewrite was asked to keep is a fault. The judge can also read a library run with a journal but no `pause`, whose
residents were told the horizon, unlike a kept CLI run.
The two texts of a rewrite and the records it folded are compared before anything
in it is called invented or lost; a field the instructions do not explain is no ground for a finding.
The judge writes `notes`, `says` and `summary` in the task's language, whatever language the run is in and wherever
its story is set.
`INSTRUCTIONS` in `src/eval.ts` explains when deeds, waits and sleep end early, so an action before its
original span has passed is no fault. The judge is
told to read the whole run in order
with `show` unless the task says otherwise, to use `log` to find a place by, and not to hand in a finding already
kept.

- `log` lists up to 80 records in order, with the clock, place, who, kind and first ten words, and says where to go
  on. A memory rewrite is marked `[memory rewrite; folds #<a> to #<b>]`, or with the unknown range or beginning
  as below. An empty text with a destination ends in `to <value>`.
  For every tool, a rewrite's text is the record's `text` when it is a string, else the event's `text` when it is
  a string, else none. Memory history, shown coverage and quote checks use that same text.
- `show` gives saved records, including private notes and the world's answers, up to 1,500 words. An oversized record
  is parted at white space when there is any before the cut, so a part does not cut through a word there. It
  continues in parts with `from` null, each part after the first beginning with `#<seq> goes on:` on its own line,
  including after a jump to a numbered record; after a whole record it continues with the next one in the journal.
  A record counts as shown only after answered requests carried all its text, including every part of an
  oversized one. The continuation line counts toward the answer's words, not toward the place within the record.
  A memory rewrite follows its head with `Folds <who>'s lines of #<a> to #<b>; later lines stay as they are.`, or
  `Folds <who>'s lines up to #<b>; later lines stay as they are.`, or `Folds an unknown range of <who>'s lines.`.
  It then gives `Memory before (<n> words):` and the whole text replaced, the world's first memory for a first
  rewrite, or `Memory before: none.` for an empty or missing first memory of a person in the world file.
  For a person absent from that file with no earlier rewrite that gave text, it says `Memory before: unknown.`.
  Then come `Memory after (<n> words):` and the new text, then the other saved
  fields. A rewrite that gave no text instead gives
  `The rewrite gave no text: the memory stayed as it was, and the folded lines are gone.`, then
  `Memory (<n> words):` and the text that stayed, or `Memory: unknown.` when that text is unknown.
  All of this is the record's text for parts, coverage and
  quotes. Nothing of `by` or `at` is listed; the head uses `+<at> s` when the event
  has no clock. Empty fields and `false` are left out; strings print as they are, other values as JSON.
  With `who` and no numbers, `show` searches every top-level list of objects with string ids, characters first.
  A character gives name, looks, sheet and first memory in that order, then every other field; another object gives
  name and then every other field. The id is not repeated, empty fields are omitted by the same rule as records,
  and the whole is cut at 1,500 words. A cut ends with `Cut at 1500 words of <n>. Not shown in full: <fields>.`,
  naming the fields cut or left out, with commas.
- `diff` takes only a character of the world file. It gives the latest rewrite text just before `from` and after
  `to`, or the first memory when none has been written. A null `from` means the first record, a null `to` the last:
  no numbers compares the whole run. Each text is counted in words and cut at 1,500, with a cut marked.
  Each intervening rewrite
  lists the range it folded, beginning at the journal's first record for the first rewrite, including a lost rewrite
  that left the old text but dropped the lines. A bound counts only when `upTo` is a whole number, at least the
  first record's number, below the rewrite's number and above the preceding rewrite's bound for that person
  when that bound counts. `log`, `show` and `diff` share this reading: `folds #<a> to #<b>` for a first rewrite
  or one whose preceding bound is known, `folds up to #<b>` when the preceding bound is unknown, and
  `folds an unknown range` when its own bound is unknown. A line in `diff` begins `#<seq> folds #<a> to #<b>.`,
  or uses the other range wording, with the lost-rewrite detail when no text was given.
- `report` ends the judge's run with its summary of the task. If records have not been shown in full to answered
  requests, the first report before the last request is answered once with the findings' receipts, then
  `<n> of <m> records have not been shown; the first of them is #<seq>. Read them with show, or answer report again to end with them unread.`
  Its findings and `drop` are checked, and its notes and summary kept, as with any answer. Any later report ends
  the run, even with records unread; the last request ends it without a question. A report that ends the run gets no
  answer telling the judge which findings were kept or taken back.

`who` is trimmed; an empty or whitespace-only value means null. `log`, `report` and `show` with numbers ignore
it. Where it matters, the lookup first tries an exact id, then an id or name without regard to case. `log` with `from` null
continues where it stopped; `show` with `from` and `who` null continues after the last record it showed, or within an
unfinished one.

`normalized` and `contains` in `src/eval.ts` compare quotes by whole words; `runEval` in `src/eval.ts` keeps
and takes back findings. The schema allows any number of integers in `at`; an empty list refuses the finding
with `record`. Only the first four numbers count, without repeats, sorted. All must name existing records; the
whole quote must occur in at least one's full `show` text, including a rewrite's replaced memory. Only after
comparison is the saved quote, in findings and `unkept`, normalized to Unicode NFC and cut at 40 words.
Comparison uses Unicode NFKC and ignores case. Commas and points between digits and apostrophes between
letters stay within words, with typographic apostrophes folded to plain ones: `1,000`, `1.25` and `I'll` are
one word each. Other signs separate stretches of letters and digits, so text without spaces must be quoted
from one separating sign to the next. Quotes must span whole words: `can` cannot match `cannot`, `1` cannot
match `100`, `1,000` or `1.25`, nor `ll` match `I'll`. Quotes without letters or digits are refused. The same
kind, record set and cut quote, under the same folding, is kept once. At most 50 findings stay kept; the next
tool answer gives numbers and refusal reasons, unless `report` ends the run.

`drop` is read before `found`: a kept finding of each given number leaves `findings` and enters `dropped` with
the request's number as `call`. Its receipts come first: `Finding #<n> taken back.` or
`There is no kept finding #<n>.`. Taken-back findings leave the judge's view and cease counting as duplicates.
The view is rebuilt then and when older answers leave it. Finding numbers are never reused; the 50 limit
counts only those currently kept. Instructions put doubts and checks finding nothing wrong in notes;
conclusions from quotes are unchecked. Nonempty notes replace old notes, cut at 150 words; explanations at 40,
summaries at 300. Words count as in live, at most ten characters per word for limits.

Each assistant message holds a usable answer's own text in full. Only an unusable answer is cut at 60 words,
or replaced by `{}` when there is no text. When the judge's answers and the tool answers together pass
`--window`, 6,000 words by default, the oldest pairs an answered request has carried leave together until at most
half is left, or no more can leave. The newest pair and every pair whose tool answer no answered request has
carried stay, whatever their size or place among the pairs. A request is answered whenever text came back, even
if it could not be used. A failed request, including one cut at the output limit or declined, carries nothing
and counts no records as shown. The head keeps its own beginning byte for byte; after an empty line it takes the
older pairs' place with the notes and kept findings without quotes. Every new message to the judge after the
first ends with where `show` goes on, before any count of answers left, unless `show` gave records or part of one
in that message and said where to go on itself, or the message asks about an early report. The line is
`Show goes on within #<n>.` for a part,
`Show starts at the first record.` before any record is shown, `Show has reached the last record.` at the end,
and `Show goes on after #<n>.` otherwise. It follows `log`, `diff`, a person's, place's or thing's view, an empty or
refused tool answer, and the message after an unusable answer alike.
Every request alternates `user, assistant, user, …, user`. Requests carry one cache name made as in live. The cap
is `--calls`, 60 by default: every request counts, including an unusable
answer, one cut at the output limit or a request the service declined to answer. Three unusable answers in a
row end the run as `failed`, with the third answer's reason: `output_limit`, `declined` or `invalid` for text
that is not the schema's object. A usable answer resets this count. Every other request failure ends the run
at once. A declined request counts as a call and is not sent again. The judge is told when five or fewer answers
remain, with `1 answer left.` for one. The last request allows only `report`; its warning is in the newest tool answer, or at the end
of the head when the cap is one call. A failed request is not tried again. A cap reached without `report` gives
`failed` with reason `calls`, keeping the findings so far. A journal with no records ends at once as `failed`
with reason `empty_journal`, before any request.

One JSON report goes to stdout, or to `--out`, which must name a file that does not exist. One line of counts,
including findings and how many were taken back, goes to stderr. When the command ends in the ordinary way before
a report is written, it tries to remove an empty file made for `--out`; a failure of that cleanup is let go, so
the empty file may remain. The
report holds the status and failure code, and `httpStatus`, `providerCode` and `param` when the failure that
ended the run had them, never the service's words. It holds the model, world hash check, records and records shown
in full, findings with their clocks and checked quotes, refusal counts, last notes and summary, calls and invalid
answers, `dropped`, the first 50 findings taken back with their request numbers, and
`unkept`, the first 50 refused items as `{ call, kind, at, quote, says, why }`. Its texts have the same limits
as kept findings; `why` is `quote`, `record`, `duplicate` or `full`, and `refused` counts all refusals beyond
those 50. It holds one usage row per request. A row has the tool, `from` and `to` as given, `who` as the id
found or null, `kept` for the findings that answer added whatever it took back, `words` for the tool answer's size,
zero for a report that ends the work since none is sent, milliseconds and
input, cached, output and reasoning tokens, null when not reported, and a failure's code when it failed. No
request or answer text is in usage. A failed run exits with code 1, as in live.

There is no branch to try a move on, and only one run is judged at a time. A checked quote
is evidence that its folded words occur together as whole words in a named record's printed text or the memory
a named rewrite replaced. It does not establish that the finding is right.
The [judge measurements](measured.md#judge-measurements) compare wordings and models.
