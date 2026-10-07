// The lab's rules that need no file and no page: the story clock, which events a focus keeps, the numbers of a run.
// Plain functions over plain values, so that the browser page, the server and a terminal view can share them.

const list = value => Array.isArray(value) ? value : [];

// ---- The clock of the story. An event's `clock` is `HH:MM:SS`, with `day N ` before it from the second day; its
// place on an axis is the seconds since the first midnight, so that two runs of one world stand on one axis.
const CLOCK = /^(?:day (\d+) )?(\d{1,2}):(\d\d)(?::(\d\d))?$/;
const two = value => String(value).padStart(2, '0');
export const secondsOf = clock => { const m = CLOCK.exec(typeof clock === 'string' ? clock : ''); return m ? (Number(m[1] ?? 1) - 1) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0) : null; };
// `day` is the word before the number of a day past the first: the page gives its own.
export const clockAt = (T, seconds = true, day = 'day') => { const n = Math.floor(T / 86400) + 1, s = ((Math.floor(T) % 86400) + 86400) % 86400;
  return `${n > 1 ? `${day} ${n} · ` : ''}${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}${seconds ? `:${two(s % 60)}` : ''}`; };
// Where an event stands on the axis: by its clock, and by `at` when the clock cannot be read.
export const timeOf = (event, before = 0) => secondsOf(event.clock) ?? (Number.isFinite(event.at) ? event.at : before);

// ---- The focus. With characters chosen, an event stays when, for at least one of them:
// (a) it is the event's `who`: what it said, did, where it went, its memory, and the world's answer to its deed;
// (b) it is the `to` of a `say`, a `call` or a `reply`;
// (c) the event's `heard` holds it;
// (d) `feels` or `poses` of the event has an entry of it, or `wakes` holds it.
// `focusOf` gives null for an event that does not stay, and else `{ own, why, ids }`: `own` for (a); for the others
// `why` is `to`, `heard` or `body` (the first that holds, in that order) and `ids` the chosen characters it holds for.
export const focusOf = (event, chosen) => {
  if (chosen.has(event.who)) return { own: true, why: 'own', ids: [event.who] };
  if (['say', 'call', 'reply'].includes(event.kind) && chosen.has(event.to)) return { own: false, why: 'to', ids: [event.to] };
  const heard = list(event.heard).filter(id => chosen.has(id));
  if (heard.length) return { own: false, why: 'heard', ids: [...new Set(heard)] };
  const body = [...list(event.feels).map(item => item?.of), ...list(event.poses).map(item => item?.of), ...list(event.wakes)].filter(id => chosen.has(id));
  return body.length ? { own: false, why: 'body', ids: [...new Set(body)] } : null;
};
// The filter by place: an event stays when its `place` is one of the chosen places.
export const inPlaces = (event, places) => places.has(event.place);
// Both filters together, each off when its set is empty.
export const keeps = (event, chosen, places) => (!places.size || inPlaces(event, places)) && (!chosen.size || focusOf(event, chosen) !== null);

