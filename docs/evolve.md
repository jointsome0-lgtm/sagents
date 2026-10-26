# An evolutionary search

`sagents evolve` lets a model improve one text file, a program or another document, against an evaluator command,
and keeps an archive of good files that differ from each other. The loop follows the evolutionary search of Gu,
Kemeny, Yelin and Lukin, [arXiv 2610.22367](https://arxiv.org/abs/2610.22367), Methods, which ran on OpenEvolve:
every step is a fresh request with one parent, a few files from the archive and the short discoveries of earlier
steps, the search begins with families of different ideas, and the archive is MAP-Elites over numbers the evaluator
gives. `runEvolve` in `src/evolve.ts` holds the loop and the archive with no disk access; `keepEvolve` and
`runEvaluator` in `src/evolve-kept.ts` keep the directory and run the evaluator.

```sh
sagents evolve <dir> --task <task.json> --model <id> --calls <n> [--parallel <k>] [--tries <t>]
```

`--calls` has no default: it is the most requests this start sends, tries included. `--parallel` (1 to 16, default
1) runs that many steps at once, and at most that many evaluations. `--tries` (0 to 10, default 2) is how often one
step may run the evaluator on a draft before it submits. A line for every file evaluated goes to stderr, with its
number, kind, family, parent and score or `not valid`; the summary is one JSON line on stdout. Ctrl+C stops the run:
requests under way are dropped, evaluators are killed, and a file whose evaluation was cut short stays in `files/`
with no row.

## The task file

`readTask` in `src/evolve.ts` reads it:

| Field | What it is |
| --- | --- |
| `spec` | The problem in the user's words: what the file must do and how it is checked and scored. Every request carries it. |
| `evaluate` | The evaluator as a list of arguments, with no shell: a program and its arguments, one of which is exactly `"{file}"` and becomes the path of the file to judge. It runs from the task file's directory. |
| `cells` | The archive's features, 1 to 4, each a list of ascending edges. A value below the first edge is in bin 0, one at or past the last edge in the last bin. |
| `file` | Optional. The seed, a path from the task file's directory. Without it the run begins with ideation. |
| `rules` | Optional. More instructions, such as "keep the command-line interface". |
| `timeout` | Optional. Seconds an evaluation may take, 60 by default, at most 3600. Past it the evaluator's process group is killed and the file is not valid. |
| `size` | Optional. The most characters a file may have, 40,000 by default, at most 90,000, since the plan connection ends an answer past 100,000 characters and the file comes inside JSON. A longer file is kept and not evaluated. |
| `stale` | Optional. After this many steps with no family improving its best, ideation runs again; 10 by default. |

The evaluator prints, as the last line of its output, one JSON object: `valid`, true or false; when valid, `score`, a
finite number, lower is better, and `features`, a number for every feature of `cells`; and `feedback`, a short text
with errors, counterexamples and what the score is made of, cut at 4,000 characters. A non-zero exit, a signal or
a timeout makes the file not valid, with the end of stderr as the feedback. The evaluator gets the environment
without `SAGENTS_API_KEY`. The same file is evaluated once: a later copy takes the earlier verdict and names it in
`same`.

## The loop

- **Ideation** asks for up to five families, each a name, an idea in one line and a first file, told the names of the
  families that exist. Each first file is evaluated, and a valid one starts its family. It runs when no family has a
  valid file and whenever `stale` steps pass with no family improving. After three ideations in a row with no valid
  file and no family, the run ends with `no_valid_start`.
- **A step** takes the best file of a family, the families in turn; every fourth step takes instead an elite of the
  archive, the cells in turn, so that a cell no family leads still gets worked on. The request holds the parent with
  its score, features and feedback, up to two other files, the best of other families and of other cells, and the
  last 20 discoveries. The answer is `{ notes, discoveries, tool, file }`: `try` runs the evaluator on the file and
  sends back its verdict, `submit` evaluates and keeps it and ends the step; after the last try the schema allows only
  `submit`. A step costs one request and one more for every try.
- **The archive** keeps every file evaluated, tries included. A cell's elite is its lowest-scoring valid file, and a
  family's best is its lowest-scoring valid file.
- **The end.** The run ends at `--calls`, at any failure of the connection but `output_limit` and `declined`, which
  waste the request and go on, with `budget_exceeded` among those that end it, after five answers in a row that do
  not fit the schema, or at Ctrl+C. A call is counted before its request is sent. Requests and evaluations already
  under way when the run ends finish and are kept.

All requests of a run share the instructions and the spec as their system text, and one cache name kept in
`run.json`, so that the service can keep that part cached.

## The directory

As with `live --run`, files are only made where there are none and lines added to them:

- `task.json`, the task file as given; a second start with another task file is refused;
- `run.json`, the cache name;
- `files/<sha256>.txt`, every file seen;
- `candidates.jsonl`, a row per file evaluated: `id`, `at`, `kind` (`seed`, `idea`, `try` or `submit`), `family`,
  `parent`, `sha`, `chars`, `valid`, `score`, `features`, `feedback`, `cell`, `same`, `discoveries` and `call`;
- `usage.jsonl`, a row per request: `n`, `at`, `kind` (`ideate` or `iterate`), `family`, `ms`, the input, cached,
  written, output and reasoning tokens, and `error` with a code when it failed; no text of a request or an answer.

`lock` names the process that holds the directory while it runs, and goes when it ends; a lock whose process is gone
is taken over. A second start goes on from what is kept: the request numbers and the ids continue, and a line cut
by a crash is skipped. The model's `notes` are not kept.
