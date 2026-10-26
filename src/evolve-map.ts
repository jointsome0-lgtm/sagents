import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { EvolveError, readTask } from './evolve.ts';
import type { Candidate, Sent, Task, UsageRow } from './evolve.ts';
import { isObject } from './reading.ts';

// The map of an evolve run as one HTML page, for reading a search after it, or during it: the run directory is only
// read. The page holds the model's files and the evaluator's feedback, so it loads nothing and runs no script.

export type EvolveRun = { path: string; task: Task | null; candidates: Candidate[]; usage: (Sent | UsageRow)[]; text: (sha: string) => string | null };

const failed = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
const unreadable = (error: unknown) => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return new EvolveError('The run directory cannot be read.');
  return error;
};

export function readEvolveRun(dir: string): EvolveRun {
  const path = resolve(dir);
  const read = (name: string): string | null => {
    try { return readFileSync(join(path, name), 'utf8'); } catch (error) { if (failed(error, 'ENOENT')) return null; throw unreadable(error); }
  };
  // A line that a crash cut, or that the run is still writing, is skipped.
  const rows = (text: string | null) => (text ?? '').split('\n').flatMap(line => {
    try { return [JSON.parse(line) as unknown]; } catch (error) { if (error instanceof SyntaxError) return []; throw error; }
  });
  const found = read('candidates.jsonl');
  if (found === null) throw new EvolveError('The directory has no candidates.jsonl: it is not the directory of an evolve run.');
  let task: Task | null = null;
  try { task = readTask(JSON.parse(read('task.json') ?? 'null')); } catch (error) { if (!(error instanceof EvolveError || error instanceof SyntaxError)) throw error; }
  return { path, task, candidates: rows(found).filter(row => isObject(row) && Number.isSafeInteger(row.id)) as Candidate[],
    usage: rows(read('usage.jsonl')).filter(row => isObject(row) && Number.isSafeInteger(row.n)) as (Sent | UsageRow)[],
    // A file that a kill cut short no longer matches its name, and is not shown as the file.
    text: sha => {
      if (!/^[0-9a-f]{64}$/.test(sha)) return null;
      let data: Buffer;
      try { data = readFileSync(join(path, 'files', `${sha}.txt`)); } catch (error) { if (failed(error, 'ENOENT')) return null; throw unreadable(error); }
      return createHash('sha256').update(data).digest('hex') === sha ? data.toString('utf8') : null;
    } };
}