// ---- The numbers of a run, from its usage rows (as `usageRow` of the data module gives them) and its events.
export const KINDS = ['turn', 'world', 'reply', 'memory'];
export const ACTORS = ['say', 'call', 'do', 'go', 'arrive', 'wait', 'sleep', 'wake', 'memory', 'result'];
export const median = values => { if (!values.length) return null; const sorted = [...values].sort((one, other) => one - other), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const sums = () => ({ requests: 0, failed: 0, input: 0, cached: 0, output: 0, reasoning: 0, ms: [], models: new Set() });
const count = (into, row) => { into.requests += 1; if (row.failed) into.failed += 1; into.input += row.input; into.cached += row.cached; into.output += row.output; into.reasoning += row.reasoning;
  if (row.ms !== null && row.ms !== undefined) into.ms.push(row.ms); if (row.model) into.models.add(row.model); };
// The counts as they are shown: `medianMs` for the list of times, the models as a list; `cachedShare` is of `input`.
const closed = ({ ms, models, ...rest }) => ({ ...rest, cachedShare: rest.input > 0 ? rest.cached / rest.input : null, medianMs: median(ms), models: [...models] });
// The share of input read from the cache as the run went: the rows that counted input, in their order, cut into at
// most `most` runs of equal length; a point is the share over a run, for all rows, the turns and the world's answers
// (null where a run has no row of the kind).
export const cacheSeries = (usage, most = 40) => {
  const rows = usage.filter(row => row.input > 0), size = Math.max(4, Math.ceil(rows.length / most)), points = [];
  for (let at = 0; at < rows.length; at += size) {
    const part = rows.slice(at, at + size), of = kind => { let input = 0, cached = 0; for (const row of part) if (kind === null || row.kind === kind) { input += row.input; cached += row.cached; } return input > 0 ? cached / input : null; };
    points.push({ from: at + 1, to: at + part.length, all: of(null), turn: of('turn'), world: of('world') });
  }
  return { requests: rows.length, points };
};
// `all`: every request. `kinds`: by kind of request, the known kinds first and only those that have rows.
// `who`: by character, in the order of `ids` and then of first appearance: the requests made for it (`turns` and
// `memories` among them) and, from the events, its speeches (`say`, `call`), deeds, walks and private notes.
export const numbersOf = (usage, events, ids = []) => {
  const all = sums(), kinds = new Map(KINDS.map(kind => [kind, sums()])), who = new Map();
  const whoOf = id => { let known = who.get(id); if (!known) who.set(id, known = { ...sums(), turns: 0, memories: 0, says: 0, deeds: 0, moves: 0, notes: 0 }); return known; };
  for (const id of ids) whoOf(id);
  for (const row of usage) {
    count(all, row);
    if (!kinds.has(row.kind)) kinds.set(row.kind, sums());
    count(kinds.get(row.kind), row);
    if (row.who) { const known = whoOf(row.who); count(known, row); if (row.kind === 'turn') known.turns += 1; if (row.kind === 'memory') known.memories += 1; }
  }
  for (const event of events) {
    if (!ACTORS.includes(event.kind) || !event.who) continue;
    const known = whoOf(event.who);
    if (event.kind === 'say' || event.kind === 'call') known.says += 1;
    if (event.kind === 'do') known.deeds += 1;
    if (event.kind === 'go') known.moves += 1;
    if (event.note) known.notes += 1;
  }
  return { events: events.length, all: closed(all), kinds: [...kinds].filter(([, known]) => known.requests).map(([kind, known]) => ({ kind, ...closed(known) })),
    who: [...who].map(([id, known]) => ({ id, ...closed(known) })), cache: cacheSeries(usage) };
};

// ---- The stretches of one world. A world is played in stretches (`part1`, `part2`, ... `part11`), each a file; a
// stretch is no part of the story, only a piece the runner happened to play, and the world reads as one feed.
// `natural` orders names with their numbers as numbers: `part9` before `part10`.
const chunks = name => String(name).match(/\d+|\D+/g) ?? [];
export const natural = (one, other) => {
  const a = chunks(one), b = chunks(other);
  for (let at = 0; at < a.length && at < b.length; at += 1) {
    if (a[at] === b[at]) continue;
    if (!/^\d/.test(a[at]) || !/^\d/.test(b[at])) return a[at] < b[at] ? -1 : 1;
    const x = a[at].replace(/^0+/, ''), y = b[at].replace(/^0+/, '');
    if (x.length !== y.length) return x.length - y.length;
    if (x !== y) return x < y ? -1 : 1;
    return a[at].length - b[at].length;
  }
  return a.length - b.length;
};
// The order in which stretches were played: by the story second of their first event (`from`), and by `natural`
// order of their names where that does not decide. A stretch with no event yet (`from` null) is the one just begun:
// it stands after every stretch that has one.
export const played = stretches => [...stretches].sort((one, other) => { const a = one.from ?? Infinity, b = other.from ?? Infinity; return a === b ? natural(one.name, other.name) : a < b ? -1 : 1; });
// The stretch that holds the story second `T`: the first that ends at or after it, the last one when none does.
// Stretches without events hold nothing. -1 when there is none to choose.
export const stretchAt = (stretches, T) => {
  let last = -1;
  for (let at = 0; at < stretches.length; at += 1) { if (stretches[at].to == null) continue; last = at; if (stretches[at].to >= T) return at; }
  return last;
};
// Among items in the order of their `T`, the index of the first at or after `T`; the last one when none is.
export const firstAt = (items, T) => {
  let low = 0, high = items.length;
  while (low < high) { const mid = (low + high) >> 1; if (items[mid].T < T) low = mid + 1; else high = mid; }
  return Math.min(low, items.length - 1);
};

// ---- The list of experiments. `narrowed` says whether an experiment stays when the list is narrowed by `words`:
// every word typed is a part of its id, which is its path under the root and its name, without regard to case.
export const narrowed = (id, words) => { const name = String(id).toLowerCase(); return String(words).toLowerCase().split(/\s+/).filter(Boolean).every(word => name.includes(word)); };
// The experiments of a list as it is shown: by group, the group with the newest activity first and within a group
// the order given, the real runs of a group apart from its rehearsals. `experiments` are in the order of the list,
// newest first. Gives `[{ group, runs, rehearsals }]`.
export const grouped = experiments => {
  const groups = new Map();
  for (const experiment of experiments) {
    if (!groups.has(experiment.group)) groups.set(experiment.group, { group: experiment.group, runs: [], rehearsals: [] });
    groups.get(experiment.group)[experiment.rehearsal ? 'rehearsals' : 'runs'].push(experiment);
  }
  return [...groups.values()];
};

// ---- The link: the view's state as it stands after `#` in the page's address, so that a link opens the same view.
// x: the experiment. s: a stretch of it; t: a story second. In the feed of a whole world they say where to stand
// (`s` alone: where that stretch begins; `t` with `s`: that moment within the stretch; `t` alone: that moment of the
// world), and `solo=1` shows the stretch `s` by itself. cmp, cs: the experiment beside it and its stretch; in a
// comparison a named stretch is shown by itself (`s` on the left, `cs` on the right) and a side without one is its
// whole world. who, place: the filters; q, only: the search and whether it filters; v: `n` for the numbers, `s` for
// the story, `t` for the transcript; ch: the chapter at the top of the story; step: seconds of a compare row (0: chosen by the page); notes,
// lists: the two switches. A link of the time when a stretch was all there was to open (`x`, `s`, `t` and the rest)
// reads by the same rule and stands on the same moment, now within the whole world.
export const linkOf = hash => {
  const got = {}, text = String(hash ?? '').replace(/^#/, '');
  for (const part of text.split('&')) { const at = part.indexOf('='); if (at > 0 && !Object.hasOwn(got, part.slice(0, at))) got[part.slice(0, at)] = part.slice(at + 1); }
  const one = key => { if (got[key] === undefined) return null; try { return decodeURIComponent(got[key]); } catch { return null; } };
  const ids = key => (got[key] ?? '').split(',').map(id => { try { return decodeURIComponent(id); } catch { return ''; } }).filter(Boolean);
  const t = one('t'), ch = Number(one('ch')), step = Number(one('step')), v = one('v');
  return { x: one('x'), s: one('s'), solo: one('solo') === '1' && one('s') !== null, cmp: one('cmp'), cs: one('cs'), who: ids('who'), place: ids('place'), q: one('q') ?? '', only: one('only') === '1',
    v: v === 'n' || v === 's' || v === 't' ? v : 'f', ch: Number.isInteger(ch) && ch > 0 ? ch : null, step: step > 0 ? step : 0, notes: one('notes') !== '0', lists: one('lists') !== '0',
    t: t !== null && t !== '' && Number.isFinite(Number(t)) ? Number(t) : null };
};
export const hashOf = state => {
  const enc = encodeURIComponent, parts = [];
  if (state.x !== null) parts.push(`x=${enc(state.x)}`);
  if (state.s !== null) parts.push(`s=${enc(state.s)}`);
  if (state.s !== null && state.solo && state.cmp === null) parts.push('solo=1');
  if (state.cmp !== null) parts.push(`cmp=${enc(state.cmp)}`);
  if (state.cmp !== null && state.cs !== null) parts.push(`cs=${enc(state.cs)}`);
  if (state.who.length) parts.push(`who=${state.who.map(enc).join(',')}`);
  if (state.place.length) parts.push(`place=${state.place.map(enc).join(',')}`);
  if (state.q) parts.push(`q=${enc(state.q)}`);
  if (state.q && state.only) parts.push('only=1');
  if (state.v !== 'f') parts.push(`v=${state.v}`);
  if (state.v === 's' && state.ch !== null) parts.push(`ch=${state.ch}`);
  if (state.cmp !== null && state.step) parts.push(`step=${state.step}`);
  if (!state.notes) parts.push('notes=0');
  if (!state.lists) parts.push('lists=0');
  if (state.t !== null) parts.push(`t=${Math.round(state.t)}`);
  return parts.join('&');
};
// Which stretch each side shows by itself: null is the whole world.
export const sidesOf = state => ({ a: state.s !== null && (state.solo || state.cmp !== null) ? state.s : null, b: state.cmp !== null ? state.cs : null });
// What to load and where to stand. `stretches` are those the side shows, in the played order, each `{ name, from,
// to }` (story seconds, null without events); `s` and `t` are the link's; `follow` says the newest is kept in view.
// Gives `stretch`, the one to stand in (by `s`; without it, or when the world has no such stretch, by `t`; with
// neither the first, or the last when following), `t` as given, `end` when the place is the world's end, and
// `order`: every stretch, the one to stand in first and then its neighbours, the nearer the sooner, so that the
// page can be read where it stands while the rest of the world is still on its way.
export const planOf = ({ s = null, t = null }, stretches, follow = false) => {
  const names = stretches.map(stretch => stretch.name), named = s === null ? -1 : names.indexOf(s), timed = named === -1 && t !== null ? stretchAt(stretches, t) : -1;
  const end = named === -1 && timed === -1 && follow, at = named !== -1 ? named : timed !== -1 ? timed : end ? names.length - 1 : 0, order = [];
  for (let by = 0; order.length < names.length; by += 1) { if (by === 0) order.push(names[at]); else { if (at + by < names.length) order.push(names[at + by]); if (at - by >= 0) order.push(names[at - by]); } }
  return { stretch: names[at] ?? null, t: named !== -1 || timed !== -1 ? t : null, end, order };
};
