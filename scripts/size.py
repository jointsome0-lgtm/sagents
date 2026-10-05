#!/usr/bin/env python3
"""How large the project is in tokens, so that the core stays small enough to read whole.

    npm run size            the working tree's text of the files Git tracks
    npm run size -- --index what is staged in the Git index

It prints three counts: the core, `src/live.ts`, and all tracked text. The core has a ceiling. Over it this prints a
warning and still ends well: the ceiling is a reason to look, not a ban. It never estimates: without `tiktoken` it
says how to get it, counts nothing, and ends well too.
"""
import os
import subprocess
import sys

# The core of the live mode: the rules, with no model and no disk in them.
CORE = ['src/world.ts', 'src/journal.ts', 'src/laws.ts', 'src/sleep.ts', 'src/weather.ts', 'src/memory.ts', 'src/reading.ts']
# The most tokens the core may hold before a warning. Provisional: the owner has not settled the number yet.
CORE_CEILING = 30_000
LIVE = 'src/live.ts'
# Tracked files that are not this project's own text.
NOT_COUNTED = ['LICENSE', 'package-lock.json']
ENCODING = 'o200k_base'
# A Python that has `tiktoken`, when the one running this has not: the one `SAGENTS_SIZE_PYTHON` names, then a venv
# kept outside the repository. The repository itself depends on nothing.
PYTHONS = [os.environ.get('SAGENTS_SIZE_PYTHON'), os.path.expanduser('~/.local/share/limits-venv/bin/python')]

try:
    import tiktoken
except ImportError:
    other = next((path for path in PYTHONS if path and os.path.isfile(path) and os.path.abspath(path) != os.path.abspath(sys.executable)), None)
    if other and not os.environ.get('SAGENTS_SIZE_AGAIN'):
        os.execve(other, [other, *sys.argv], {**os.environ, 'SAGENTS_SIZE_AGAIN': '1'})
    print('size: nothing was counted, because this Python has no `tiktoken`. Install it outside the repository, '
          'for example `python3 -m venv ~/.local/share/limits-venv && ~/.local/share/limits-venv/bin/pip install tiktoken`, '
          'or name a Python that has it in SAGENTS_SIZE_PYTHON.')
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
print(f'  core, {len(CORE)} files without model and disk: {core:,} of {CORE_CEILING:,} (a provisional ceiling)')
print(f'  {LIVE}: {counts.get(LIVE, 0):,}')
print(f'  all tracked text but {" and ".join(NOT_COUNTED)}: {sum(counts.values()):,}')
if core > CORE_CEILING:
    print(f'size: WARNING: the core is {core - CORE_CEILING:,} tokens over its ceiling. This forbids nothing: say in the change why the core grew, or move something out of it.')
