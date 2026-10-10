// A convention check, not a parser: a pointer `name` in `path` passes when a line of that file begins a top-level
// declaration of the name. A member of an object, a second name of one grouped `const` and a destructured name are
// not seen, so prose points at their owner; a line of a multi-line string that looks like a declaration would pass.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['README.md', ...readdirSync(resolve(root, 'docs')).filter(name => name.endsWith('.md')).sort().map(name => `docs/${name}`)];
const declaration = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/;

function declarationsOf(file) {
  const path = resolve(root, file), inside = relative(root, path);
  if (inside === '..' || inside.startsWith(`..${sep}`)) return null;
  try {
    return new Set(readFileSync(path, 'utf8').split('\n').map(line => declaration.exec(line)?.[1]).filter(Boolean));
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error;
    return null;
  }
}

const sources = new Map();
let checked = 0;
const pointer = /((?:`[A-Za-z_$][\w$]*`\s*(?:(?:,\s*(?:and\s+)?|and\s+)`[A-Za-z_$][\w$]*`\s*)*))in\s+`([^`\n]+)`/g;
for (const doc of docs) {
  const text = readFileSync(resolve(root, doc), 'utf8');
  for (const match of text.matchAll(pointer)) {
    const file = match[2], line = text.slice(0, match.index).split('\n').length;
    if (!sources.has(file)) sources.set(file, declarationsOf(file));
    const declarations = sources.get(file);
    for (const name of [...match[1].matchAll(/`([^`]+)`/g)].map(part => part[1])) {
      checked += 1;
      if (declarations?.has(name)) continue;
      console.error(`${doc}:${line}: \`${name}\` in \`${file}\`: ${declarations === null ? 'file does not exist' : 'no top-level declaration of this name'}`);
      process.exitCode = 1;
    }
  }
}
console.log(`${checked} pointers checked.`);
