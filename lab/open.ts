// Process arguments can be read by other local users, so the key reaches the browser in a private file.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OPENERS: { [platform: string]: [string, string[]] } = { darwin: ['open', []], win32: ['cmd', ['/c', 'start', '""']] };
const escaped = (text: string) => text.replace(/[&<>"']/g, sign => `&#${sign.charCodeAt(0)};`);

export function openInBrowser(url: string, run: (command: string, args: string[]) => boolean | void | Promise<boolean> = (command, args) => new Promise<boolean>(done => {
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.once('exit', code => done(code === 0));
  child.once('error', error => { if (!('code' in error && ['ENOENT', 'EACCES', 'ENOEXEC'].includes(String(error.code)))) throw error; done(false); });
})) {
  const dir = mkdtempSync(join(tmpdir(), 'sagents-lab-')), file = join(dir, 'open.html');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${escaped(url)}"><title>sagents lab</title><a href="${escaped(url)}">Open the lab</a>\n`, { mode: 0o600, flag: 'wx' });
  const [command, args] = OPENERS[process.platform] ?? ['xdg-open', []];
  let removed = false;
  const remove = () => { if (!removed) { removed = true; rmSync(dir, { recursive: true, force: true }); } };
  let handed: Promise<boolean>;
  try { handed = Promise.resolve(run(command, [...args, process.platform === 'win32' ? file : pathToFileURL(file).href])).then(started => started !== false); } catch (error) {
    if (!(error instanceof Error && 'code' in error && ['ENOENT', 'EACCES', 'ENOEXEC'].includes(String(error.code)))) { remove(); throw error; }
    handed = Promise.resolve(false);
  }
  return { file, remove, handed };
}
