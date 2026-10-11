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
// (d) `feels`, `poses`, `lingers`, `traced` or `wiped` of the event has an entry of it, `touches` has it as `of` or
// `to`, or `wakes` holds it.
// `focusOf` gives null for an event that does not stay, and else `{ own, why, ids }`: `own` for (a); for the others
// `why` is `to`, `heard` or `body` (the first that holds, in that order) and `ids` the chosen characters it holds for.
export const focusOf = (event, chosen) => {
  if (chosen.has(event.who)) return { own: true, why: 'own', ids: [event.who] };
  if (['say', 'call', 'reply'].includes(event.kind) && chosen.has(event.to)) return { own: false, why: 'to', ids: [event.to] };
  const heard = list(event.heard).filter(id => chosen.has(id));
  if (heard.length) return { own: false, why: 'heard', ids: [...new Set(heard)] };
  const body = [...['feels', 'poses', 'lingers', 'traced', 'wiped'].flatMap(key => list(event[key]).map(item => item?.of)),
    ...list(event.touches).flatMap(item => [item?.of, item?.to]), ...list(event.wakes)].filter(id => chosen.has(id));
  return body.length ? { own: false, why: 'body', ids: [...new Set(body)] } : null;
};
// The filter by place: an event stays when its `place` is one of the chosen places.
export const inPlaces = (event, places) => places.has(event.place);
// Both filters together, each off when its set is empty.
export const keeps = (event, chosen, places) => (!places.size || inPlaces(event, places)) && (!chosen.size || focusOf(event, chosen) !== null);

// ---- The numbers of a run, from its usage rows (as `usageRow` of the data module gives them) and its events.
export const KINDS = ['turn', 'world', 'reply', 'memory'];
export const ACTORS = ['say', 'call', 'do', 'drive', 'go', 'arrive', 'wait', 'sleep', 'wake', 'memory', 'result'];
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
    if (event.kind === 'go' || event.kind === 'drive') known.moves += 1;
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

// ---- The list of experiments: what of it is shown, and in what order. The state of the list is `LIST`: `words`,
// each of which has to be in the entry's id, its name, the title of its world or a model's name that its usage rows
// record, whatever the case; `least`, the least number of requests; `since`, a date `YYYY-MM-DD` on or after which
// it was last written, by the clock of the browser; `kind`, one of `KINDS_OF`; `order`, one of `ORDERS`, each with
// a direction of its own that `reverse` turns round; and `rehearsals`, whether those are shown.
export const LIST = { words: '', least: 0, since: '', kind: '', order: 'written', reverse: false, rehearsals: false };
// The kinds by the words of the address, and what the lab calls each (`shape`).
export const KINDS_OF = { world: 'world', run: 'run', transcript: 'text' };
// The story seconds that an entry covers, from its first event to its last, or null when it has no event.
export const spanOf = entry => {
  let from = null, to = null;
  for (const stretch of list(entry.stretches)) { if (stretch.from != null && (from === null || stretch.from < from)) from = stretch.from; if (stretch.to != null && (to === null || stretch.to > to)) to = stretch.to; }
  return from === null || to === null ? null : { from, to };
};
// What an order compares: a text goes up, a number down, and an entry without the value stands last either way.
const covered = entry => { const span = spanOf(entry); return span ? span.to - span.from : null; };
export const ORDERS = { written: entry => entry.modified, name: entry => String(entry.name), kind: entry => entry.shape, requests: entry => entry.usage.requests || null, time: covered,
  residents: entry => entry.cast ?? null, model: entry => entry.residents[0] ?? entry.world[0] ?? null };