const esc = (text: string) => text.replace(/[&<>"']/g, sign => `&#${sign.charCodeAt(0)};`);
const fmt = (value: number) => Math.abs(value) >= 1e4 ? Math.round(value).toLocaleString('en-US') : String(Number(value.toPrecision(4)));
const whole = (value: number) => value.toLocaleString('en-US');
const short = (text: string, signs: number) => [...text].length <= signs ? text : `${[...text].slice(0, signs - 1).join('')}…`;
const nice = (span: number) => {
  const power = 10 ** Math.floor(Math.log10(span));
  return power * ([1, 2, 5, 10].find(step => step * power >= span) ?? 10);
};

// The change of a file against its parent, as diff lines. The common head and tail are cut first, so that the few
// edits of a usual step stay cheap; a middle that would take more than EDITS edits is shown removed and added whole.
type Line = [' ' | '-' | '+', string];
const EDITS = 600, CONTEXT = 3, SHOWN = 400;
function changeOf(before: string, after: string): Line[] {
  const a = before.split('\n'), b = after.split('\n');
  let head = 0, tail = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  const middle = editsOf(x, y) ?? [...x.map((line): Line => ['-', line]), ...y.map((line): Line => ['+', line])];
  return [...a.slice(0, head).map((line): Line => [' ', line]), ...middle, ...a.slice(a.length - tail).map((line): Line => [' ', line])];
}
// Myers' shortest edit script, after "An O(ND) difference algorithm and its variations" (1986).
function editsOf(a: string[], b: string[]): Line[] | null {
  const n = a.length, m = b.length, most = Math.min(n + m, EDITS), off = most + 1, v = new Int32Array(2 * most + 3), trace: Int32Array[] = [];
  for (let d = 0; d <= most; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1, y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[off + k] = x;
      if (x >= n && y >= m) {
        const lines: Line[] = [];
        for (let e = d; e >= 0; e -= 1) {
          const before = trace[e], at = x - y, from = at === -e || (at !== e && before[off + at - 1] < before[off + at + 1]) ? at + 1 : at - 1;
          const px = before[off + from], py = px - from;
          while (x > px && y > py) { x -= 1; y -= 1; lines.push([' ', a[x]]); }
          if (e > 0) { if (x === px) { y -= 1; lines.push(['+', b[y]]); } else { x -= 1; lines.push(['-', a[x]]); } }
        }
        return lines.reverse();
      }
    }
  }
  return null;
}
function shownChange(lines: Line[]): string {
  const near = new Uint8Array(lines.length), out: string[] = [];
  lines.forEach(([sign], i) => { if (sign !== ' ') near.fill(1, Math.max(0, i - CONTEXT), Math.min(lines.length, i + CONTEXT + 1)); });
  let skipped = 0, shown = 0;
  const skip = () => { if (skipped) out.push(`<span class="skip">… ${whole(skipped)} unchanged ${skipped === 1 ? 'line' : 'lines'} …</span>`); skipped = 0; };
  for (let i = 0; i < lines.length; i += 1) {
    if (!near[i]) { skipped += 1; continue; }
    skip();
    if (shown++ === SHOWN) { out.push('<span class="skip">… the rest of the change is not shown here …</span>'); return out.join(''); }
    const [sign, text] = lines[i];
    out.push(`<span class="${sign === '+' ? 'add' : sign === '-' ? 'del' : 'same'}">${sign} ${esc(text)}</span>`);
  }
  skip();
  return out.join('');
}

const KIND: { [kind: string]: string } = { seed: 'seed file', idea: 'first file of a family', try: 'try', submit: 'submitted' };
const W = 1100, LEFT = 70, RIGHT = 80, PLOT = W - LEFT - RIGHT, LEVELS = 7;

export function evolveMap(run: EvolveRun): string {
  const { task, candidates } = run, byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const ends = run.usage.filter((row): row is UsageRow => 'ms' in row), endOf = new Map(ends.map(row => [row.n, row]));
  const requests = [...new Set(run.usage.map(row => row.n))].sort((a, b) => a - b);
  const ideations = new Set([...run.usage.filter(row => row.kind === 'ideate').map(row => row.n), ...candidates.filter(c => c.kind === 'idea' && c.call !== null).map(c => c.call!)]);
  const produced = new Set(candidates.map(candidate => candidate.call));
  const valid = candidates.filter(candidate => candidate.valid && Number.isFinite(candidate.score));
  const lowest = (list: Candidate[]) => list.reduce<Candidate | null>((found, c) => !found || c.score! < found.score! ? c : found, null);
  // The families in the order they were begun, those of one ideation in the model's order, whichever was judged first.
  const begun = (family: string) => Math.min(...candidates.filter(c => c.family === family).map(c => c.call ?? 0));
  const families = [...new Set(candidates.map(candidate => candidate.family))].sort((a, b) => begun(a) - begun(b) || a.localeCompare(b, 'en', { numeric: true }));
  const firstOf = (family: string) => candidates.find(c => c.family === family && c.name !== undefined) ?? null;
  const bests = new Map(families.map(family => [family, lowest(valid.filter(c => c.family === family))]));
  const elites = new Map<string, Candidate>();
  for (const c of valid) if (c.cell !== null && (!elites.has(c.cell) || c.score! < elites.get(c.cell)!.score!)) elites.set(c.cell, c);
  const eliteIds = new Set([...elites.values()].map(c => c.id)), kept = new Set([...[...bests.values()].filter(c => c !== null).map(c => c!.id), ...eliteIds]);
  const best = lowest(valid), sum = (field: 'input' | 'cached' | 'output' | 'reasoning') => ends.reduce((total, row) => total + (row[field] ?? 0), 0);
  // The tries and the submit of one step showed the same files, so a file shown is counted once a step.
  const stepOf = (c: Candidate) => Number.isSafeInteger(c.step) ? c.step! : null, othersOf = (c: Candidate) => Array.isArray(c.others) ? c.others.filter(id => Number.isSafeInteger(id)) : [];
  const shownIn = new Map<number, Set<string>>();
  for (const c of candidates) for (const id of othersOf(c)) shownIn.set(id, (shownIn.get(id) ?? new Set<string>()).add(stepOf(c) === null ? `#${c.id}` : `${stepOf(c)}`));

  // Every lane has the one score scale, so that lanes compare at a glance: lower and so better at the top, in tens
  // when the scores span a hundredfold.
  const scores = valid.map(c => c.score!);
  let lo = scores.length ? Math.min(...scores) : 0, hi = scores.length ? Math.max(...scores) : 1;
  if (lo === hi) { lo -= Math.abs(lo) / 10 || 1; hi += Math.abs(hi) / 10 || 1; }
  const tens = lo > 0 && hi / lo >= 100, f = (s: number) => tens ? Math.log10(s) : s;
  const yOf = (score: number, top: number, bottom: number) => top + (f(score) - f(lo)) / (f(hi) - f(lo)) * (bottom - top);
  const yTicks = tens ? Array.from({ length: Math.floor(Math.log10(hi)) - Math.ceil(Math.log10(lo)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(lo)) + i))
    : (() => { const step = nice((hi - lo) / 3); return Array.from({ length: Math.floor(hi / step) - Math.ceil(lo / step) + 1 }, (_, i) => (Math.ceil(lo / step) + i) * step); })();
  const last = Math.max(1, ...requests, ...candidates.map(c => c.call ?? 0)), xOf = (n: number) => LEFT + n / last * PLOT;
  const xStep = Math.max(1, nice(last / 8)), xTicks = Array.from({ length: Math.floor(last / xStep) + 1 }, (_, i) => i * xStep);

  // A lane for every family rather than a color for it: a run makes more families than colors can tell apart.
  const grids: string[] = [], parts: string[] = [], marks: string[] = [], edges: string[] = [], labels: string[] = [], at = new Map<number, [number, number]>();
  // The request numbers are above the lanes as well as below them, since a long run's lanes are taller than a screen.
  for (const tick of xTicks) parts.push(`<text class="tick" x="${xOf(tick)}" y="16" text-anchor="middle">${tick}</text>`);
  const strip = 34;
  parts.push(`<text class="head" x="${LEFT - 8}" y="${strip + 4}" text-anchor="end">Requests</text>`);
  for (const n of requests) {
    const end = endOf.get(n), x = xOf(n), what = ideations.has(n) ? 'ideation' : 'a step';
    const said = (words: string, mark: string) => marks.push(`<g><title>request ${n}, ${what}: ${words}</title>${mark}<circle class="hit" cx="${x}" cy="${strip}" r="8"/></g>`);
    if (end?.error && end.error !== 'cancelled') said(`failed, ${esc(end.error)}`, `<path class="fail" d="M${x - 4} ${strip - 4}l8 8m0-8l-8 8"/>`);
    else if (!end) said('no end was kept, so it was under way when the run was killed', `<circle class="open" cx="${x}" cy="${strip}" r="3.5"/>`);
    else if (end.error === 'cancelled' || !produced.has(n)) said(end.error === 'cancelled' ? 'cut short by the end of the run' : 'the answer gave nothing to use', `<path class="nothing" d="M${x} ${strip - 5}v10"/>`);
    else if (ideations.has(n)) {
      const begunHere = candidates.filter(c => c.call === n).length;
      said(`${begunHere} ${begunHere === 1 ? 'family' : 'families'} begun`, `<path class="idea" d="M${x} ${strip - 5}l5 5-5 5-5-5z"/>`);
    }
  }
  let y = strip + 16;
  parts.push(`<text class="head" x="${LEFT}" y="${y + 12}">Best valid score so far</text>`);
  const panel = { top: y + 22, bottom: y + 118 };
  if (valid.length) {
    const order = [...valid].sort((a, b) => (a.call ?? 0) - (b.call ?? 0) || a.id - b.id);
    let held: Candidate | null = null, path = '';
    for (const c of order) {
      if (held && c.score! >= held.score!) continue;
      const x = xOf(c.call ?? 0), yy = yOf(c.score!, panel.top, panel.bottom);
      path += held ? `H${x}V${yy}` : `M${x} ${yy}`;
      held = c;
      marks.push(`<a href="#c${c.id}"><title>#${c.id}, ${esc(c.family)}, request ${c.call ?? 0}: ${fmt(c.score!)}</title><circle class="ring" cx="${x}" cy="${yy}" r="6"/><circle class="dot" cx="${x}" cy="${yy}" r="4"/><circle class="hit" cx="${x}" cy="${yy}" r="12"/></a>`);
    }
    const yy = yOf(held!.score!, panel.top, panel.bottom);
    edges.push(`<path class="line" d="${path}H${xOf(last)}"/>`);
    labels.push(`<text class="value" x="${xOf(last) + 8}" y="${yy + 4}">${fmt(held!.score!)}</text>`);
  } else parts.push(`<text class="note" x="${LEFT + 8}" y="${panel.top + 40}">No valid file yet.</text>`);
  const axes: [number, number][] = valid.length ? [[panel.top, panel.bottom]] : [];
  y = panel.bottom + 16;
  const lanes = families.filter(family => bests.get(family)), none = families.filter(family => !bests.get(family));
  for (const lane of [...lanes.map(family => [family]), ...(none.length ? [none] : [])]) {
    const first = firstOf(lane[0]), mine = candidates.filter(c => lane.includes(c.family)), top = bests.get(lane[0]);
    const title = top ? `${lane[0]}${first?.name ? `, "${short(first.name, 50)}"` : ''}: ${mine.length} ${mine.length === 1 ? 'file' : 'files'}, best ${fmt(top.score!)} (#${top.id})`
      : `${lane.length === 1 ? 'A family' : `${lane.length} families`} with no valid file: ${lane.join(', ')}`;
    parts.push(`<text class="lane" x="${LEFT}" y="${y + 12}"><title>${esc(lane.map(family => { const words = firstOf(family); return `${family}${words?.name ? `: ${words.name}` : ''}${words?.idea ? `\n${words.idea}` : ''}`; }).join('\n\n'))}</title>${esc(title)}</text>`);
    const area = { top: y + 22, bottom: y + 72 }, band = top ? y + 92 : y + 30;
    if (top) axes.push([area.top, area.bottom]);
    parts.push(`${top ? `<path class="base" d="M${LEFT} ${area.bottom + 10}H${LEFT + PLOT}"/>` : ''}<text class="note" x="${LEFT - 8}" y="${band + 4}" text-anchor="end">not valid</text>`);
    for (const c of mine) at.set(c.id, [xOf(c.call ?? 0), c.valid ? yOf(c.score!, area.top, area.bottom) : band]);
    for (const c of mine) {
      const [x, yy] = at.get(c.id)!, from = c.parent === null ? undefined : at.get(c.parent);
      if (from) edges.push(`<path class="edge" d="M${from[0]} ${from[1]}L${x} ${yy}"/>`);
      const shape = (r: number, kind: string) => c.kind === 'seed' || c.kind === 'idea' ? `<rect class="${kind}" x="${x - r}" y="${yy - r}" width="${2 * r}" height="${2 * r}" rx="1"/>` : `<circle class="${kind}" cx="${x}" cy="${yy}" r="${r}"/>`;
      const said = `#${c.id}, ${KIND[c.kind] ?? c.kind}, ${c.family}${c.parent === null ? '' : ` from #${c.parent}`}, request ${c.call ?? 0}${stepOf(c) === null ? '' : `, step ${stepOf(c)}`}\n${c.valid ? `score ${fmt(c.score!)}, cell ${c.cell}` : 'not valid'}${c.same === null ? '' : `\nthe same file as #${c.same}`}`
        + `${othersOf(c).length ? `\nshown beside its parent: ${othersOf(c).map(id => `#${id}`).join(', ')}` : ''}`;
      marks.push(`<a href="#c${c.id}"><title>${esc(said)}</title>${shape(6.5, 'ring')}${shape(4.5, `${c.valid ? 'dot' : 'gone'}${c.kind === 'try' ? ' hollow' : ''}`)}<circle class="hit" cx="${x}" cy="${yy}" r="12"/></a>`);
      if (top && c.id === top.id) labels.push(`<text class="value" x="${x + 9}" y="${yy + 4}">${fmt(c.score!)}</text>`);
    }
    y = band + 18;
  }
  const bottom = y;
  // A lane is shorter than the panel above it, so a tick too near the one labelled before it keeps its line only.
  for (const [top, end] of axes) {
    let labelled = -Infinity;
    for (const tick of yTicks) {
      const yy = yOf(tick, top, end);
      grids.push(`<path class="grid" d="M${LEFT} ${yy}H${LEFT + PLOT}"/>`);
      if (yy - labelled < 18) continue;
      labelled = yy;
      parts.push(`<text class="tick" x="${LEFT - 8}" y="${yy + 4}" text-anchor="end">${fmt(tick)}</text>`);
    }
  }
  for (const tick of xTicks) {
    grids.push(`<path class="grid" d="M${xOf(tick)} ${panel.top}V${bottom}"/>`);
    parts.push(`<text class="tick" x="${xOf(tick)}" y="${bottom + 16}" text-anchor="middle">${tick}</text>`);
  }
  for (const n of ideations) if (produced.has(n)) grids.push(`<path class="ideation" d="M${xOf(n)} ${strip + 6}V${bottom}"/>`);
  parts.push(`<text class="tick" x="${LEFT + PLOT / 2}" y="${bottom + 34}" text-anchor="middle">request number</text>`);
  const search = `<svg class="chart" viewBox="0 0 ${W} ${bottom + 42}" role="img" aria-label="Every file evaluated, by request and score, a lane for each family">${grids.join('')}${parts.join('')}${edges.join('')}${marks.join('')}${labels.join('')}</svg>`;

  // Past two features the cells cannot be laid out flat, so they are only a table.
  const names = task ? Object.keys(task.cells) : Object.keys(valid[0]?.features ?? {});
  const binsOf = (i: number) => task ? Object.values(task.cells)[i].length + 1 : 1 + Math.max(0, ...[...elites.keys()].map(cell => Number(cell.split(',')[i])));
  const binName = (i: number, bin: number) => {
    if (!task) return `bin ${bin}`;
    const edges = Object.values(task.cells)[i];
    return bin === 0 ? `< ${fmt(edges[0])}` : bin === edges.length ? `≥ ${fmt(edges[edges.length - 1])}` : `${fmt(edges[bin - 1])}…${fmt(edges[bin])}`;
  };
  const eliteScores = [...elites.values()].map(c => c.score!), elo = Math.min(...eliteScores), ehi = Math.max(...eliteScores);
  const levelOf = (score: number) => ehi === elo ? LEVELS : 1 + Math.round((1 - (f(score) - f(elo)) / (f(ehi) - f(elo))) * (LEVELS - 1));
  const told = (cell: string, c: Candidate) => `cell ${cell}: #${c.id}, ${c.family}, score ${fmt(c.score!)}\n${Object.entries(c.features ?? {}).map(([name, value]) => `${name} ${fmt(value)}`).join(', ')}`;
  let grid = '';
  if (elites.size && (names.length === 1 || names.length === 2)) {
    const columns = binsOf(0), rows = names.length === 2 ? binsOf(1) : 1, cw = 58, ch = 36, left = 110, cells: string[] = [];
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const key = names.length === 2 ? `${column},${row}` : `${column}`, c = elites.get(key), x = left + column * cw, yy = 8 + (rows - 1 - row) * ch;
      if (!c) { cells.push(`<rect class="empty" x="${x + 1}" y="${yy + 1}" width="${cw - 2}" height="${ch - 2}" rx="3"/>`); continue; }
      const level = levelOf(c.score!), score = fmt(c.score!);
      cells.push(`<a href="#c${c.id}"><title>${esc(told(key, c))}</title><rect class="level${level}" x="${x + 1}" y="${yy + 1}" width="${cw - 2}" height="${ch - 2}" rx="3"/>`
        + `${score.length * 6.6 <= cw - 8 ? `<text class="in level${level}" x="${x + cw / 2}" y="${yy + 16}" text-anchor="middle">${score}</text>` : ''}<text class="in small level${level}" x="${x + cw / 2}" y="${yy + 29}" text-anchor="middle">${esc(short(c.family, 8))}</text></a>`);
    }
    for (let column = 0; column < columns; column += 1) cells.push(`<text class="tick" x="${left + column * cw + cw / 2}" y="${8 + rows * ch + 16}" text-anchor="middle">${esc(binName(0, column))}</text>`);
    if (names.length === 2) for (let row = 0; row < rows; row += 1) cells.push(`<text class="tick" x="${left - 8}" y="${8 + (rows - 1 - row) * ch + ch / 2 + 4}" text-anchor="end">${esc(binName(1, row))}</text>`);
    cells.push(`<text class="tick" x="${left + columns * cw / 2}" y="${8 + rows * ch + 36}" text-anchor="middle">${esc(names[0])}</text>`);
    if (names.length === 2) cells.push(`<text class="tick" x="14" y="${8 + rows * ch / 2}" text-anchor="middle" transform="rotate(-90 14 ${8 + rows * ch / 2})">${esc(names[1])}</text>`);
    grid = `<svg class="chart" viewBox="0 0 ${left + columns * cw + 10} ${8 + rows * ch + 44}" style="max-width:${left + columns * cw + 10}px" role="img" aria-label="The elite of every cell">${cells.join('')}</svg>`;
  }
  const cellRows = [...elites.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([cell, c]) => `<tr><td>${esc(cell)}</td><td>${esc(cell.split(',').map((bin, i) => `${names[i] ?? `feature ${i + 1}`} ${binName(i, Number(bin))}`).join(', '))}</td><td><a href="#c${c.id}">#${c.id}</a></td><td>${esc(c.family)}</td><td class="n">${fmt(c.score!)}</td></tr>`);
  const total = task ? Object.values(task.cells).reduce((product, edges) => product * (edges.length + 1), 1) : null;
  const cellTable = `<table><thead><tr><th>Cell</th><th>Bins</th><th>Elite</th><th>Family</th><th class="n">Score</th></tr></thead><tbody>${cellRows.join('')}</tbody></table>`;

  const used = (family: string | null) => ends.filter(row => row.family === family);
  const tokens = (rows: UsageRow[], field: 'input' | 'cached' | 'output' | 'reasoning') => whole(rows.reduce((t, row) => t + (row[field] ?? 0), 0));
  const familyRows = families.map(family => {
    const first = firstOf(family), mine = candidates.filter(c => c.family === family), top = bests.get(family), rows = used(family);
    return `<tr><td>${esc(family)}</td><td>${esc(first?.name ?? '')}</td><td>${esc(first?.idea ?? '')}</td><td class="n">${begun(family)}</td><td class="n">${mine.length}</td><td class="n">${mine.filter(c => c.valid).length}</td>`
      + `<td class="n">${top ? `${fmt(top.score!)} (<a href="#c${top.id}">#${top.id}</a>)` : ''}</td><td class="n">${[...elites.values()].filter(c => c.family === family).length}</td><td class="n">${rows.length}</td><td class="n">${tokens(rows, 'input')}</td><td class="n">${tokens(rows, 'output')}</td></tr>`;
  });
  const ideate = used(null);
  if (ideate.length) familyRows.push(`<tr><td colspan="8">Ideation</td><td class="n">${ideate.length}</td><td class="n">${tokens(ideate, 'input')}</td><td class="n">${tokens(ideate, 'output')}</td></tr>`);
  const errors = Object.entries(ends.reduce<{ [code: string]: number }>((count, row) => { if (row.error) count[row.error] = (count[row.error] ?? 0) + 1; return count; }, {}));
  const minutes = Math.round(ends.reduce((t, row) => t + row.ms, 0) / 60_000);

  const found = candidates.filter(c => c.discoveries?.length).map(c => `<li><a href="#c${c.id}">#${c.id}</a> <span class="muted">${esc(c.family)}, request ${c.call ?? 0}</span><ul>${c.discoveries.map(line => `<li>${esc(line)}</li>`).join('')}</ul></li>`);
  const files = candidates.map(c => {
    const text = run.text(c.sha), parent = c.parent === null ? null : byId.get(c.parent) ?? null, before = parent ? run.text(parent.sha) : null;
    let change = '';
    if (text !== null && before !== null) {
      const lines = changeOf(before, text), added = lines.filter(([sign]) => sign === '+').length, removed = lines.filter(([sign]) => sign === '-').length;
      change = added || removed ? `<p class="muted">Against #${parent!.id}: ${added} added, ${removed} removed</p><pre class="diff">${shownChange(lines)}</pre>` : `<p class="muted">The same text as #${parent!.id}.</p>`;
    }
    const all = text !== null && (!change || kept.has(c.id)) ? `<details${change ? '' : ' open'}><summary>The whole file</summary><pre>${esc(text)}</pre></details>` : '';
    const words = c.name !== undefined ? `<p><b>${esc(c.name)}</b>${c.idea ? `: ${esc(c.idea)}` : ''}</p>` : '';
    const beside = othersOf(c).map(id => { const other = byId.get(id); return `<a href="#c${id}">#${id}</a>${other ? ` (${esc(other.family)}, ${other.valid ? fmt(other.score!) : 'not valid'})` : ''}`; });
    const shown = shownIn.get(c.id)?.size ?? 0;
    const roles = [bests.get(c.family)?.id === c.id ? 'family best' : '', eliteIds.has(c.id) ? 'elite' : '', shown ? `shown in ${whole(shown)} ${shown === 1 ? 'step' : 'steps'}` : ''].filter(Boolean).join(', ');
    return `<details id="c${c.id}"><summary>#${c.id} ${esc(KIND[c.kind] ?? c.kind)}, ${esc(c.family)}${parent ? ` from <a href="#c${parent.id}">#${parent.id}</a>` : ''}: ${c.valid ? `score ${fmt(c.score!)}, cell ${esc(String(c.cell))}` : 'not valid'}`
      + `<span class="muted">, request ${c.call ?? 0}${stepOf(c) === null ? '' : `, step ${stepOf(c)}`}, ${whole(c.chars)} characters${c.same === null ? '' : `, the same file as #${c.same}`}${roles ? `, ${roles}` : ''}</span></summary>${words}`
      + `${beside.length ? `<p class="muted">Shown beside its parent: ${beside.join(', ')}</p>` : ''}`
      + `${c.feedback ? `<p class="muted">Feedback</p><pre>${esc(c.feedback)}</pre>` : ''}${c.discoveries?.length ? `<ul>${c.discoveries.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}`
      + `${text === null ? `<p class="muted">files/${esc(c.sha)}.txt is missing or was cut short by a kill.</p>` : ''}${change}${all}</details>`;
  });

  const legend = [['<rect class="dot" x="3" y="3" width="9" height="9" rx="1"/>', 'first file of a family'], ['<circle class="dot" cx="7.5" cy="7.5" r="4.5"/>', 'submitted'],
    ['<circle class="dot hollow" cx="7.5" cy="7.5" r="4.5"/>', 'try'], ['<circle class="gone" cx="7.5" cy="7.5" r="4.5"/>', 'not valid'], ['<path class="ideation" d="M7.5 0V15"/><path class="idea" d="M7.5 3l4.5 4.5-4.5 4.5-4.5-4.5z"/>', 'ideation'],
    ['<path class="fail" d="M3.5 3.5l8 8m0-8l-8 8"/>', 'failed request'], ['<path class="nothing" d="M7.5 2v11"/>', 'answer with nothing to use'], ['<path class="line" d="M0 7.5H15"/>', 'best so far']]
    .map(([swatch, words]) => `<span><svg viewBox="0 0 15 15" width="15" height="15" aria-hidden="true">${swatch}</svg>${words}</span>`).join('');
  const ramp = Array.from({ length: LEVELS }, (_, i) => `<svg viewBox="0 0 18 14" width="18" height="14" aria-hidden="true"><rect class="level${i + 1}" width="18" height="14" rx="2"/></svg>`).join('');
  const stat = (value: string, words: string) => `<div class="stat"><b>${value}</b><span>${words}</span></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>evolve: ${esc(basename(run.path))}</title><style>${STYLE}</style></head><body>
<h1>The search in ${esc(basename(run.path))}</h1><p class="muted">${esc(run.path)}</p>
<div class="stats">${stat(whole(requests.length), `requests, ${ideations.size} of them ideation`)}${stat(whole(candidates.length), `files evaluated, ${valid.length} valid`)}${stat(whole(families.length), 'families')}${stat(total === null ? whole(elites.size) : `${whole(elites.size)} of ${whole(total)}`, 'cells')}${stat(best ? fmt(best.score!) : 'none', best ? `best, <a href="#c${best.id}">#${best.id}</a>, ${esc(best.family)}` : 'best')}</div>
<p class="muted">Tokens: ${whole(sum('input'))} in, ${whole(sum('cached'))} of them cached, ${whole(sum('output'))} out, ${whole(sum('reasoning'))} of them reasoning; ${whole(minutes)} minutes in requests, added up over those that ran at once${errors.length ? `; failed: ${errors.map(([code, count]) => `${esc(code)} ${count}`).join(', ')}` : ''}${requests.length > ends.length ? `; ${requests.length - ends.length} with no end kept` : ''}.</p>
${task ? `<details><summary>The task</summary><pre>${esc(task.spec)}</pre>${task.rules.trim() ? `<p class="muted">Rules</p><pre>${esc(task.rules)}</pre>` : ''}<p class="muted">Evaluator: ${esc(task.evaluate.join(' '))}; at most ${whole(task.size)} characters, ${task.timeout} s, ideation after ${task.stale} steps with no gain.</p></details>` : ''}
<h2 id="search">The search</h2><p class="muted">Every file evaluated, by the request that brought it and its score, lower and better at the top, with a line to its parent. Each family with a valid file has a lane; the others share the last. A mark opens its file below.</p>
<div class="legend">${legend}</div>${candidates.length ? search : '<p>No file has been evaluated yet.</p>'}
<h2 id="cells">The cells</h2>${elites.size ? `<p class="muted">The elite of every cell, the lowest score among its valid files.</p>${grid ? `<div class="legend"><span>higher score</span>${ramp}<span>lower, better</span></div>${grid}<details><summary>The cells as a table</summary>${cellTable}</details>` : cellTable}` : '<p>No cell has a valid file yet.</p>'}
<h2 id="families">The families</h2><table><thead><tr><th>Family</th><th>Name</th><th>Idea</th><th class="n">From request</th><th class="n">Files</th><th class="n">Valid</th><th class="n">Best</th><th class="n">Cells</th><th class="n">Requests</th><th class="n">Tokens in</th><th class="n">Tokens out</th></tr></thead><tbody>${familyRows.join('')}</tbody></table>
<h2 id="discoveries">The discoveries</h2>${found.length ? `<ol class="found">${found.join('')}</ol>` : '<p>None yet.</p>'}
<h2 id="files">The files</h2>${files.join('\n')}
</body></html>
`;
}

// The palette of light and dark is the reference palette of the dataviz guidance, by role; the levels are its blue ramp.
const STYLE = `
:root{color-scheme:light;--surface:#fcfcfb;--page:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--series:#2a78d6;--critical:#d03b3b;
--l1:#b7d3f6;--l2:#86b6ef;--l3:#5598e7;--l4:#3987e5;--l5:#256abf;--l6:#184f95;--l7:#0d366b;--t1:#0b0b0b;--t2:#0b0b0b;--t3:#0b0b0b;--t4:#0b0b0b;--t5:#fff;--t6:#fff;--t7:#fff}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#1a1a19;--page:#0d0d0d;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--series:#3987e5;
--l1:#0d366b;--l2:#184f95;--l3:#256abf;--l4:#3987e5;--l5:#5598e7;--l6:#86b6ef;--l7:#b7d3f6;--t1:#fff;--t2:#fff;--t3:#fff;--t4:#0b0b0b;--t5:#0b0b0b;--t6:#0b0b0b;--t7:#0b0b0b}}
body{margin:0 auto;max-width:1140px;padding:24px;background:var(--surface);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:20px;margin:0 0 2px}h2{font-size:16px;margin:32px 0 6px}a{color:inherit}.muted,.muted a{color:var(--ink2)}
.stats{display:flex;flex-wrap:wrap;gap:12px 32px;margin:16px 0 8px}.stat b{display:block;font-size:24px;font-weight:600}.stat span{color:var(--ink2)}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin:8px 0;color:var(--ink2);font-size:13px}.legend span{display:inline-flex;gap:6px;align-items:center}
.chart{display:block;width:100%;height:auto;margin:4px 0 8px;font-size:12px}
.chart text{fill:var(--ink2)}.chart .head{fill:var(--ink);font-weight:600;font-size:13px}.chart .lane{fill:var(--ink);font-size:12.5px}.chart .note{fill:var(--muted)}
.chart .tick,.chart text.tick{fill:var(--muted);font-variant-numeric:tabular-nums}.chart .value{fill:var(--ink);font-variant-numeric:tabular-nums;paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.grid{stroke:var(--grid);stroke-width:1}.base{stroke:var(--axis);stroke-width:1}.ideation{stroke:var(--muted);stroke-width:1;opacity:.55}
.edge{stroke:var(--muted);stroke-width:1;opacity:.6;fill:none}.line{stroke:var(--series);stroke-width:2;fill:none;stroke-linejoin:round;stroke-linecap:round}
.ring{fill:var(--surface)}.dot{fill:var(--series)}.gone{fill:var(--muted)}.hollow{fill:var(--surface);stroke:var(--series);stroke-width:2}.gone.hollow{stroke:var(--muted)}
.hit{fill:transparent}a:hover .dot,a:hover .gone{stroke:var(--ink);stroke-width:2}
.idea{fill:var(--ink2)}.fail{stroke:var(--critical);stroke-width:2;fill:none;stroke-linecap:round}.nothing{stroke:var(--muted);stroke-width:1.5}.open{fill:none;stroke:var(--muted);stroke-width:1.5}
.empty{fill:var(--grid)}${Array.from({ length: LEVELS }, (_, i) => `rect.level${i + 1}{fill:var(--l${i + 1})}text.level${i + 1}{fill:var(--t${i + 1})}`).join('')}
.chart text.in{font-size:12px;font-variant-numeric:tabular-nums}.chart text.small{font-size:10.5px}a:hover rect[class^=level]{stroke:var(--ink);stroke-width:2}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--grid);vertical-align:top}th{color:var(--ink2);font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
details{border-bottom:1px solid var(--grid);padding:6px 0}details>summary{cursor:pointer}details details{border:0;padding:2px 0}
pre{background:var(--page);padding:8px 10px;overflow:auto;max-height:520px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;margin:6px 0}
.diff span{display:block;white-space:pre}.diff .add{background:rgba(12,163,12,.14)}.diff .del{background:rgba(208,59,59,.14)}.diff .skip{color:var(--muted)}
.found>li{margin:4px 0}.found ul{margin:2px 0 6px;padding-left:18px}
`;
