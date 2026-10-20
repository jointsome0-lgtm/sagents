// Builds pack/, the folder that goes to npm. Node strips no types under node_modules, so the package holds
// JavaScript: what the command line imports, with the types erased and nothing else changed. The folder keeps the
// checkout's layout, because the code finds its lab pages and its environments beside itself. The package is built
// from the commit that is checked out and not from the working files: the commit's files are written out of git's
// store into a folder of their own, and the compiler and the copies read that folder. So a change that is not
// committed, a file that git does not track and a link cannot reach the package, whatever git's status says.
//   npm run pack   (`npm run pack && npm publish ./pack` publishes, which is the owner's to run)
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}pack/`;
// Named without its last slash, so that a symbolic link of that name is removed and not what it points to.
const clear = () => rmSync(`${root}pack`, { recursive: true, force: true });
// npm itself is asked at the end what it would publish, through the path that `npm run` gives its scripts.
const npm = process.env.npm_execpath ?? '';
let tree, manifest = false;
try {
  clear();
  if (!/npm-cli\.js$/.test(npm)) throw new Error('run this as `npm run pack`: at its end npm is asked what it would publish');
  // npm runs a script in the folder of its package.json, and this script builds and clears the checkout that it
  // lies in itself. Where the two are not one folder, the script was reached through a link or started in another
  // folder, and the pack/ that the next command there would publish is not the one that this build makes.
  if (relative(realpathSync('.'), realpathSync(root))) throw new Error('scripts/pack.mjs is not run in its own checkout, it was reached through a link or started in another folder: a pack/ in the folder of the command is not of this build, do not publish it');
  // A temporary directory that is named from the working directory would be another folder for each command that
  // is run elsewhere, and so would the folder that Node is told to keep its compiled code in: npm, run in pack/,
  // would write into the package. Both are named from the root of the file system here, for this script and for
  // the commands that it runs.
  for (const name of ['TMPDIR', 'TMP', 'TEMP', 'NODE_COMPILE_CACHE']) if (process.env[name]) process.env[name] = resolve(process.env[name]);
  // Git is asked about this checkout alone: the variables that would point it at another repository are left out,
  // as git's own list names them and in whatever case of letters, which Windows does not tell apart, and no
  // replacement of an object is followed.
  const elsewhere = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split(/\r?\n/);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !elsewhere.includes(name.toUpperCase())));
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-C', root, ...args], { env, maxBuffer: Infinity });
  // The script that runs is the one working file that the build cannot take from the commit, so it must be the
  // commit's own. Line ends are passed over: git may have changed them on the way out.
  const lines = bytes => bytes.toString().replaceAll('\r\n', '\n');
  if (lines(readFileSync(fileURLToPath(import.meta.url))) !== lines(git('cat-file', 'blob', 'HEAD:./scripts/pack.mjs'))) throw new Error('scripts/pack.mjs differs from the commit that is checked out: commit it or put it back first');
  // What the commit holds: for each path its kind and the name that git gives its content. Git keeps a path as
  // bytes, and one that is not UTF-8 would be read here as another name, two such as one: that ends the build.
  const listing = git('ls-tree', '-r', '-z', 'HEAD');
  if (!Buffer.from(listing.toString()).equals(listing)) throw new Error('a path of the commit that is checked out is not written in UTF-8');
  const commit = new Map(listing.toString().split('\0').filter(Boolean)
    .map(line => [line.slice(line.indexOf('\t') + 1), line.split(/[ \t]/, 3)]));
  // Names are compared as the file systems of macOS and Windows take them, which tell neither the case of letters
  // nor the two ways of writing an accented one apart: two such names, of files or of the folders above them,
  // would be one there. The way goes through capitals, since a few letters are alike only in that form.
  const fold = name => name.normalize('NFC').toUpperCase().toLowerCase();
  const names = new Set([...commit.keys()].flatMap(file => file.split('/').map((part, at, parts) => parts.slice(0, at + 1).join('/'))));
  if (new Set([...names].map(fold)).size !== names.size) throw new Error('two paths of the commit that is checked out differ only in the case or the form of their letters');
  // How many sources of the commit the compiler would write to one script: helper.ts beside helper.js, or
  // helper.tsx beside helper.jsx, are two. And which of those scripts have a source that the commit marks as a
  // file to be run.
  const stem = name => fold(name).replace(/[jt]sx?$/, '');
  const rivals = new Map(), run = new Set();
  for (const [file, [mode]] of commit) if (/\.[cm]?[jt]sx?$/.test(fold(file))) {
    rivals.set(stem(file), (rivals.get(stem(file)) ?? 0) + 1);
    if (mode === '100755') run.add(stem(file));
  }
  const regular = file => {
    if (!commit.get(file)?.[0].startsWith('100')) throw new Error(`${file} is not a regular file of the commit that is checked out`);
    return file;
  };
  tree = `${mkdtempSync(join(tmpdir(), 'sagents-pack-'))}/`;
  for (const [file, [mode, , id]] of commit) {
    // A link has no content of its own and is not written. One that stands for a file or a folder of the package
    // would leave the package without it, which ends the build.
    if (/^(docs|environments|examples|lab|src)(\/|$)/.test(fold(file))) regular(file);
    if (!mode.startsWith('100')) continue;
    mkdirSync(dirname(`${tree}${file}`), { recursive: true });
    writeFileSync(`${tree}${file}`, git('cat-file', 'blob', id), { mode: mode === '100755' ? 0o755 : 0o644 });
  }
  // The compiler and the types of Node are the ones installed in the checkout; all else that it reads is the commit's.
  execFileSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '-p', `${tree}tsconfig.pack.json`, '--outDir', `${root}pack`, '--typeRoots', `${root}node_modules/@types`], { cwd: tree, stdio: 'inherit' });
  // Every file of pack/, by its path from there.
  const files = () => readdirSync(out, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => relative(out, join(entry.parentPath, entry.name)).split(sep).join('/'));
  // Its scripts right after the compiler ran are what the compiler wrote, in whatever folder an import led it.
  // The compiler marks none as a file to be run: one whose source the commit marks so is marked here, and the
  // command itself in any case.
  const compiled = files().filter(name => /\.[cm]?jsx?$/.test(name));
  const wrote = new Set(compiled.map(fold));
  for (const name of compiled) if (run.has(stem(name))) chmodSync(`${out}${name}`, 0o755);
  chmodSync(`${out}src/cli.js`, 0o755);
  // An ignore file of git or of npm is about the checkout and stays there: npm publishes none, and it obeys one in
  // whatever folder of the package it lies.
  const copied = [...commit.keys()].filter(file => !/(^|\/)\.(git|npm)ignore$/.test(file)
    && (/^(docs|environments|examples)\//.test(file) || /^(lab|src)\//.test(file) && !/\.[cm]?tsx?$/.test(file)));
  let copies = 0;
  for (const file of [...copied, 'README.md', 'LICENSE'].map(regular)) {
    // A script that the compiler wrote stays as the compiler wrote it, with the paths of its imports rewritten: the
    // lab's browser script that the lab's server code imports is one, and a copy of the source would put the paths
    // back. Beside another source of its name it would stand for that source too, which ends the build.
    if (wrote.has(fold(file))) {
      if (rivals.get(stem(file)) > 1) throw new Error(`${file} and another source of its name would be one script of the package`);
      continue;
    }
    mkdirSync(dirname(`${out}${file}`), { recursive: true });
    copyFileSync(`${tree}${file}`, `${out}${file}`);
    copies += 1;
  }
  // A name of a TypeScript file that is still there would fail only when its line runs. The compiler rewrites the
  // paths of the imports that it sees; a path that is put together when the line runs it cannot see, and the module
  // behind it is not compiled either. So the ending of such a name right before a quote, or before the question
  // mark or the hash sign that may follow a name in an address, ends the build, in any script of the package and in
  // any file at all of the two folders of its code, where a script may go by another name. This is a pattern and
  // not a parser: it ends the build wherever those letters stand, in a comment or a message too.
  const held = files(), code = held.filter(name => /^(lab|src)\/|\.[cm]?jsx?$/.test(name)).map(name => [name, readFileSync(`${out}${name}`, 'utf8')]);
  const left = code.filter(([, text]) => /\.[cm]?tsx?['"`?#]/.test(text)).map(([name]) => name);
  if (left.length) throw new Error(`a name that ends in .ts, .tsx, .mts or .cts stands before a quote, a question mark or a hash sign in ${left.join(', ')}: the package holds no TypeScript`);
  // A script that the same files name by its path from them must be in the package. The compiler says nothing of a
  // module that a JavaScript source imports and the commit does not hold, and a copied script is taken as it is:
  // either would name a script that is not there. A pattern again: it reads every quoted path that begins with a
  // dot and ends as a script does, in a comment or a message too, and passes over a path with a blank in it and one
  // that is put together when its line runs. A path is read as Node reads an address, a sign written as a percent
  // sign and two digits taken for the sign, and compared as it is spelled, capitals and the form of accented
  // letters included.
  const spelled = path => { try { return decodeURIComponent(path); } catch { return path; } };
  const lost = code.flatMap(([name, text]) => [...text.matchAll(/(['"`])(\.{1,2}\/(?:(?!\1)\S)*?\.[cm]?jsx?)(?:[?#](?:(?!\1)\S)*)?\1/g)]
    .filter(([, , path]) => !path.includes('${') && !held.includes(join(dirname(name), spelled(path)).split(sep).join('/'))).map(([, , path]) => `${path} in ${name}`));
  if (lost.length) throw new Error(`the package does not hold a script that it names: ${lost.slice(0, 3).join(', ')}${lost.length > 3 ? ` and ${lost.length - 3} more` : ''}`);
  // The README goes into the package as it is, and until the first publication it says the opposite.
  const early = readFileSync(`${out}README.md`, 'utf8').includes('it is not on npm');
  const head = git('rev-parse', '--short', 'HEAD').toString().trim();
  const apart = git('status', '--porcelain', '--', '.').toString().split('\n').filter(Boolean).length;
  // The manifest is written after all that the build itself can get wrong. The project has no dependencies at run
  // time and the package's manifest names none, so a commit whose manifest takes one ends the build; a list of
  // them that is empty is passed over.
  const from = JSON.parse(readFileSync(`${tree}package.json`, 'utf8'));
  const needs = Object.keys(from).filter(key => /^(optional|peer|bundled?)?dependencies$/i.test(key) && Object.keys(Object(from[key])).length);
  if (needs.length) throw new Error(`package.json names ${needs.join(', ')}: the package is made without dependencies`);
  const { name, version, description, type, license, repository, engines } = from;
  writeFileSync(`${out}package.json`, `${JSON.stringify({ name, version, description, type, license, repository, engines, bin: { sagents: 'src/cli.js' } }, null, 2)}\n`);
  manifest = true;
  // npm has rules of its own about what it takes from a folder, names that it always passes over among them. So
  // npm itself is asked, off the network and writing no archive, and what it would publish must be every file that
  // is here. It is asked in pack/, where another setting of that kind could make it write: a file that is there
  // after the question and was not before it is in no commit, and ends the build.
  const built = files();
  const listed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--offline', '--ignore-scripts', '--no-update-notifier'], { cwd: out, encoding: 'utf8' }))[0].files.map(file => file.path);
  const unlisted = built.filter(name => !listed.includes(name)), added = files().filter(name => !built.includes(name));
  if (unlisted.length) throw new Error(`npm would leave out of the package: ${unlisted.join(', ')}`);
  if (added.length) throw new Error(`npm wrote into pack/ while it was asked: ${added.slice(0, 3).join(', ')}${added.length > 3 ? ` and ${added.length - 3} more` : ''}`);
  console.log(`pack/ holds ${name} ${version} as commit ${head} has it: ${compiled.length} scripts compiled, ${copies} files copied`);
  if (apart) console.log(`working paths that differ from that commit or are not in it, and that the package does not take: ${apart}`);
  if (early) console.log('README.md says that sagents is not on npm: rewrite that paragraph before a publication');
} catch (error) {
  // A folder that a failed build left behind could be published by a later command: the manifest that this build
  // wrote goes first, then the folder.
  try { if (manifest) rmSync(`${out}package.json`); clear(); } catch { console.error('pack/ could not be removed: do not publish it'); }
  throw error;
} finally {
  // The folder of the commit's files; one that cannot be removed holds nothing but them.
  try { if (tree) rmSync(tree, { recursive: true, force: true }); } catch { }
}