const texts = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
// The text that the words are looked for in.
export const hayOf = entry => [entry.id, entry.name, entry.title ?? '', ...list(entry.residents), ...list(entry.world)].join('\n').toLowerCase();
// `entries` are the list's, each with `hay` (`hayOf`). `kept` are ids that stay though they are rehearsals: what is
// open. Gives `shown`, in the order asked for, and `hidden`: how many rehearsals the filters would have let through.
export const listed = (entries, state, kept = new Set()) => {
  const words = state.words.toLowerCase().split(/\s+/).filter(Boolean), shape = KINDS_OF[state.kind] ?? null, [year, month, day] = state.since.split('-').map(Number);
  const since = state.since === '' ? null : new Date(year, month - 1, day).getTime(), value = ORDERS[state.order] ?? ORDERS.written, turn = state.reverse ? -1 : 1, shown = [];
  let hidden = 0;
  for (const entry of entries) {
    if (entry.usage.requests < state.least || (shape !== null && entry.shape !== shape) || (since !== null && !(entry.modified >= since)) || !words.every(word => entry.hay.includes(word))) continue;
    if (entry.rehearsal && !state.rehearsals && !kept.has(entry.id)) hidden += 1; else shown.push(entry);
  }
  const keyed = shown.map(entry => [value(entry), entry]);
  keyed.sort(([one, first], [other, second]) => {
    if (one == null && other == null) return second.modified - first.modified || (first.id < second.id ? -1 : 1);
    if (one == null) return 1;
    if (other == null) return -1;
    return turn * (typeof one === 'string' ? texts.compare(one, other) : other - one) || second.modified - first.modified || (first.id < second.id ? -1 : 1);
  });
  return { shown: keyed.map(([, entry]) => entry), hidden };
};
// The entries of a list by group, a group being the folder of its entries: the groups in the order in which the
// list comes to them, and within a group the order given. Gives `[{ group, entries }]`.
export const grouped = entries => {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, { group: entry.group, entries: [] });
    groups.get(entry.group).entries.push(entry);
  }
  return [...groups.values()];
};
// The list's state as the query of the address `/` reads and writes it, in words: `words`, `requests`, `since`,
// `kind`, `order`, `reverse=yes`, `rehearsals=shown`.
export const listOf = (query = '') => {
  const got = new URLSearchParams(query), least = Number(got.get('requests')), since = got.get('since') ?? '', kind = got.get('kind') ?? '', order = got.get('order') ?? '';
  return { words: got.get('words') ?? '', least: Number.isInteger(least) && least > 0 ? least : 0, since: /^\d{4}-\d\d-\d\d$/.test(since) ? since : '', kind: Object.hasOwn(KINDS_OF, kind) ? kind : '',
    order: Object.hasOwn(ORDERS, order) ? order : LIST.order, reverse: got.get('reverse') === 'yes', rehearsals: got.get('rehearsals') === 'shown' };
};

// ---- Where everyone is. Of an event, what it says of where its `who` is from then on, or null when it says nothing
// new: a `go` that someone leaves `place` by, for `to` and for so many seconds; a `sleep` in a place; and `at`, for
// anything else a character does in a place, an arrival and a waking among them, which is given once and not again
// while the character stays there awake. `T` is the event's story second, and `known` the place each character was
// last given as awake in, a map that the caller keeps for one file of events and that is written to here. A figure's answer and a
// rewritten memory move nobody. `MOVES` are the kinds of event that are read.
const MOVES = ['say', 'call', 'do', 'wait', 'arrive', 'wake', 'result', 'sleep', 'go'];
export const moveOf = (event, T, known) => {
  if (event.kind === 'drive' && typeof event.from === 'string' && typeof event.to === 'string' && Number.isFinite(event.arrival)) {
    known.delete(event.place);
    return { T, who: event.place, kind: 'go', place: event.from, to: event.to, seconds: event.arrival - event.at };
  }
  if (event.kind === 'park') { known.set(event.who, event.place); return { T, who: event.who, kind: 'at', place: event.place }; }
  if (event.kind === 'go' && event.transfer) { known.set(event.who, event.to); return { T, who: event.who, kind: 'at', place: event.to }; }
  const { who, place, kind } = event, spent = Number.isFinite(event.seconds) && event.seconds > 0 ? event.seconds : 0;
  if (typeof who !== 'string' || who === '' || typeof place !== 'string' || place === '' || !MOVES.includes(kind)) return null;
  if (kind === 'go' && (typeof event.to !== 'string' || event.to === '')) return null;
  if (kind === 'go' || kind === 'sleep') { known.delete(who); return kind === 'go' ? { T, who, kind, place, to: event.to, seconds: spent } : { T, who, kind, place, seconds: spent }; }
  if (known.get(who) === place) return null;
  known.set(who, place);
  return { T, who, kind: 'at', place };
};

