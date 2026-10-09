#!/usr/bin/env python3
"""How large the project is in tokens, so that the core stays small enough to read whole.

    npm run size            the working tree's text of the files Git tracks
    npm run size -- --index what is staged in the Git index

It prints three counts: the core, `src/live.ts`, and all tracked text. The core's count falls into one of four
bands, and from the second on this prints a line that grows stronger with the band. It always ends well: a band is a
reason to look, not a ban. It never estimates: without `tiktoken` it says how to get it, counts nothing, and ends
well too.
"""
import os
import subprocess
import sys

# The core of the live mode: the rules, with no model and no disk in them.
CORE = ['src/world.ts', 'src/time.ts', 'src/action.ts', 'src/answer.ts', 'src/things.ts', 'src/journal.ts', 'src/laws.ts', 'src/sleep.ts', 'src/weather.ts', 'src/memory.ts', 'src/reading.ts', 'src/touch.ts', 'src/marks.ts']
# The bands of the core's size in tokens: up to the first bound nothing is said, and above each bound its line.
# 70,000 is the owner's mark for the core's size, to steer by and not a ban; the other two are four fifths and six
# fifths of it.
CORE_BANDS = [
    (56_000, 'note: the core is nearing its size.'),
    (70_000, 'WARNING: the core is over its size. A change that adds to the core says what it takes out of it, or why the size should rise.'),
    (84_000, 'STRONG WARNING: the core no longer reads whole. Split it or cut it before anything more is added.'),
]
LIVE = 'src/live.ts'
# Tracked files that are not this project's own text.
NOT_COUNTED = ['LICENSE', 'package-lock.json']
ENCODING = 'o200k_base'
# A Python that has `tiktoken`, when the one running this has not: the one this variable of the environment names.
# The repository itself depends on nothing and knows no path of any machine.
PYTHON = 'SAGENTS_SIZE_PYTHON'

try:
    import tiktoken
except ImportError:
    other = os.environ.get(PYTHON)
    if other and os.path.isfile(other) and os.path.abspath(other) != os.path.abspath(sys.executable) and not os.environ.get('SAGENTS_SIZE_AGAIN'):
        os.execve(other, [other, *sys.argv], {**os.environ, 'SAGENTS_SIZE_AGAIN': '1'})
    print('size: nothing was counted, because this Python has no `tiktoken`. Install it outside the repository, '
          'for example `python3 -m venv ~/.local/share/limits-venv && ~/.local/share/limits-venv/bin/pip install tiktoken`, '
          f'and name that Python in {PYTHON}: `{PYTHON}=~/.local/share/limits-venv/bin/python npm run size`.')
    sys.exit(0)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
staged = '--index' in sys.argv[1:]


def git(*arguments: str) -> bytes:
    return subprocess.run(['git', '-C', root, *arguments], check=True, capture_output=True).stdout


def read(path: str) -> bytes:
    if staged:
        return git('show', f':{path}')
    with open(os.path.join(root, path), 'rb') as file:
        return file.read()


encoding = tiktoken.get_encoding(ENCODING)
counts = {}
for path in git('ls-files', '-z').decode().split('\0'):
    if not path or path in NOT_COUNTED:
        continue
    try:
        counts[path] = len(encoding.encode(read(path).decode('utf-8'), disallowed_special=()))
    except (UnicodeDecodeError, FileNotFoundError):
        # Not text, or tracked and deleted in the working tree: neither is text to read.
        continue

missing = [path for path in CORE + [LIVE] if path not in counts]
if missing:
    print(f'size: {", ".join(missing)} of the list in scripts/size.py is not a tracked text file; the counts below lack it.')
core = sum(counts.get(path, 0) for path in CORE)
print(f'size, in {ENCODING} tokens, of {"the Git index" if staged else "the working tree"}:')
print(f'  core, {len(CORE)} files without model and disk: {core:,} (bounds: {", ".join(f"{bound:,}" for bound, _ in CORE_BANDS)})')
print(f'  {LIVE}: {counts.get(LIVE, 0):,}')
print(f'  all tracked text but {" and ".join(NOT_COUNTED)}: {sum(counts.values()):,}')
over = [(bound, line) for bound, line in CORE_BANDS if core > bound]
if over:
    bound, line = over[-1]
    print(f'size: {line} It is {core - bound:,} tokens above {bound:,}. This forbids nothing.')
