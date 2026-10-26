# An evolutionary search

`sagents evolve` lets a model improve one text file, a program or another document, against an evaluator command,
and keeps an archive of good files that differ from each other. The loop follows the evolutionary search of Gu,
Kemeny, Yelin and Lukin, [arXiv 2610.22367](https://arxiv.org/abs/2610.22367), Methods, which ran on OpenEvolve:
every step is a fresh request with one parent, a few files from the archive and the short discoveries of earlier
steps, the search begins with families of different ideas, and the archive is MAP-Elites over numbers the evaluator
gives. `runEvolve` in `src/evolve.ts` holds the loop and the archive with no disk access; `keepEvolve` and
`runEvaluator` in `src/evolve-kept.ts` keep the directory and run the evaluator.

```sh
sagents evolve <dir> --task <task.json> --model <id> [--model <id>...] --calls <n> [--parallel <k>] [--tries <t>] [--timeout <s>]
```

`--calls` has no default: it is the most calls this start makes, tries included; a call is one request, which the
plan's connection may send twice (see the end of [The loop](#the-loop)). `--parallel` (1 to 16, default 1) runs that
many steps at once, and at most that many evaluations. `--tries` (0 to 10, default 2) is how often one step may run
the evaluator on a draft before it submits. `--timeout` (1 to 3600 seconds, default 180) limits each request; a
request past it is a `timeout`, which ends its step, and its tokens are spent with no answer, so a model that
thinks for minutes needs more, and ideation, whose answer carries several files, more still. A line for every file
evaluated goes to stderr, with its number, kind, family, parent, the model when there are several, and score or
`not valid`; the summary is one JSON line on stdout. Ctrl+C stops the run: requests under
way are cut, evaluators are killed, and a file whose evaluation was cut short stays in `files/` with no row.
`evolve` runs on Linux and macOS, since an evaluator is stopped with its process group, which Windows does not have;
`evolve-map` runs anywhere.

`--model` names a model as the `model` of an [`ask`](ask.md) request does: one of the plan's, alone or with its
effort, as `gpt-6.1-sol@high`, or `api:<id>`. Named more than once, the models take the steps in turn, in the order
given: step 1 goes to the first, step 2 to the second, and after the last to the first again, each step whole, its
tries and its submit or the one request of an ideation. So `--model gpt-6.1-sol@high --model gpt-6.1-terra@high`
alternates the two, and a model named twice has two shares. The steps are numbered on across starts, so a second
start keeps the split, and other names change it from there. Each name has its own connection, as each character of
`live --cast` has. A failure that ends the run, `budget_exceeded` among them, ends it whichever model met it.

## What the file can do

The file the model writes is run by your evaluator, with your rights. sagents removes only `SAGENTS_API_KEY` from
the evaluator's environment. A program can read every file you can, the sign-in of `~/.config/sagents/chatgpt.json`
among them, use the network, write the run directory, print a verdict of its own in place of the evaluator's, and
put what it read into the feedback, which the next requests carry to the model. sagents does not sandbox it. When
the file is a program, let the evaluator run it in a sandbox with no network and only the files it needs, such as
`bwrap` or a container.

## The task file

`readTask` in `src/evolve.ts` reads it:

| Field | What it is |
| --- | --- |
| `spec` | The problem in the user's words: what the file must do and how it is checked and scored. Every request carries it. |
| `evaluate` | The evaluator as a list of arguments, with no shell: a program and its arguments, one of which is exactly `"{file}"` and becomes the path of the file to judge. It runs from the task file's directory. |
| `cells` | The archive's features, 1 to 4. Each is named by a letter and up to 39 more letters, digits, `_` or `-`, and has a list of 1 to 20 ascending finite edges. A value below the first edge is in bin 0, one at or past the last edge in the last bin. |
| `file` | Optional. The seed, a path from the task file's directory, read only when the run has nothing yet. Without it the run begins with ideation. |
| `rules` | Optional. More instructions, such as "keep the command-line interface". |
| `timeout` | Optional. The whole seconds an evaluation may take, 60 by default, at most 3600. Past it the evaluator's process group is killed and the file is not valid. |
| `size` | Optional. The most characters a file may have, a whole number, 40,000 by default, at most 80,000, since the plan connection ends an answer past 100,000 characters and the file comes inside JSON. A longer file is kept and not evaluated. |
| `stale` | Optional. A whole number: after this many steps that kept a file and improved no family's best, ideation runs again; 10 by default. |

The evaluator prints, as the last line of its output, one JSON object: `valid`, true or false; when valid, `score`, a
finite number, lower is better, and `features`, a number for every feature of `cells`; and `feedback`, a short text
with errors, counterexamples and what the score is made of, cut at 4,000 characters. A non-zero exit, a signal or
a timeout makes the file not valid, with the end of stderr as the feedback. The evaluator's process group is killed
when it ends, so what it left running ends too; a process that starts a session of its own escapes that, and so
does the group when sagents itself is killed with SIGKILL. A file is evaluated once, even when it comes twice at
the same time: a later copy takes the earlier verdict and names it in `same`. The evaluator's code and data must
stay as they are for the whole run, since nothing compares them between starts.

## The loop

- **Ideation** asks for families, each a name, an idea in one line and a first file, told the families that exist
  with their ideas. It asks for as many as one answer can carry: 80,000 characters divided by `size`, from one to
  five, so two at the default size. Each first file is evaluated, and a valid one starts its family. Ideation runs
  when no family has a valid file and whenever `stale` steps that kept a file pass with no family improving; a step
  whose request failed or whose answer gave nothing to use is not counted. An ideation that gives nothing, by a
  failure or an answer that cannot be used, is asked again rather than put off by `stale` more steps. While no
  family has a valid file, three ideations that begin none, failed and unusable ones among them, end the run with
  `no_valid_start`.
- **A step** takes the best file of a family, the families in turn; every fourth step takes instead an elite of the
  archive, the cells in turn, so that a cell no family leads still gets worked on. The request holds the parent with
  its score, features and feedback, up to two other files, the best of other families first and then the elites of
  other cells, and the last 20 discoveries. The answer is `{ notes, discoveries, tool, file }`: `try` runs the
  evaluator on the file and sends back its verdict, `submit` evaluates and keeps it and ends the step; after the
  last try the schema allows only `submit`. A step costs one request and one more for every try.
- **The archive** keeps every file evaluated, tries included. A cell's elite is its lowest-scoring valid file, and a
  family's best is its lowest-scoring valid file.
- **The end.** The run ends at `--calls`; after three failures of one request in a row; at once at any other
  failure of the connection but `output_limit` and `declined`, `budget_exceeded`, `rate_limited` and `unauthorized`
  among them; after five answers in a row that give nothing to use, cut at the output limit, declined or not of the
  schema; or at Ctrl+C. A failure of one request, `timeout`, `provider_failed`, `model_unavailable`,
  `incomplete_stream`, `invalid_stream`, `invalid_response` or `empty_response`, ends only its step, and the
  requests under way go on; the summary counts failed requests in `failures` and answers that gave nothing to use in
  `invalid`. In the summary `budget_exceeded` outranks any other end, a failure a stop, and a stop the end of the
  calls, whatever came first. A call is counted before its request is sent. When the calls are spent, requests and
  evaluations under way finish and are kept; a failure that ends the run cuts the requests under way, whatever ended
  the run before it, so that none is sent again after it.

In the summary `calls`, `added`, `invalid`, `failures` and `models` count this start, and `candidates`, `valid`,
`cells`, `families` and `best` the whole archive, with what earlier starts kept. `models` gives for every name its
`requests`, `failures`, `invalid` answers, `files`, `valid` files and `gains`, the files of its steps that improved
their family's best; its `input`, `cached`, `written`, `output` and `reasoning` tokens; and `ms`, the median time of
a request it answered, null when it answered none.

The plan's connection sends a request once more when the connection fails before any response, as it does for
every command ([One request](ask.md)); the request's row then has `tries: 2`, and it is still one call. A server
that took the first send may count both, so the requests a start sends can pass `--calls` by the rows with
`tries: 2`.

All requests of a run share the instructions and the spec as their system text, which names no model, and each
model has a cache key of its own, made from the cache name kept in `run.json` and the model's name without its
effort, so that the service can keep that part cached for every model and the requests of one do not crowd the key
of another; one model at two efforts shares its key.

## The directory

As with `live --run`, files are only made where there are none and lines added to them. Each file appears whole or
not at all; the one that is ever replaced is a file of `files/` that a kill cut short, whose contents no longer
match its name.

- `task.json`, the task file as given; a second start with another task file is refused;
- `run.json`, the cache name and the task file's directory; a second start with the task file in another directory
  is refused, since the evaluator runs from there;
- `files/<sha256>.txt`, every file seen;
- `candidates.jsonl`, a row per file evaluated: `id`, `at`, `kind` (`seed`, `idea`, `try` or `submit`), `family`,
  `parent`, `sha`, `chars`, `valid`, `score`, `features`, `feedback`, `cell`, `same`, `discoveries`, `call` and
  `step`, the number of the step that brought the file, shared by the tries and the submit of one step and by the
  first files of one ideation, null for the seed; `model`, the name that wrote the file, on every row but the
  seed's; on a try or a submit `others`, the ids of the other files its request showed beside the parent, and
  `turn`, `family` when the parent was its family's best and `cell` when it was a cell's elite; and the model's
  `name` and `idea` on the first row of a family;
- `usage.jsonl`, two rows per request: `n`, `at`, `kind` (`ideate` or `iterate`), `family` and `model` with
  `sent: true` before it is sent, and the same with `ms`, the input, cached, written, output and reasoning tokens,
  `error` with a code when it failed and `tries: 2` when it was sent twice, when it ends. A request with only its
  first row was under way when the run was killed. No row holds text of a request or an answer;
- `lock.sqlite`, whose lock the run holds while it runs; the system lets it go when the process ends.

A family is named by a number, `f1`, `f2` and so on, or `seed`, in the usage rows and on stderr; its name, the
model's words, is only in the archive and the requests. A second start goes on from what is kept: the request
numbers and the steps go on after the highest kept, the ids continue, and a line cut by a crash is skipped. The
counts the loop chooses by are taken from the kept files in the order they were kept, as the loop counts them: the
steps since the last ideation or gain, so that a run stopped and started again still turns to ideation after
`stale` steps with no gain, and the turns of the families and of the cells, by each step's `turn`. Only kept files
count, so a step that kept none gives its turn back, and an ideation whose answer held no family is not seen. Rows
kept before steps were numbered give no counts, and those kept before `turn` count as the families' turns. A start
is refused when rows edited by hand number so high that the next numbers would not be exact. The model's `notes`
are not kept.

## The map

```sh
sagents evolve-map <dir> > map.html
```

`evolve-map` draws a run as one HTML page on stdout, to see the path a search took, after it or while it runs. It
only reads the directory: it takes no lock, writes nothing and sends no request. The page loads nothing and runs no
script, so it opens offline in any browser, in light or dark. It shows:

- the requests in order, with the ideations, the failures, the answers that gave nothing to use and the requests
  with no end kept;
- the best valid score so far;
- a lane for every family with a valid file: each file at the request that brought it and its score, lower and
  better at the top, with a line from its parent; the families with no valid file share the last lane;
- the cells and their elites, as a grid for one or two features and as a table past that;
- the families with their requests and tokens, and the discoveries;
- the models, when the rows name them, with what each was asked, answered and kept, the median time of an answer and
  the share of its input that was cached;
- every file with its step and model, its feedback, the files shown beside its parent and its change against its
  parent, how many steps were shown the file itself, and the whole text of a file with no parent, of each family's
  best and of each elite.

A mark opens its file. A line the run is still writing is left out, and so is a row whose fields are not of their
kinds, as one edited by hand, and the text of a file of `files/` that a kill cut short. The page holds the
archive's text, the model's files and the evaluator's feedback, so share it as you would share the directory.