// ---- The link: the view's state as the path and the query of the page's address, so that a link opens the same
// view and reads as words: `/view/day/kept?stretch=part2&moment=13:00:03`. The path `/` names no experiment: it is
// the list, and its query is the list's state (`listOf`).
// The state keeps short names, and the address has a whole word for each, here in brackets.
// x: the experiment, its id after `/view/` with its slashes. s [stretch]: a stretch of it, which the address leaves
// out when the experiment has that one stretch alone (`implied`); t [moment]: a moment as the story's clock,
// `22:23:27`, with `day2-` before it from the second day, read back as a story second. In the feed of a whole world
// they say where to stand (`s` alone: where that stretch begins; `t` with `s`: that moment within the stretch; `t`
// alone: that moment of the world), and solo [alone=yes] shows the stretch `s` by itself. cmp, cs [compare,
// compare-stretch]: the experiment beside it and its stretch; in a comparison a named stretch is shown by itself
// (`s` on the left, `cs` on the right) and a side without one is its whole world. who, place: the filters; q, only
// [search, found=only]: the search and whether it filters; v [show]: `n` for the numbers, `s` for the story, `t`
// for the transcript, `m` for the map, where `t` is the moment it shows (`VIEWS` has their words); ch [chapter]:
// the chapter at the top of the story; step: seconds of a compare row (0: chosen by the page); notes, lists
// [thoughts=hidden, lists=hidden]: the two switches. A moment that is a plain count of seconds is read too.
const VIEWS = { numbers: 'n', story: 's', transcript: 't', map: 'm' };
const VIEW = '/view/';
// A text of a query with the signs that read as they are left alone: the colons of a clock, the slashes of an id,
// the commas of a list, and a space as `+`.
const inQuery = text => encodeURIComponent(text).replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%20/g, '+');
// An id in a list keeps its own comma and percent sign apart from the list's.
const inList = ids => ids.map(id => inQuery(id.replace(/[%,]/g, encodeURIComponent))).join(',');
const momentIn = T => { const at = Math.round(T); return at < 0 ? String(at) : clockAt(at).replace(/^day (\d+) · /, 'day$1-'); };
const momentOf = text => { const at = secondsOf(String(text).replace(/^day(\d+)-/, 'day $1 ')); return at !== null ? at : text !== '' && Number.isFinite(Number(text)) ? Number(text) : null; };
export const linkOf = (path = '/', query = '') => {
  const got = new URLSearchParams(query), one = key => got.get(key);
  const decoded = text => { try { return decodeURIComponent(text); } catch { return ''; } };
  const ids = key => (one(key) ?? '').split(',').map(decoded).filter(Boolean);
  const x = String(path).startsWith(VIEW) ? decoded(String(path).slice(VIEW.length)).replace(/\/+$/, '') || null : null;
  const t = one('moment'), ch = Number(one('chapter')), step = Number(one('step')), show = one('show') ?? '';
  return { x, s: one('stretch'), solo: one('alone') === 'yes' && one('stretch') !== null, cmp: one('compare'), cs: one('compare-stretch'), who: ids('who'), place: ids('place'), q: one('search') ?? '', only: one('found') === 'only',
    v: Object.hasOwn(VIEWS, show) ? VIEWS[show] : 'f', ch: Number.isInteger(ch) && ch > 0 ? ch : null, step: step > 0 ? step : 0, notes: one('thoughts') !== 'hidden', lists: one('lists') !== 'hidden',
    t: t === null ? null : momentOf(t) };
};
// `implied` is the experiment's stretch when it has one alone, or null. Without an experiment the address is the
// list's, and `list` is its state.
export const addressOf = (state, implied = null, list = LIST) => {
  const enc = inQuery, parts = [], s = state.s === implied ? null : state.s;
  if (state.x === null) {
    if (list.words) parts.push(`words=${enc(list.words)}`);
    if (list.least > 0) parts.push(`requests=${list.least}`);
    if (list.since) parts.push(`since=${list.since}`);
    if (list.kind) parts.push(`kind=${list.kind}`);
    if (list.order !== LIST.order) parts.push(`order=${list.order}`);
    if (list.reverse) parts.push('reverse=yes');
    if (list.rehearsals) parts.push('rehearsals=shown');
    return `/${parts.length ? `?${parts.join('&')}` : ''}`;
  }
  if (s !== null) parts.push(`stretch=${enc(s)}`);
  if (s !== null && state.solo && state.cmp === null) parts.push('alone=yes');
  if (state.cmp !== null) parts.push(`compare=${enc(state.cmp)}`);
  if (state.cmp !== null && state.cs !== null) parts.push(`compare-stretch=${enc(state.cs)}`);
  if (state.who.length) parts.push(`who=${inList(state.who)}`);
  if (state.place.length) parts.push(`place=${inList(state.place)}`);
  if (state.q) parts.push(`search=${enc(state.q)}`);
  if (state.q && state.only) parts.push('found=only');
  if (state.v !== 'f') parts.push(`show=${Object.keys(VIEWS).find(word => VIEWS[word] === state.v)}`);
  if (state.v === 's' && state.ch !== null) parts.push(`chapter=${state.ch}`);
  if (state.cmp !== null && state.step) parts.push(`step=${state.step}`);
  if (!state.notes) parts.push('thoughts=hidden');
  if (!state.lists) parts.push('lists=hidden');
  if (state.t !== null) parts.push(`moment=${momentIn(state.t)}`);
  // The id stands in the path as it is but for what would end the path or be read as another sign.
  return `${VIEW + encodeURI(state.x).replace(/[?#]/g, encodeURIComponent)}${parts.length ? `?${parts.join('&')}` : ''}`;
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
