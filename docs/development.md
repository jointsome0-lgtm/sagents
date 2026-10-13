# Development

The four commands are in [README](../README.md#development). This page says the rest.

## npm run size

`npm run size` counts tokens (`o200k_base`) of three things: the core of the live mode without model and disk
(`src/world.ts`, `time.ts`, `action.ts`, `answer.ts`, `things.ts`, `journal.ts`, `laws.ts`, `sleep.ts`, `weather.ts`, `memory.ts`, `reading.ts`, `touch.ts`, `marks.ts`), `src/live.ts`, and
all tracked text except `LICENSE` and `package-lock.json`. It reads the working tree, or the Git index with
`npm run size -- --index`. The core is meant to stay small enough to read whole, and its count falls into one of four bands,
around the owner's mark of 70,000 tokens, which is there to steer by: up to 56,000 tokens, four fifths of the mark,
the number is printed and nothing else; from there to 70,000 a
note says that the core is nearing its size; from there to 84,000, six fifths of the mark, a warning says that it is over, and that a change
which adds to the core says what it takes out or why the size should rise; above 84,000 a strong warning says that
the core no longer reads whole and should be split or cut before more is added. The script ends well in every band:
it forbids nothing. One more line gives the comment tokens, total tokens and whole-percent comment share of the
core and `src/live.ts`, with a bound of 10 percent for the core. A comment is a whole line whose first characters
after indentation are `//`; its token count is the file's count less the count without those lines, summed across
the core's files. Above the comment bound a note asks for a look at comments that retell the code, while keeping
reasons; it forbids nothing. Tests are counted against nothing. The list of core files, the three size bounds and
the comment bound are at the top of `scripts/size.py`. The count needs the Python package `tiktoken`,
which is no dependency of this project: name a Python that has it in `SAGENTS_SIZE_PYTHON`.
Without `tiktoken` the script says how to get it, counts nothing and ends well. `SAGENTS_SIZE_AGAIN` is its
internal guard against entering that Python twice, not a user setting. It is not part of `npm test`. A change that grows the core says by how many tokens.
