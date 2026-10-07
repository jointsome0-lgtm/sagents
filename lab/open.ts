// Opening the lab's address in the default browser. The address holds the lab's token, and the arguments of a
// process can be read by other local users: so the browser is handed a file that only this user can read and that
// leads to the address, and never the address itself. `remove` takes the file away again.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The system's own command for opening a file with whatever is set for it.
const OPENERS: { [platform: string]: [string, string[]] } = { darwin: ['open', []], win32: ['cmd', ['/c', 'start', '""']] };
const escaped = (text: string) => text.replace(/[&<>"']/g, sign => `&#${sign.charCodeAt(0)};`);

// `run` starts the command and is given its name and arguments: the system's by default, a test gives its own.
// Nothing here fails when there is no browser to open or no command to open one: the address was printed.
export function openInBrowser(url: string, run: (command: string, args: string[]) => void = (command, args) => {
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  // A system without the command has no browser to open: nothing is lost, the address is on the screen.
  child.on('error', () => {});
  child.unref();
}) {
  // A directory of its own that only this user can enter, and in it the file that only this user can read.
  const dir = mkdtempSync(join(tmpdir(), 'sagents-lab-')), file = join(dir, 'open.html');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${escaped(url)}"><title>sagents lab</title><a href="${escaped(url)}">Open the lab</a>\n`, { mode: 0o600, flag: 'wx' });
  const [command, args] = OPENERS[process.platform] ?? ['xdg-open', []];
  let removed = false;
  const remove = () => { if (!removed) { removed = true; rmSync(dir, { recursive: true, force: true }); } };
  try { run(command, [...args, process.platform === 'win32' ? file : pathToFileURL(file).href]); } catch (error) {
    // The command could not be started at all: the same as no browser.
    if (!(error instanceof Error && 'code' in error)) { remove(); throw error; }
  }
  return { file, remove };
}
