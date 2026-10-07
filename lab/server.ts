// The lab in a browser: an HTTP server over the data module, and the page beside this file.
//   const lab = await startLab({ dirs, port });   // -> { url, port, stop }
// The server listens on 127.0.0.1 alone and has no option for another address. The URL holds a token made at start;
// every other path, and every method but GET, is answered 404. With no `port` (or 0) the system picks one.
// What leaves this process: the five files of the page, and what the data module gives (the lines of events files,
// the counted fields of usage rows, the first line of `about.txt`, of a world file the ids and names of characters
// and places, the chapters of `story/` without their `carry`, a transcript's text). Nothing is written, and no text
// of a file is logged.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { openLab } from './data.ts';

const HOST = '127.0.0.1', POLL = 400, BATCH = 500, PIECE = 2000;
// The whole of what is served as a file: these five, beside this one. Each is read when asked for, so that an edit
// of the page shows at the next reload.
const ASSETS: { [name: string]: [string, string] } = { '': ['page.html', 'text/html; charset=utf-8'], 'app.js': ['app.js', 'text/javascript; charset=utf-8'], 'core.js': ['core.js', 'text/javascript; charset=utf-8'],
  'strings.js': ['strings.js', 'text/javascript; charset=utf-8'], 'app.css': ['app.css', 'text/css; charset=utf-8'] };
const asset = (file: string) => readFileSync(new URL(file, import.meta.url));
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
// The page loads its own script and style sheet from this server and nothing from anywhere else.
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// What a failure may say of itself in the log: its code or the name of its kind.
const codeOf = (error: unknown) => error instanceof Error ? 'code' in error && typeof error.code === 'string' ? error.code : error.name : 'error';

// `dirs` are the lab's roots. `log` is given one short line when something fails (a code, never a text of a file).
// The promise is refused when a root is no directory (`LabError`) or the port cannot be listened on.
export async function startLab({ dirs, port = 0, log = () => {} }: { dirs: string | string[]; port?: number; log?: (line: string) => void }) {
  const lab = openLab(dirs);
  for (const [file] of Object.values(ASSETS)) asset(file);
  const token = randomBytes(16).toString('hex'), streams = new Set<ServerResponse>();
  // One open feed: the messages of a followed stretch as server-sent events, looked for again every POLL ms. A broken
  // connection goes on from the byte the browser names in `Last-Event-ID`.
  const stream = (request: IncomingMessage, response: ServerResponse, id: string, wanted: string | null) => {
    response.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown, mark?: number) => response.write(`${mark === undefined ? '' : `id: ${mark}\n`}event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    const resumed = /^(\d+)$/.exec(String(request.headers['last-event-id'] ?? ''));
    const reader = lab.follow(id, wanted, resumed ? Number(resumed[1]) : 0);
    let busy = false;
    const step = () => {
      if (busy || response.destroyed) return;
      busy = true;
      try {
        for (let more = true, sent = false; more && !response.writableNeedDrain;) {
          const got = reader.poll(BATCH);
          more = got.more;
          for (const message of got.messages) {
            sent = true;
            // The lines are JSON already: they go out as they are in the file.
            if (message.type === 'events') send('events', `[${message.lines.join(',')}]`, message.at);
            else if (message.type === 'world') send('world', message.names);
            else if (message.type === 'stretch') send('stretch', { name: message.name, resumed: message.resumed });
            else if (message.type === 'usage') send('usage', { reset: message.reset, rows: message.rows, own: message.own });
            else send(message.type, {});
          }
          if (!more && !sent) response.write(': \n\n');
        }
      } catch (error) { log(`stream: ${codeOf(error)}`); }
      finally { busy = false; }
    };
    const timer = setInterval(step, POLL);
    response.on('drain', step);
    streams.add(response);
    response.on('close', () => { clearInterval(timer); streams.delete(response); });
    step();
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${HOST}`), prefix = `/${token}/`, asked = (key: string) => url.searchParams.get(key) ?? '';
    const name = request.method === 'GET' && url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : null;
    if (name !== null && Object.hasOwn(ASSETS, name)) {
      const [file, type] = ASSETS[name], body = asset(file);
      response.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Content-Security-Policy': POLICY, 'Content-Length': body.length });
      response.end(body);
    } else if (name === 'list') {
      let body;
      try { body = Buffer.from(JSON.stringify(lab.list())); } catch (error) { log(`list: ${codeOf(error)}`); body = Buffer.from('{"experiments":[]}'); }
      response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
      response.end(body);
    } else if (name === 'stretch' || name === 'story' || name === 'text') {
      // A piece of one stretch (`x`, `s`, and `from`, a byte that an earlier answer gave as `at`), the chapters of an
      // experiment's story (`x`), or a piece of one of its transcripts (`x`, `n`, `from`). 404 when there is none.
      let body = null;
      try {
        const from = /^\d+$/.test(asked('from')) ? Number(asked('from')) : 0;
        if (name === 'story') { const story = lab.story(asked('x')); if (story) body = JSON.stringify(story); }
        else if (name === 'text') { const piece = lab.text(asked('x'), asked('n'), from); if (piece) body = JSON.stringify(piece); }
        else {
          const piece = lab.part(asked('x'), asked('s'), from, PIECE);
          if (piece) body = `{"name":${JSON.stringify(piece.name)},"from":${piece.from},"at":${piece.at},"more":${piece.more},"usage":${JSON.stringify(piece.usage)},"events":[${piece.lines.join(',')}]}`;
        }
      } catch (error) { log(`${name}: ${codeOf(error)}`); }
      const bytes = Buffer.from(body ?? '{}');
      response.writeHead(body === null ? 404 : 200, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
      response.end(bytes);
    } else if (name === 'stream') stream(request, response, asked('x'), url.searchParams.get('s'));
    else { response.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); response.end('not found\n'); }
  });
  await new Promise<void>((done, failed) => { server.once('error', failed); server.listen(port, HOST, () => { server.off('error', failed); done(); }); });
  const listening = (server.address() as AddressInfo).port;
  const stop = () => new Promise<void>(done => { for (const response of streams) response.destroy(); server.close(() => done()); server.closeAllConnections(); });
  return { url: `http://${HOST}:${listening}/${token}/`, port: listening, stop };
}
