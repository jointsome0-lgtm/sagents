import { secondsOf, clockAt as clockIn, timeOf, focusOf, numbersOf as numbersIn, median, ACTORS, linkOf, hashOf as hashIn, sidesOf, planOf, stretchAt, firstAt, narrowed, grouped } from './core.js';
import { layoutOf, fitOf, sceneOf, peopleOf, roomFor, whereAt, momentsOf, waysFrom } from './map.js';
import { STRINGS, languageOf } from './strings.js';
// Every text of an event, of a world file, of `about.txt`, of a transcript and every name of a file comes from
// outside: it goes into the page as a text node alone, through `textContent`, and never as markup.
// The page's own words are `TXT`, the table of the language that the address names (`?lang=`, as `sagents lab` was
// told) or else of the browser's: the markup names its entries, the rest is asked for here by name.
const LANG = languageOf(navigator.language, new URLSearchParams(location.search).get('lang')), TXT = STRINGS[LANG];
document.documentElement.lang = LANG;
for (const node of document.querySelectorAll('[data-t]')) node.textContent = TXT[node.dataset.t];
for (const node of document.querySelectorAll('[data-t-title]')) node.title = TXT[node.dataset.tTitle];
for (const node of document.querySelectorAll('[data-t-placeholder]')) node.placeholder = TXT[node.dataset.tPlaceholder];
for (const node of document.querySelectorAll('[data-t-label]')) node.setAttribute('aria-label', TXT[node.dataset.tLabel]);
// The three labels that the style sheet writes itself.
for (const [name, key] of [['--t-note', 'noteLabel'], ['--t-unfold', 'unfold'], ['--t-fold', 'fold']]) document.documentElement.style.setProperty(name, JSON.stringify(TXT[key]));
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const str = value => typeof value === 'string' ? value : value == null ? '' : String(value);
const list = value => Array.isArray(value) ? value : [];
const number = value => Number(value || 0).toLocaleString(LANG);
const compact = new Intl.NumberFormat(LANG, { notation: 'compact', maximumFractionDigits: 1 });
const decimal = text => text.replace('.', TXT.point);
// A search takes the Russian letter yo for ye, as a reader of a Russian story types it.
const YO = String.fromCharCode(0x451), YE = String.fromCharCode(0x435);
const norm = text => text.toLowerCase().replaceAll(YO, YE);
const stored = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* no storage: the choice lasts for this page alone */ } return null; };

// ---- The view's state, which lives in the hash: a link opens the same view. What each key means, and how a link is
// read and written, is `linkOf` and `hashOf` of `core.js`.
const state = linkOf('');
const readHash = () => { Object.assign(state, linkOf(location.hash)); };
const hashOf = () => hashIn(state);
const writeHash = push => { const hash = `#${hashOf()}`; if (hash !== (location.hash || '#')) history[push ? 'pushState' : 'replaceState'](null, '', hash); };

// ---- The clock of the story, whose rules are in `core.js`; here are its words.
const clockAt = (T, seconds = true) => clockIn(T, seconds, TXT.day);
// The day of a clock where room is short: one letter and the number, or nothing.
const DAY_HEAD = new RegExp(`^${TXT.day} (\\d+) · `);
const shortClock = T => clockAt(T).replace(DAY_HEAD, `${TXT.dayShort}$1 `);
const duration = seconds => !(seconds > 0) ? '' : seconds < 60 ? `${Math.round(seconds)} ${TXT.seconds}` : seconds < 3600 ? decimal(`${Math.round(seconds / 6) / 10} ${TXT.minutes}`) : decimal(`${Math.round(seconds / 360) / 10} ${TXT.hours}`);

// ---- The two sides: `A` is the experiment that is read, `B` the one beside it in a comparison. A side shows the
// whole world of its experiment (`s` null) or one stretch by itself. Its `parts` are the stretches it shows, in the
// played order as the list gives it; each is loaded by itself, and `recs` and `usage` of the side are those of its
// parts joined. The last part, the one a run grows, is listened to (`tail`, `source`); the others are fetched one
// after another, `order` and `first` saying which sooner. `pending` is where the page is to stand once that part is
// there: `{ name, t }`. `named` says that the names of the world have come: no event is drawn before that, a node
// being written once with the names in it, and the side B waits for the names of A, whose order the chips keep.
const side = key => ({ key, x: null, s: null, parts: [], tail: null, order: [], first: null, pending: null, gen: null, busy: false, source: null, recs: [], usage: [], names: { characters: new Map(), places: new Map() }, named: false, caught: false, placed: false, live: false, gone: false });
const A = side('a'), B = side('b'), sides = [A, B];
// The chapters of the open experiment's story, as `story?x=` gave them; `key` is what the list said of them then.
let story = { x: null, key: null, chapters: [], loading: false };
// The characters and the places in the order of the world file and then of first appearance: the order gives a
// character its colour and its key, and a filter never repaints anyone.
const people = new Map(), spots = new Map();
let chipsStale = false;
const person = id => { let known = people.get(id); if (!known) { known = { id, index: people.size }; people.set(id, known); chipsStale = true; } return known; };
const spot = id => { if (id !== '' && !spots.has(id)) { spots.set(id, spots.size); chipsStale = true; } };
const tone = id => { const index = people.get(id)?.index; return index === undefined ? '' : index < 8 ? `p${index + 1}` : 'p0'; };
const personName = id => A.names.characters.get(id) ?? B.names.characters.get(id) ?? str(id);
const placeName = id => A.names.places.get(id) ?? B.names.places.get(id) ?? str(id);
const holder = id => A.names.characters.get(id) ?? A.names.places.get(id) ?? B.names.characters.get(id) ?? B.names.places.get(id) ?? str(id);

// ---- One event as a node of the page.
// The fields of an event that this page shows in a place of their own, or leaves out knowingly (`finds`, which the
// line of what was found says). Any other is shown as a plain line.
const KNOWN = new Set(['at', 'clock', 'kind', 'who', 'place', 'to', 'text', 'seconds', 'cut', 'heard', 'note', 'indoors', 'search', 'finds', 'found', 'moved', 'set', 'poses', 'feels', 'wakes', 'beyond', 'nearby', 'gesture', 'says']);
const dot =id => el('span', `dot ${tone(id)}`);
const whoNode = (head, id, figure) => { head.append(figure ? el('span', 'dot') : dot(id), el('span', 'who', personName(id))); };
const build = rec => {
  const event = rec.e, kind = str(event.kind), node = el('div', `ev k-${/^[a-z]+$/.test(kind) ? kind : 'other'}`), body = el('div', 'b'), head = el('div', 'h');
  const who = str(event.who), to = event.to == null ? null : str(event.to), spent = duration(event.seconds);
  let text = event.text == null ? null : str(event.text), missing = '', slim = false, timed = false;
  if (ACTORS.includes(kind) && who !== '') { person(who); node.classList.add(tone(who)); }
  spot(str(event.place));
  rec.texts = []; rec.feels = []; rec.note = null; rec.via = null;
  if (kind === 'say') { whoNode(head, who); if (to !== null) head.append(el('span', '', `→ ${personName(to)}`)); }
  else if (kind === 'call') { whoNode(head, who); head.append(el('span', '', `${TXT.calls} → ${personName(to ?? '')}`)); }
  else if (kind === 'do') { whoNode(head, who); head.append(el('span', '', TXT.does)); timed = true; }
  else if (kind === 'go') { whoNode(head, who); head.append(el('span', '', `${TXT.goes} → ${placeName(to ?? '')}`)); slim = timed = true; text = null; }
  else if (kind === 'arrive') { whoNode(head, who); head.append(el('span', '', TXT.arrives)); slim = true; text = null; }
  else if (kind === 'wait') { whoNode(head, who); head.append(el('span', '', TXT.waits)); slim = timed = true; }
  else if (kind === 'sleep') { whoNode(head, who); head.append(el('span', '', TXT.fallsAsleep)); slim = timed = true; }
  else if (kind === 'wake') { whoNode(head, who); head.append(el('span', '', TXT.wakes)); slim = true; text = null; }
  else if (kind === 'result') { head.append(el('span', 'tag', TXT.worldTag)); whoNode(head, who); head.append(el('span', '', TXT.whatCame)); missing = TXT.nothingNoticed; }
  else if (kind === 'reply') { head.append(el('span', 'tag', TXT.worldTag)); whoNode(head, who, true); head.append(el('span', '', `${TXT.answers} → ${personName(to ?? '')}`)); missing = TXT.noAnswer; }
  else if (kind === 'weather') head.append(el('span', 'tag', TXT.weather));
  else if (kind === 'memory') { whoNode(head, who); head.append(el('span', '', `${TXT.memoryRewritten}${text === null ? TXT.memoryLost : ''}`)); missing = TXT.memoryMissing; }
  // A kind this page does not know, of another version of the engine: its own name, and whom or what it names.
  else { if (who !== '') whoNode(head, who); head.append(el('span', '', `${kind}${to === null ? '' : ` → ${holder(to)}`}`)); timed = true; }
  if (spent && (timed || kind === 'say' || kind === 'call')) head.append(el('span', 'dur', spent));
  if (event.cut) head.append(el('span', '', TXT.cut));
  if (event.place) { const where = el('span', 'pl', placeName(str(event.place))); if (list(event.heard).length) where.title = `${TXT.heardBy}: ${list(event.heard).map(personName).join(', ')}`; head.append(where); }
  rec.head = head;
  const words = (cls, value) => { const box = el('div', cls, value); if (box.firstChild) rec.texts.push(box.firstChild); return box; };
  if (kind === 'memory') {
    // Folded: the browser's own `details`, which opens on a click.
    const fold = el('details', 'mem'), summary = el('summary');
    summary.append(head);
    fold.append(summary, text === null ? el('div', 'x none', missing) : words('x', text));
    body.append(fold);
    rec.fold = fold;
    slim = true;
  } else {
    body.append(head);
    // How long a deed takes, as a length: 140 px are ten story minutes, and anything longer is marked as cut off.
    if (timed && event.seconds > 0) { const bar = el('i', event.seconds > 600 ? 'len over' : 'len'); bar.style.width = `${Math.max(2, Math.round(Math.min(event.seconds, 600) / 600 * 140))}px`; body.append(bar); }
    if (text !== null && text !== '') body.append(words('x', text));
    else if (missing) body.append(el('div', 'x none', missing));
    if (kind === 'weather' && event.indoors != null) body.append(words('x none', `${TXT.indoors}: ${str(event.indoors)}`));
  }
  const lines = [];
  const line = (label, value, cls) => { const row = el('div', cls ?? ''), words = document.createTextNode(value); row.append(el('b', '', `${label}: `), words); rec.texts.push(words); lines.push(row); return row; };
  if (typeof event.gesture === 'string' && event.gesture !== '') line(TXT.gesture, event.gesture);
  if (typeof event.says === 'string' && event.says !== '') line(TXT.says, event.says);
  if (event.search) line(TXT.search, TXT.searchText);
  for (const thing of list(event.found)) line(TXT.found, `${str(thing?.what)} ${str(thing?.name)} (${str(thing?.spot)})`);
  for (const posting of list(event.moved)) line(posting?.stock ? TXT.movedStock : TXT.moved, `${str(posting?.what)} ${str(posting?.name)}${posting?.n == null ? '' : ` ×${str(posting.n)}`}, ${str(posting?.out ?? '') || holder(posting?.from)} → ${str(posting?.into ?? '') || holder(posting?.to)}${
    posting?.as == null || posting.as === posting.what ? '' : ` ${TXT.as} ${str(posting.as)}`}`);
  for (const thing of list(event.set)) line(TXT.state, `${str(thing?.what)} ${str(thing?.name)}: ${str(thing?.state)}`);
  for (const pose of list(event.poses)) line(`${TXT.pose} · ${personName(pose?.of)}`, str(pose?.text) || TXT.none);
  for (const feeling of list(event.feels)) rec.feels.push([str(feeling?.of), line(`${TXT.feels} · ${personName(feeling?.of)}`, str(feeling?.text), 'own')]);
  if (list(event.wakes).length) line(TXT.wakesList, list(event.wakes).map(personName).join(', '));
  if (event.beyond != null) line(TXT.beyond, `${str(event.beyond)}${list(event.nearby).length ? ` (${list(event.nearby).map(personName).join(', ')})` : ''}`);
  // A field this page does not know, of another version of the engine, is one line under the field's own name,
  // with what it holds as it stands: nothing of an event is left out without a word.
  for (const [key, value] of Object.entries(event)) if (!KNOWN.has(key) && value != null && value !== '' && value !== false && !(Array.isArray(value) && !value.length)) line(key, typeof value === 'string' ? value : JSON.stringify(value));
  if (lines.length) { const box = el('div', 'lists'); box.append(...lines); body.append(box); }
  if (event.note) body.append(rec.note = words('note', str(event.note)));
  if (slim) node.classList.add('slim');
  node.append(el('div', 't', rec.clock), body);
  return node;
};

// ---- The focus and the other filters. The rule of the focus is `focusOf` of `core.js`;
// here is what an event that stays by another's doing says of why.
const WHY = TXT.why;
let chosen = new Set(), places = new Set(), query = '', onlyHits = false, hits = [], current = -1;
const judge = rec => {
  const event = rec.e, focused = chosen.size > 0;
  let ok = !places.size || places.has(event.place), own = true, reason = null;
  if (ok && focused) { const kept = focusOf(event, chosen); ok = kept !== null; if (ok && !kept.own) { own = false; reason = `${WHY[kept.why]}: ${kept.ids.map(personName).join(', ')}`; } }
  if (ok && onlyHits && !rec.hit) ok = false;
  if (rec.shown !== ok) { rec.shown = ok; rec.el.hidden = !ok; }
  if (!ok) return;
  // Under a focus another's private note is not shown, nor what another's body felt: the focus is one's own side.
  const foreign = focused && !own;
  if (rec.note) rec.note.classList.toggle('off', foreign);
  for (const [of, row] of rec.feels) row.classList.toggle('off', focused && !chosen.has(of));
  if (reason !== null) { if (!rec.via) rec.head.append(rec.via = el('span', 'via')); rec.via.textContent = reason; rec.via.hidden = false; }
  else if (rec.via) rec.via.hidden = true;
};

// ---- The layout: one feed in the order of the file, or rows of story time with a cell for each side.
const feed = $('feed'), scroller = $('scroll');
const rows = new Map(), rowKeys = [];
let step = 60, items = [], itemsStale = true, lastTop = 0, follow = false, placed = false, fresh = 0;
// A stretch within a side: its events and usage rows, how far its file has been read (`at`, a byte), whether all
// that was there is loaded (`ready`), what the list says of it (`events`, `from`, `to`, `chapter`; `sig` and `seen`
// tell when it grew after it was loaded), and its place in the feed: a mark where it begins and its events under it.
const makePart = (one, name) => {
  const part = { name, side: one, recs: [], usage: [], own: true, at: 0, ready: false, loading: false, stale: false, failed: 0, sig: null, seen: null, events: 0, from: null, to: null, chapter: null,
    box: el('section', 'part'), mark: el('div', 'mark'), body: el('div'), about: el('span', 'quiet'), wait: el('span', 'quiet'), toChapter: el('button', 'link'), alone: el('button', 'link', TXT.onlyStretch) };
  part.toChapter.type = part.alone.type = 'button';
  part.toChapter.title = TXT.toChapterTitle;
  part.alone.title = TXT.aloneTitle;
  part.toChapter.addEventListener('click', () => openChapter(part.chapter));
  part.alone.addEventListener('click', () => { Object.assign(state, { s: part.name, solo: true, t: null }); writeHash(true); sync(); });
  part.mark.append(el('span', 'mark-name', name), part.about, part.wait, part.toChapter, part.alone);
  part.box.append(part.mark, part.body);
  return part;
};
const showMark = part => {
  const many = part.side.parts.length > 1, title = part.chapter === null ? '' : str(story.chapters.find(chapter => chapter.n === part.chapter)?.title);
  part.mark.hidden = !many && part.chapter === null;
  part.about.textContent = `${part.from !== null && part.to !== null ? `${clockAt(part.from, false)} – ${clockAt(part.to, false)} · ` : ''}${TXT.eventsN(number(Math.max(part.events, part.recs.length)))}`;
  part.wait.textContent = part.ready ? '' : TXT.loading;
  part.toChapter.hidden = part.chapter === null;
  part.toChapter.textContent = TXT.chapterLink(part.chapter, title);
  part.alone.hidden = !many;
};
// The side's events and usage rows, joined from its parts. The rows of a part without a usage file of its own are
// those of every usage file of the run: they are counted once.
const gather = one => {
  one.recs = one.parts.length === 1 ? one.parts[0].recs : [].concat(...one.parts.map(part => part.recs));
  const usage = [];
  let shared = false;
  for (const part of one.parts) { if (part.own || !shared) for (const row of part.usage) usage.push(row); if (!part.own && part.usage.length) shared = true; }
  one.usage = usage;
};
const comparing = () => state.cmp !== null;
const settle = () => { lastTop = scroller.scrollTop; };
// ---- Keeping a place. An event that is off the window has an estimated height until the browser renders it
// (`content-visibility`), so a place set by `offsetTop` is right only until the events near it take their real
// size; stretches that load above, marks that fill in and the bar of chips move it too. So a place is kept by an
// element and its offset from the top of the window: `pinTo` puts it there, and on every frame after that it is
// put back if it moved, until it has held still for `STILL` frames with everything loaded, or the reader scrolls.
// Every move the page makes itself is followed by `settle`, by which the scroll listener knows it from the
// reader's: only the reader's scroll rewrites the address.
const STILL = 8;
let pin = null, pinFramed = false;
const unpin = () => { pin = null; };
const pinStep = () => {
  pinFramed = false;
  if (!pin) return;
  if (follow || pin.el.hidden || pin.el.isConnected === false) { pin = null; return; }
  if (state.v === 'f') {
    const before = scroller.scrollTop, top = Math.max(0, pin.el.offsetTop - pin.offset);
    if (Math.abs(before - top) >= 1) { scroller.scrollTop = top; settle(); }
    pin.still = Math.abs(scroller.scrollTop - before) < 1 ? pin.still + 1 : 0;
    if (pin.still >= STILL && A.caught && (!comparing() || B.caught)) { pin = null; scheduleFrame(); return; }
  }
  pinFramed = true; requestAnimationFrame(pinStep);
};
const pinTo = (el, offset = headRoom()) => {
  scroller.scrollTop = Math.max(0, el.offsetTop - offset); settle();
  pin = { el, offset, still: 0 };
  if (!pinFramed) { pinFramed = true; requestAnimationFrame(pinStep); }
};
const toTop = () => { unpin(); scroller.scrollTop = 0; settle(); };
const bottom = () => { unpin(); scroller.scrollTop = scroller.scrollHeight; settle(); };
const STEPS = [10, 30, 60, 120, 300, 600, 1800, 3600, 10800, 86400];
const stepName = seconds => seconds < 60 ? `${seconds} ${TXT.seconds}` : seconds < 3600 ? `${seconds / 60} ${TXT.minutes}` : seconds < 86400 ? `${seconds / 3600} ${TXT.hours}` : TXT.wholeDay;
// A row holds about four events of a side when the page chooses its span.
const autoStep = () => {
  let events = 0, from = Infinity, to = -Infinity;
  for (const one of sides) if (one.recs.length) { events = Math.max(events, one.recs.length); from = Math.min(from, one.recs[0].T); to = Math.max(to, one.recs.at(-1).T); }
  if (events < 2 || !(to > from)) return 60;
  const wanted = (to - from) / events * 4;
  return STEPS.find(value => value >= wanted) ?? STEPS.at(-1);
};
const rowOf = key => {
  let row = rows.get(key);
  if (row) return row;
  row = { key, T: key * step, el: el('div', 'row'), a: el('div', 'cell'), b: el('div', 'cell'), n: 0 };
  const axis = el('div', 'axis');
  axis.append(el('span', '', clockAt(row.T, step < 60)));
  row.el.append(row.a, axis, row.b);
  row.el.hidden = true;
  rows.set(key, row);
  if (!rowKeys.length || key > rowKeys.at(-1)) { rowKeys.push(key); feed.append(row.el); }
  else {
    let low = 0, high = rowKeys.length;
    while (low < high) { const mid = (low + high) >> 1; if (rowKeys[mid] < key) low = mid + 1; else high = mid; }
    feed.insertBefore(row.el, rows.get(rowKeys[low]).el);
    rowKeys.splice(low, 0, key);
  }
  return row;
};
const intoRow = rec => { const row = rowOf(Math.floor(rec.T / step)); row[rec.side.key].append(rec.el); rec.row = row; if (rec.shown) { row.n += 1; if (row.el.hidden) row.el.hidden = false; } };
let cmpHead = null;
const relayout = () => {
  feed.replaceChildren();
  rows.clear(); rowKeys.length = 0;
  feed.classList.toggle('cmp', comparing());
  if (comparing()) {
    step = state.step || autoStep();
    feed.append(cmpHead = headOfCompare());
    for (const one of sides) for (const rec of one.recs) { rec.el.hidden = !rec.shown; intoRow(rec); }
  } else {
    cmpHead = null;
    for (const part of A.parts) {
      // After a comparison the events are in its rows: each part takes its own back.
      if (part.body.childElementCount !== part.recs.length) { const batch = document.createDocumentFragment(); for (const rec of part.recs) { rec.row = null; batch.append(rec.el); } part.body.replaceChildren(batch); }
      feed.append(part.box);
    }
  }
  itemsStale = stripStale = true;
  settle();
};
// What is in the page from top to bottom, without what a filter hides: the events of the feed, or the rows.
const shownItems = () => {
  if (itemsStale) { items = comparing() ? rowKeys.map(key => rows.get(key)).filter(row => !row.el.hidden) : A.recs.filter(rec => rec.shown); itemsStale = false; }
  return items;
};
// The index of the last item that starts at or above `y` of the scrolled content.
const itemAt = y => {
  const all = shownItems();
  let low = 0, high = all.length;
  while (low < high) { const mid = (low + high) >> 1; if (all[mid].el.offsetTop <= y) low = mid + 1; else high = mid; }
  return Math.max(0, low - 1);
};
const headRoom = () => cmpHead ? cmpHead.offsetHeight + 4 : 4;
// One pixel is allowed for: a scroll set to a whole number can be read back a fraction below it, and the item put at
// the top would then be taken for the one before it.
const topItem = () => { const all = shownItems(); return all.length ? all[itemAt(scroller.scrollTop + headRoom() + 1)] : null; };
// A part that is wanted before its turn: it is fetched next, and the page stands in it once it is there.
const awaitPart = (part, t) => { const one = part.side; one.pending = { name: part.name, t }; one.first = part.name; pinTo(part.box); pump(one); };
// To the story second `T` of what is shown: the first item at or after it.
const jumpTo = T => {
  if (!comparing()) { const part = A.parts[stretchAt(A.parts, T)]; if (part && !part.ready) { awaitPart(part, T); return; } }
  const all = shownItems();
  if (!all.length) return;
  pinTo(all[firstAt(all, T)].el);
};
// Within the feed of a world: to the moment `t` of one stretch (the first of its shown events at or after it), or
// to where the stretch begins.
const standIn = (part, t) => {
  const own = part && t !== null ? part.recs.filter(rec => rec.shown) : [];
  if (own.length) pinTo(own[firstAt(own, t)].el); else if (part) pinTo(part.box); else toTop();
};
// Where a link, a mark, a chapter or the picker points: the stretch `name` and the moment `t`, either or none.
const stand = (name, t) => {
  if (follow) setFollow(false);
  if (comparing()) { if (t !== null) jumpTo(t); else toTop(); }
  else {
    const plan = planOf({ s: name, t }, A.parts), part = A.parts.find(known => known.name === plan.stretch) ?? null;
    if (part && !part.ready) awaitPart(part, plan.t); else if (!A.placed) { A.pending = { name: plan.stretch, t: plan.t }; place(A); } else standIn(part, plan.t);
  }
  scheduleFrame();
};
// On the map the moment that was followed stays the chosen one when the following ends.
const setFollow = on => {
  if (!on && follow && state.v === 'm' && state.t === null) { state.t = worldSpan().to; writeHash(); }
  follow = on; $('follow').checked = on;
  if (on) { fresh = 0; state.t = null; bottom(); writeHash(); }
  showFresh(); showMoment();
};
const showFresh = () => { const pill = $('fresh'); pill.hidden = follow || fresh === 0 || state.v !== 'f'; if (!pill.hidden) pill.textContent = TXT.fresh(number(fresh)); };

let shownCount = 0, totalCount = 0;
const showShown = () => {
  $('shown').textContent = TXT.shown(number(shownCount), number(totalCount));
  $('empty').hidden = shownCount > 0;
  if (!shownCount) $('empty').textContent = totalCount ? TXT.emptyFiltered : A.gone ? TXT.emptyGone : TXT.emptyNone;
};
const applyFilters = keep => {
  const anchor = keep && !follow ? topItem() : null;
  chosen = new Set(state.who); places = new Set(state.place); onlyHits = state.only && query !== '';
  for (const row of rows.values()) row.n = 0;
  shownCount = totalCount = 0;
  for (const one of sides) for (const rec of one.recs) { judge(rec); totalCount += 1; if (rec.shown) { shownCount += 1; if (rec.row) rec.row.n += 1; } }
  for (const row of rows.values()) row.el.hidden = row.n === 0;
  itemsStale = stripStale = true;
  const on = chosen.size > 0 || places.size > 0 || query !== '';
  $('filters').classList.toggle('on', on);
  $('active').hidden = !on;
  showShown();
  collectHits();
  // The window stays on the event it stood on, or on the nearest one that is still shown.
  if (follow) bottom(); else if (anchor === null) settle(); else if (comparing() || !anchor.part) jumpTo(anchor.T);
  else {
    const at = A.recs.indexOf(anchor);
    let next = at, before = at;
    while (next !== -1 && next < A.recs.length && !A.recs[next].shown) next += 1;
    while (before >= 0 && !A.recs[before].shown) before -= 1;
    const item = A.recs[next] ?? A.recs[before] ?? null;
    if (item) pinTo(item.el); else settle();
  }
  scheduleFrame();
};

// ---- Search: the events whose text, note or lists hold the words are marked, and the words themselves are lit by
// the browser's highlights, which change no node of the page.
const hayOf = rec => rec.hay ??= norm(rec.texts.map(node => node.data).join('\n'));
const rangesOf = rec => {
  const found = [];
  for (const node of rec.texts) { const hay = norm(node.data); for (let at = hay.indexOf(query); at !== -1 && found.length < 50; at = hay.indexOf(query, at + query.length)) { const range = new Range(); range.setStart(node, at); range.setEnd(node, at + query.length); found.push(range); } }
  return found;
};
const collectHits = () => {
  hits = [];
  if (query !== '') for (const one of sides) for (const rec of one.recs) if (rec.hit && rec.shown) hits.push(rec);
  if (comparing()) hits.sort((one, other) => one.T - other.T);
  if (current >= hits.length) current = hits.length - 1;
  if (globalThis.Highlight && CSS.highlights) {
    const lit = new Highlight();
    for (const rec of hits.slice(0, 3000)) for (const range of rangesOf(rec)) lit.add(range);
    CSS.highlights.set('hit', lit);
    CSS.highlights.set('cur', new Highlight(...(current >= 0 ? rangesOf(hits[current]) : [])));
  }
  $('q-count').textContent = query === '' ? '' : hits.length ? current >= 0 ? TXT.countOf(number(current + 1), number(hits.length)) : number(hits.length) : TXT.noHits;
  for (const id of ['q-prev', 'q-next', 'q-only-box']) $(id).hidden = query === '';
};
const runSearch = () => {
  query = norm(state.q.trim());
  current = -1;
  for (const one of sides) for (const rec of one.recs) { const hit = query !== '' && hayOf(rec).includes(query); if (hit !== rec.hit) { rec.hit = hit; rec.el.classList.toggle('hit', hit); } }
  applyFilters(true);
};
const toHit = by => {
  if (!hits.length) return;
  current = (current + by + hits.length) % hits.length;
  if (current < 0) current = 0;
  const rec = hits[current];
  if (follow) setFollow(false);
  if (rec.fold) rec.fold.open = true;
  collectHits();
  unpin();
  rec.el.scrollIntoView({ block: 'center' });
  settle(); noteTop();
};

// ---- Opening a side on an experiment. Its last stretch comes as a stream, which goes on while the run grows it;
// every other stretch is asked for whole (`stretch?x=&s=&from=`), one at a time, the one the page stands in first.
let numbersStale = false, stripStale = true, countsStale = false;
const addEvents = (part, events) => {
  const one = part.side, inFeed = one === A && !comparing(), batch = inFeed ? document.createDocumentFragment() : null, live = part.ready && part === one.tail;
  // What is read stays where it is while a stretch above it arrives.
  const anchor = inFeed && one.placed && !follow && state.v === 'f' ? topItem() : null, was = anchor ? anchor.el.offsetTop - scroller.scrollTop : 0;
  let added = 0;
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    const T = timeOf(event, part.recs.at(-1)?.T ?? part.from ?? 0);
    const rec = { e: event, T, side: one, part, clock: secondsOf(event.clock) === null ? str(event.clock) : shortClock(T), shown: true, hit: false, row: null, hay: null };
    rec.el = build(rec);
    if (query !== '' && hayOf(rec).includes(query)) { rec.hit = true; rec.el.classList.add('hit'); }
    judge(rec);
    part.recs.push(rec);
    totalCount += 1;
    if (rec.shown) added += 1;
    if (batch) batch.append(rec.el); else if (comparing()) intoRow(rec);
  }
  if (batch) part.body.append(batch);
  gather(one);
  shownCount += added;
  showShown();
  itemsStale = stripStale = numbersStale = countsStale = true;
  // By the offset within the window, not by a height added: right whether or not the browser kept the place itself.
  if (anchor) { const top = anchor.el.offsetTop - was; if (Math.abs(top - scroller.scrollTop) >= 1) { scroller.scrollTop = top; settle(); } }
  if (chipsStale) renderChips();
  if (live) { if (follow) bottom(); else { fresh += added; showFresh(); } if (query !== '') collectHits(); }
  else if (follow) bottom();
  scheduleFrame();
};
const clearPart = part => {
  const had = part.recs.length > 0;
  Object.assign(part, { recs: [], usage: [], at: 0, ready: false });
  part.body.replaceChildren();
  gather(part.side);
  if (had) { if (comparing()) relayout(); applyFilters(false); }
};
// A part is loaded: the page takes its place if it waited for this one.
const partReady = part => {
  const one = part.side;
  Object.assign(part, { ready: true, loading: false, stale: false });
  showMark(part);
  if (one.pending && (one.pending.name === part.name || one.pending.name === null)) place(one);
  else if (query !== '') collectHits();
  if (!one.caught && one.parts.every(known => known.ready)) {
    one.caught = true;
    // The span of a compare row is chosen over all that is there.
    if (comparing() && !state.step && step !== autoStep()) { const at = follow ? null : topItem()?.T ?? null; relayout(); applyFilters(false); if (follow) bottom(); else if (at !== null) jumpTo(at); }
    performance.mark(`caught-${one.key}`);
  }
  numbersStale = countsStale = true;
  scheduleFrame();
  pump(one);
};
// The page takes its place where the link says, or where reading starts.
const place = one => {
  const { name, t } = one.pending;
  one.pending = null;
  if (comparing() && !state.step && step !== autoStep()) relayout();
  applyFilters(false);
  // An experiment with nothing in it yet is opened to wait for its run: the newest is followed from the start.
  if (one === A && !one.placed && state.t === null && !one.recs.length) { follow = true; $('follow').checked = true; }
  if (state.v === 'f' && (one === A || comparing())) {
    if (follow) bottom();
    else if (comparing()) { if (state.t !== null) jumpTo(state.t); else if (!one.placed) toTop(); }
    else standIn(one.parts.find(part => part.name === name) ?? null, t);
  }
  one.placed = true;
  if (one === A) placed = true;
  fresh = 0; showFresh();
  scheduleFrame();
};
// The next part that is not loaded, or that grew since it was, is asked for; one request at a time for a side.
const pump = one => {
  if (one.busy || one.x === null || one.gone || !one.named) return;
  const now = Date.now(), rank = part => { const at = one.order.indexOf(part.name); return part.name === one.first ? -1 : at === -1 ? one.order.length : at; };
  const part = one.parts.filter(known => known !== one.tail && (!known.ready || known.stale) && now - known.failed > 3000).sort((first, second) => rank(first) - rank(second))[0];
  if (!part) return;
  const gen = one.gen, sig = part.sig, failed = () => { part.failed = Date.now(); part.loading = false; };
  one.busy = true; part.loading = true;
  fetch(`stretch?x=${encodeURIComponent(one.x)}&s=${encodeURIComponent(part.name)}&from=${part.at}`, { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(piece => {
      if (one.gen !== gen) return;
      one.busy = false;
      if (!one.parts.includes(part) || part === one.tail) { part.loading = false; return; }
      if (piece === null || !Number.isInteger(piece.at)) { failed(); return; }
      // The file is another one than the one that was read: what was read of it goes.
      if (piece.from === 0 && part.at > 0) clearPart(part);
      Object.assign(part, { at: piece.at, usage: list(piece.usage?.rows), own: piece.usage?.own !== false });
      addEvents(part, list(piece.events));
      if (!piece.more) { part.seen = sig; partReady(part); }
    })
    .catch(() => { if (one.gen === gen) { one.busy = false; failed(); } })
    .finally(() => { if (one.gen === gen) setTimeout(() => pump(one), 0); });
};
// The stream of a side: its last part, or, while the experiment has no stretch, whichever comes.
const listen = (one, part) => {
  const old = one.tail;
  one.source?.close();
  // What the part listened to until now still grew by is asked for like any other's.
  if (old && old !== part) { old.stale = true; old.loading = false; }
  one.tail = part;
  const source = one.source = new EventSource(`stream?x=${encodeURIComponent(one.x)}${part === null ? '' : `&s=${encodeURIComponent(part.name)}`}`);
  const on = (name, handler) => source.addEventListener(name, message => { if (one.source !== source) return; try { handler(message.data ? JSON.parse(message.data) : null, message); } catch (error) { console.error(error); } });
  source.addEventListener('open', () => { if (one.source === source) { one.live = true; showLive(); } });
  source.addEventListener('error', () => { if (one.source === source) { one.live = false; showLive(); } });
  on('world', world => {
    const named = entries => new Map(list(entries).map(item => [str(item?.id), str(item?.name)]));
    one.names = { characters: named(world?.characters), places: named(world?.places) };
    if (one === A || !A.names.characters.size) { for (const id of one.names.characters.keys()) person(id); for (const id of one.names.places.keys()) spot(id); }
    renderChips();
    // The names are here: the stretches may be asked for and drawn, and the side beside this one may open.
    if (!one.named) { one.named = true; pump(one); if (one === A) syncParts(B); }
  });
  on('stretch', told => {
    const name = str(told.name);
    // The stream names another stretch than the one asked for: the first stretch of an experiment that had none.
    if (one.tail?.name !== name) {
      let known = one.parts.find(other => other.name === name) ?? null;
      if (!known) { known = makePart(one, name); one.parts.push(known); if (one === A && !comparing()) feed.append(known.box); for (const other of one.parts) showMark(other); }
      one.tail = known;
    }
    if (!told.resumed) clearPart(one.tail);
    one.tail.loading = true;
    showTop();
  });
  on('events', (events, message) => { if (!one.tail) return; if (/^\d+$/.test(message.lastEventId)) one.tail.at = Number(message.lastEventId); addEvents(one.tail, list(events)); });
  on('usage', told => {
    const known = one.tail;
    if (!known) return;
    if (told.reset) known.usage = [];
    known.own = told.own !== false;
    for (const row of list(told.rows)) known.usage.push(row);
    gather(one);
    numbersStale = countsStale = true; scheduleFrame();
  });
  on('caught', () => { if (one.tail) partReady(one.tail); else if (one.pending) place(one); });
  on('gone', () => { one.gone = true; source.close(); one.live = false; showLive(); applyFilters(false); if (one === A && !one.named) { one.named = true; syncParts(B); } });
};
// The parts of a side are brought to what the list says: a stretch that appeared joins the feed, the last one is
// the one listened to, and one that grew after it was loaded is asked for again from where its reading stopped.
const syncParts = one => {
  if (one.x === null || one.gone || (one === B && !A.named)) return;
  const listed = (found(one.x)?.stretches ?? []).filter(stretch => one.s === null || stretch.name === one.s), known = new Map(one.parts.map(part => [part.name, part]));
  // A stretch the stream told of before the list has it stays.
  if (one.tail && !listed.some(stretch => stretch.name === one.tail.name) && !listed.length) return;
  const next = listed.map(stretch => known.get(stretch.name) ?? makePart(one, stretch.name)), dropped = one.parts.filter(part => !next.includes(part));
  const changed = next.length !== one.parts.length || next.some((part, at) => part !== one.parts[at]);
  one.parts = next;
  listed.forEach((stretch, at) => {
    const part = next[at], sig = `${stretch.events}:${stretch.usage.requests}`;
    Object.assign(part, { events: stretch.events, from: stretch.from ?? null, to: stretch.to ?? null, chapter: stretch.chapter ?? null, sig });
    if (part.ready && part !== one.tail && part.seen !== sig) part.stale = true;
  });
  if (changed) {
    one.caught = false;
    gather(one);
    if (dropped.some(part => part.recs.length) && (one === A || comparing())) { relayout(); applyFilters(false); }
    else if (one === A && !comparing()) { for (const part of dropped) part.box.remove(); next.forEach((part, at) => { if (feed.children[at] !== part.box) feed.insertBefore(part.box, feed.children[at] ?? null); }); }
    itemsStale = stripStale = true;
  }
  for (const part of next) showMark(part);
  const last = next.at(-1) ?? null;
  if (last !== one.tail || one.source === null) listen(one, last);
  pump(one);
};
// `want` is where to stand, `{ s, t }` of the link.
const openSide = (one, x, s, want) => {
  one.source?.close();
  Object.assign(one, { x, s, source: null, gen: {}, parts: [], tail: null, order: [], first: null, pending: null, busy: false, recs: [], usage: [], named: false, caught: false, placed: false, live: false, gone: false, names: { characters: new Map(), places: new Map() } });
  if (x === null) return;
  const listed = (found(x)?.stretches ?? []).filter(stretch => s === null || stretch.name === s), plan = planOf(want, listed, one === A && follow);
  one.order = plan.order;
  one.pending = { name: plan.stretch, t: plan.t };
  syncParts(one);
};

// ---- The list of experiments, asked for again every few seconds. It is shown by group, a group being the path of
// a directory under the root, the group with the newest activity first; a part of a name typed above it narrows
// it; the rehearsals of a group are folded under one line until that line is clicked, and a click on a group's
// head folds the group. `ordered` is what is shown, from top to bottom.
let listing = { single: false, root: '', experiments: [] }, listed = false, ordered = [], narrowBy = '';
const cards = new Map(), heads = new Map(), folds = new Map(), unfolded = new Set(), closed = new Set();
const sizeOf = bytes => bytes < 1024 ? `${number(bytes)} ${TXT.bytes}` : `${compact.format(bytes)}B`;
const span = experiment => {
  let first = null, last = null;
  for (const stretch of experiment.stretches) { if (stretch.first && (!first || stretch.first.at < first.at)) first = stretch.first; if (stretch.last && (!last || stretch.last.at > last.at)) last = stretch.last; }
  const show = mark => { const T = secondsOf(mark.clock); return T === null ? str(mark.clock) : clockAt(T, false); };
  return first && last ? `${show(first)} – ${show(last)}` : null;
};
const metaLine = (box, pairs) => { box.replaceChildren(); pairs.forEach(([label, value], at) => { if (at) box.append(' · '); box.append(`${label} `, el('b', '', value)); }); };
// The card of one experiment, made once and brought up to what the list says of it now.
const cardOf = experiment => {
  let card = cards.get(experiment.id);
  if (!card) {
    const node = el('div', 'exp'), top = el('div', 'exp-top');
    card = { node, name: el('span', 'exp-name', str(experiment.name)), live: el('span', 'exp-live', TXT.running), kind: el('span', 'exp-kind'), mark: el('span', 'exp-side'), about: el('div', 'exp-about'), models: el('div', 'exp-meta'),
      counts: el('div', 'exp-meta'), compare: el('button', 'exp-cmp', TXT.compare) };
    top.append(card.name, card.live, card.kind, card.mark);
    node.append(top, card.about, card.models, card.counts, card.compare);
    node.tabIndex = 0;
    node.title = experiment.id;
    node.setAttribute('role', 'button');
    card.compare.type = 'button';
    const openIt = () => { choose(experiment.id); if (matchMedia('(max-width: 900px)').matches) document.body.classList.add('noside'); };
    node.addEventListener('click', openIt);
    node.addEventListener('keydown', event => { if (event.target === node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openIt(); } });
    card.compare.addEventListener('click', event => { event.stopPropagation(); compareWith(state.cmp === experiment.id ? null : experiment.id); });
    cards.set(experiment.id, card);
  }
  const isA = experiment.id === A.x, isB = experiment.id === state.cmp, events = experiment.stretches.reduce((sum, stretch) => sum + stretch.events, 0), textOnly = experiment.shape === 'text';
  card.node.classList.toggle('a', isA);
  card.node.classList.toggle('b', isB && !isA);
  card.node.classList.toggle('dry', experiment.rehearsal);
  card.live.hidden = !experiment.growing;
  card.kind.hidden = !textOnly && !experiment.rehearsal;
  card.kind.textContent = textOnly ? TXT.textOnly : TXT.rehearsal;
  card.mark.hidden = !(isB || (isA && comparing()));
  card.mark.textContent = isA && isB ? TXT.sideBoth : isA ? TXT.sideA : TXT.sideB;
  card.about.hidden = !experiment.about;
  card.about.textContent = experiment.about ?? '';
  card.models.hidden = !experiment.residents.length && !experiment.world.length;
  metaLine(card.models, [...(experiment.residents.length ? [[TXT.residents, experiment.residents.join(', ')]] : []), ...(experiment.world.length ? [[TXT.world, experiment.world.join(', ')]] : [])]);
  // A transcript alone has no clock and no events to count: its size, and the requests when their rows were kept.
  metaLine(card.counts, textOnly ? [[TXT.text.toLowerCase(), sizeOf(experiment.texts.reduce((sum, text) => sum + text.size, 0))], ...(experiment.usage.requests ? [[TXT.requests, number(experiment.usage.requests)]] : [])]
    : [...(span(experiment) ? [[TXT.clock, span(experiment)]] : []), ...(experiment.stretches.length > 1 ? [[TXT.stretches, number(experiment.stretches.length)]] : []), [TXT.events, number(events)], [TXT.requests, number(experiment.usage.requests)],
      ...(experiment.story?.chapters ? [[TXT.chapters, number(experiment.story.chapters)]] : [])]);
  card.compare.textContent = isB ? TXT.cmpRemove : isA ? TXT.cmpStretches : TXT.cmpWithOpen;
  // Two feeds are compared: an experiment without events has none, and the open one beside itself needs two stretches.
  card.compare.hidden = !isB && (!experiment.stretches.length || !(found(A.x)?.stretches.length) || (isA && experiment.stretches.length < 2));
  return card;
};
const renderList = () => {
  const box = $('list'), nodes = [], kept = listing.experiments.filter(experiment => narrowed(experiment.id, narrowBy)), all = grouped(kept), ids = new Set(listing.experiments.map(experiment => experiment.id));
  const toggler = (known, group, set, cls) => { let node = known.get(group); if (!node) { node = el('button', cls); node.type = 'button'; node.addEventListener('click', () => { if (set.has(group)) set.delete(group); else set.add(group); renderList(); }); known.set(group, node); } return node; };
  ordered = [];
  $('root').textContent = listing.single ? TXT.oneRun : listing.root;
  $('list-empty').hidden = kept.length > 0;
  $('list-empty').textContent = listing.experiments.length ? TXT.noMatch : TXT.listEmpty;
  for (const { group, runs, rehearsals } of all) {
    // While the list is narrowed, everything that stays is shown, whatever was folded.
    const folded = closed.has(group) && narrowBy === '', open = unfolded.has(group) || narrowBy !== '' || rehearsals.some(experiment => experiment.id === A.x || experiment.id === state.cmp);
    if (all.length > 1 || group !== '') { const head = toggler(heads, group, closed, 'grp'); head.replaceChildren(`${folded ? '▸' : '▾'} ${group || listing.root}`, el('span', 'n', number(runs.length + rehearsals.length))); nodes.push(head); }
    if (folded) continue;
    for (const experiment of runs) { nodes.push(cardOf(experiment).node); ordered.push(experiment); }
    if (!rehearsals.length) continue;
    const fold = toggler(folds, group, unfolded, 'fold');
    fold.textContent = `${open ? '▾' : '▸'} ${TXT.rehearsals(number(rehearsals.length))}`;
    nodes.push(fold);
    if (open) for (const experiment of rehearsals) { nodes.push(cardOf(experiment).node); ordered.push(experiment); }
  }
  nodes.forEach((node, at) => { if (box.children[at] !== node) box.insertBefore(node, box.children[at] ?? null); });
  while (box.children.length > nodes.length) box.lastChild.remove();
  for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
};
const found = id => listing.experiments.find(experiment => experiment.id === id) ?? null;
// An experiment of which only a transcript was kept: it opens as that text.
const textOnly = id => { const experiment = found(id); return experiment !== null && !experiment.stretches.length && experiment.texts.length > 0; };
const growing = one => found(one.x)?.stretches.some(stretch => stretch.growing && (one.s === null || stretch.name === one.s)) ?? false;
const refreshList = async () => {
  try {
    const response = await fetch('list', { cache: 'no-store' });
    if (!response.ok) throw new Error('list');
    listing = await response.json();
    if (!listed) { listed = true; if (listing.single || matchMedia('(max-width: 900px)').matches) document.body.classList.add('noside'); sync(true); }
    else for (const one of sides) syncParts(one);
    renderList(); showTop(); showLive(); loadStory(); loadTexts(); loadMap();
  } catch { showLive(true); }
};

// ---- The top of the page.
// `whole` puts the whole world before the names, for a side that may show either.
const fillSelect = (select, names, value, whole = false) => {
  const values = whole ? ['', ...names] : names;
  if ([...select.options].map(option => option.value).join('\n') !== values.join('\n')) { select.replaceChildren(); for (const name of values) { const option = el('option', '', name === '' ? TXT.wholeWorld : name); option.value = name; select.append(option); } }
  if (value !== null && values.includes(value)) select.value = value; else if (value === null && !whole) select.selectedIndex = -1;
  select.hidden = names.length < 2;
};
const stretchNames = id => found(id)?.stretches.map(stretch => stretch.name) ?? [];
// The stretch the window stands in, in the feed of a world.
const standing = () => A.s ?? (comparing() || state.v !== 'f' ? null : topItem()?.part.name ?? null);
const showTop = () => {
  $('name').textContent = A.x ?? '—';
  document.title = A.x === null ? TXT.title : TXT.titleOf(comparing() ? `${A.x} ⇄ ${state.cmp}` : A.x);
  const names = stretchNames(A.x);
  if (document.activeElement !== $('stretch')) fillSelect($('stretch'), names, A.s ?? (state.v === 'f' ? standing() ?? state.s : state.s));
  $('solo-box').hidden = names.length < 2;
  $('solo').checked = A.s !== null;
  if (cmpHead) fillSelect(cmpHead.pick, stretchNames(B.x), B.s ?? '', true);
  $('v-feed').setAttribute('aria-selected', String(state.v === 'f'));
  $('v-story').setAttribute('aria-selected', String(state.v === 's'));
  $('v-story').hidden = state.v !== 's' && !(found(A.x)?.story?.chapters > 0);
  $('v-text').setAttribute('aria-selected', String(state.v === 't'));
  $('v-text').hidden = state.v !== 't' && !(found(A.x)?.texts.length > 0);
  // An experiment that is a transcript alone has no feed to go to.
  $('v-feed').hidden = textOnly(A.x);
  $('v-numbers').hidden = textOnly(A.x);
  // The map is of a world file: an experiment that has none has no such view.
  $('v-map').setAttribute('aria-selected', String(state.v === 'm'));
  $('v-map').hidden = state.v !== 'm' && !found(A.x)?.map;
  $('v-numbers').setAttribute('aria-selected', String(state.v === 'n'));
};
let lost = false;
const showLive = down => {
  if (down !== undefined) lost = down;
  const mark = $('live'), broken = lost || (A.source !== null && !A.live && !A.gone);
  mark.className = broken ? 'off' : growing(A) ? 'on' : 'quiet';
  mark.textContent = broken ? TXT.noLink : growing(A) ? TXT.running : A.recs.length ? TXT.notGrowing : '';
  mark.title = broken ? TXT.noLinkTitle : growing(A) ? TXT.growingTitle : '';
};
const secondsText = ms => ms === null ? '—' : `${decimal((ms / 1000).toFixed(1))} ${TXT.seconds}`;
const shareOf = (part, whole) => whole > 0 ? `${Math.round(part / whole * 100)}%` : '—';
const showCounts = () => {
  let input = 0, cached = 0;
  for (const row of A.usage) { input += row.input; cached += row.cached; }
  const ready = A.parts.filter(part => part.ready).length;
  $('counts').textContent = textOnly(A.x) ? '' : `${ready < A.parts.length && A.parts.length > 1 ? `${TXT.loaded(ready, A.parts.length)} · ` : ''}${TXT.events} ${number(A.recs.length)} · ${TXT.requests} ${number(A.usage.length)} · ${TXT.fromCache} ${shareOf(cached, input)} · ${TXT.answer} ${secondsText(median(A.usage.filter(row => row.ms !== null).map(row => row.ms)))}`;
};
const renderChips = () => {
  chipsStale = false;
  const chip = (box, id, name, key, pressed, tones, toggle) => {
    const node = el('button', 'chip');
    node.type = 'button';
    if (tones !== null) node.append(el('span', `dot ${tones}`));
    node.append(el('span', '', name));
    if (key) { node.append(el('span', 'num', key)); node.title = TXT.keyTitle(key); }
    node.setAttribute('aria-pressed', String(pressed));
    node.addEventListener('click', toggle);
    box.append(node);
  };
  const who = $('who'), where = $('where');
  who.replaceChildren(); where.replaceChildren();
  // A filter of the link that names nobody of this world is shown too, so that it can be seen and taken off.
  const ids = [...people.keys(), ...state.who.filter(id => !people.has(id))], spotsNow = [...spots.keys(), ...state.place.filter(id => !spots.has(id))];
  ids.forEach((id, at) => chip(who, id, personName(id), at < 9 ? String(at + 1) : '', state.who.includes(id), tone(id) || 'p0', () => toggle('who', id)));
  spotsNow.forEach(id => chip(where, id, placeName(id), '', state.place.includes(id), null, () => toggle('place', id)));
  who.parentElement.hidden = !ids.length;
  where.parentElement.hidden = !spotsNow.length;
};

// ---- The whole run at the side: time runs down, a lane a character, a mark as long as the speech or the deed
// lasted. The frame is what the window shows. With two experiments each has its half, on one axis.
const stripBox = $('strip-box'), canvas = $('strip'), lanes = document.createElement('canvas');
let stripFrom = 0, stripTo = 1;
const cssColour = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const drawLanes = () => {
  const ratio = devicePixelRatio || 1, width = stripBox.clientWidth, height = stripBox.clientHeight;
  for (const one of [canvas, lanes]) { one.width = Math.max(1, Math.round(width * ratio)); one.height = Math.max(1, Math.round(height * ratio)); }
  const pen = lanes.getContext('2d');
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
  pen.clearRect(0, 0, width, height);
  let from = Infinity, to = -Infinity;
  const used = comparing() ? sides : [A];
  for (const one of used) if (one.recs.length) { from = Math.min(from, one.recs[0].T); const last = one.recs.at(-1); to = Math.max(to, last.T + (last.e.seconds > 0 ? last.e.seconds : 0)); }
  // The stretches that are not loaded yet have their span from the list: the strip is of the whole world at once.
  for (const one of used) for (const part of one.parts) if (part.from !== null && part.to !== null) { from = Math.min(from, part.from); to = Math.max(to, part.to); }
  if (!(to > from)) { stripFrom = 0; stripTo = 1; return; }
  stripFrom = from; stripTo = to;
  const labels = width >= 60 ? 36 : 0, pad = 6, scale = (height - pad * 2) / (to - from), y = T => pad + (T - from) * scale;
  // The marks of the hours, or of what fits.
  const tick = [60, 300, 600, 1800, 3600, 10800, 21600, 86400, 172800, 604800].find(value => value * scale >= 44) ?? 2592000;
  pen.font = '10px system-ui, sans-serif'; pen.textBaseline = 'middle';
  for (let T = Math.ceil(from / tick) * tick; T <= to; T += tick) {
    pen.fillStyle = cssColour('--line'); pen.fillRect(labels ? labels - 4 : 0, Math.round(y(T)), width, 1);
    if (labels) { pen.fillStyle = cssColour('--soft'); pen.fillText(tick >= 86400 ? `${TXT.dayShort}${Math.floor(T / 86400) + 1}` : clockAt(T, false).replace(DAY_HEAD, ''), 3, y(T)); }
  }
  // Where a stretch of the world begins: a rule across the lanes.
  if (!comparing() && A.parts.length > 1) { pen.fillStyle = cssColour('--accent'); pen.globalAlpha = 0.55; for (const part of A.parts.slice(1)) if (part.from !== null) pen.fillRect(0, Math.round(y(part.from)), width, 1); pen.globalAlpha = 1; }
  const tones = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(index => cssColour(`--c${index}`));
  const count = Math.max(1, Math.min(people.size, 12)), area = width - labels - 4, half = used.length > 1 ? (area - 4) / 2 : area, lane = half / count;
  used.forEach((one, at) => {
    const left = labels + at * (half + 4);
    if (at) { pen.fillStyle = cssColour('--line'); pen.fillRect(left - 2.5, 0, 1, height); }
    for (const rec of one.recs) {
      const kind = rec.e.kind;
      if (!['say', 'call', 'do', 'go', 'sleep'].includes(kind)) continue;
      const index = people.get(rec.e.who)?.index ?? 0, deed = kind !== 'say' && kind !== 'call';
      // A deed fills its lane, a speech is a narrower mark, a walk or a sleep a faint thread.
      const thread = kind === 'go' || kind === 'sleep';
      pen.globalAlpha = (rec.shown ? 1 : 0.16) * (thread ? 0.5 : 1);
      pen.fillStyle = tones[index < 8 ? index + 1 : 0];
      const x = left + (Math.min(index, count - 1)) * lane, wide = Math.max(2, lane - 1.5), breadth = thread ? 1.5 : deed ? wide : Math.max(1.5, wide * 0.45);
      pen.fillRect(x + (wide - breadth) / 2, y(rec.T), breadth, Math.max(1.5, (rec.e.seconds > 0 ? rec.e.seconds : 0) * scale));
    }
    pen.globalAlpha = 1;
  });
};
const drawStrip = () => {
  if (stripStale) { drawLanes(); stripStale = false; }
  const ratio = devicePixelRatio || 1, width = stripBox.clientWidth, height = stripBox.clientHeight, pen = canvas.getContext('2d');
  pen.setTransform(1, 0, 0, 1, 0, 0);
  pen.clearRect(0, 0, canvas.width, canvas.height);
  pen.drawImage(lanes, 0, 0);
  const all = shownItems();
  if (!all.length || !(stripTo > stripFrom)) return;
  const first = all[itemAt(scroller.scrollTop + headRoom())], last = all[itemAt(scroller.scrollTop + scroller.clientHeight - 1)];
  const scale = (height - 12) / (stripTo - stripFrom), top = 6 + (first.T - stripFrom) * scale, end = 6 + ((last.T ?? first.T) + (comparing() ? step : last.e?.seconds > 0 ? last.e.seconds : 0) - stripFrom) * scale;
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
  pen.fillStyle = cssColour('--ink'); pen.globalAlpha = 0.1;
  pen.fillRect(0, top - 2, width, Math.max(6, end - top + 4));
  pen.globalAlpha = 1; pen.strokeStyle = cssColour('--accent'); pen.lineWidth = 1.5;
  pen.strokeRect(0.75, top - 2, width - 1.5, Math.max(6, end - top + 4));
};
const stripTime = event => { const box = stripBox.getBoundingClientRect(), y = Math.min(box.height - 6, Math.max(6, event.clientY - box.top)); return { y, T: stripFrom + (y - 6) / Math.max(1, box.height - 12) * (stripTo - stripFrom) }; };
let dragging = false;
const stripMove = event => {
  if (!(stripTo > stripFrom)) return;
  const { y, T } = stripTime(event), tip = $('strip-tip');
  tip.hidden = false; tip.style.top = `${y}px`; tip.textContent = clockAt(T, stripTo - stripFrom < 7200);
  if (dragging) { if (follow) setFollow(false); jumpTo(T); noteTop(); scheduleFrame(); }
};
stripBox.addEventListener('pointerdown', event => { dragging = true; stripBox.setPointerCapture(event.pointerId); stripMove(event); });
stripBox.addEventListener('pointermove', stripMove);
stripBox.addEventListener('pointerup', () => { dragging = false; });
stripBox.addEventListener('pointercancel', () => { dragging = false; });
stripBox.addEventListener('pointerleave', () => { if (!dragging) $('strip-tip').hidden = true; });

// ---- One frame of upkeep after anything changed: the clock, the strip of the time, the counts, the numbers.
let framed = false, hashTimer = null;
const frame = () => {
  framed = false;
  const all = shownItems();
  if (state.v === 'f') {
    if (all.length) {
      const last = all[itemAt(scroller.scrollTop + scroller.clientHeight - 1)], picker = $('stretch');
      $('clock').textContent = comparing() ? clockAt(last.T, step < 60) : secondsOf(last.e.clock) === null ? str(last.e.clock) : clockAt(last.T);
      // The picker names the stretch the window stands in.
      if (A.s === null && !comparing() && document.activeElement !== picker) { const name = topItem().part.name; if (picker.value !== name) picker.value = name; }
    } else $('clock').textContent = '—';
    drawStrip();
  }
  if (countsStale) { countsStale = false; showCounts(); showLive(); }
  if (numbersStale && state.v === 'n') { numbersStale = false; renderNumbers(); }
};
// A window that is not seen gets no animation frames: there a timer does the upkeep.
const scheduleFrame = () => { if (!framed) { framed = true; if (document.hidden) setTimeout(frame, 60); else requestAnimationFrame(frame); } };
document.addEventListener('visibilitychange', () => { framed = false; scheduleFrame(); });
// The link keeps the moment at the top of the window, and in the feed of a world the stretch it is in. It is
// written a moment after the reader stopped, and not while a place is still being kept.
const noteTop = () => {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (pin) { noteTop(); return; }
    const item = topItem();
    if (follow || !item || state.v !== 'f' || A.pending) return;
    state.t = scroller.scrollTop < 12 ? null : item.T;
    if (A.s === null && !comparing()) state.s = state.t === null ? null : item.part.name;
    writeHash();
  }, 400);
};
scroller.addEventListener('scroll', () => {
  // A move the page made itself was followed by `settle`: the top is where it left it.
  const top = scroller.scrollTop, own = Math.abs(top - lastTop) >= 1;
  lastTop = top;
  if (!follow && scroller.scrollHeight - top - scroller.clientHeight < 4 && fresh) { fresh = 0; showFresh(); }
  if (own && placed && !follow && !pin) noteTop();
  scheduleFrame();
}, { passive: true });
// Someone took the window up to read: the newest is no longer chased. Only a hand does this (the wheel, a finger, a
// key, the scroll bar), never a page that changed its own height.
const reading = () => { if (follow) setFollow(false); };
// And the reader's hand ends the keeping of a place: from here the window is theirs.
scroller.addEventListener('wheel', event => { unpin(); if (event.deltaY < 0) reading(); }, { passive: true });
scroller.addEventListener('touchmove', () => { unpin(); reading(); }, { passive: true });
scroller.addEventListener('pointerdown', event => { if (event.target === scroller) unpin(); if (event.target === scroller && event.offsetX >= scroller.clientWidth) reading(); });
scroller.addEventListener('keydown', event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) reading(); });
addEventListener('keydown', unpin, true);
new ResizeObserver(() => { stripStale = true; scheduleFrame(); }).observe(stripBox);

// ---- The head of a comparison: the two names, the span of a row, a way out.
const headOfCompare = () => {
  const head = el('div', 'cmp-head'), left = el('div', 'side'), mid = el('div', 'mid'), right = el('div', 'side'), pick = el('select'), steps = el('select'), close = el('button', 'icon small', '✕');
  left.append(el('span', 'exp-side', TXT.sideA), el('b', '', `${A.x ?? ''}${A.s === null ? '' : ` · ${A.s}`}`));
  right.append(el('span', 'exp-side', TXT.sideB), el('b', '', state.cmp ?? ''), pick, close);
  pick.title = TXT.rightStretch; steps.title = TXT.rowSpan; close.title = TXT.cmpClose; close.type = 'button';
  for (const value of [0, ...STEPS]) { const option = el('option', '', value ? stepName(value) : `${TXT.auto} · ${stepName(state.step ? autoStep() : step)}`); option.value = String(value); steps.append(option); }
  steps.value = String(state.step);
  steps.addEventListener('change', () => { state.step = Number(steps.value); writeHash(); const at = shownItems().length ? shownItems()[itemAt(scroller.scrollTop + headRoom())].T : null; relayout(); applyFilters(false); if (at !== null && !follow) jumpTo(at); });
  pick.addEventListener('change', () => { state.cs = pick.value || null; writeHash(); sync(); });
  close.addEventListener('click', () => compareWith(null));
  mid.append(steps);
  head.append(left, mid, right);
  head.pick = pick;
  fillSelect(pick, stretchNames(B.x), B.s ?? '', true);
  return head;
};

// ---- The numbers of an experiment: its usage rows by kind and by character, and the share read from the cache
// as the run went.
const KINDS = Object.entries(TXT.kinds);
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attributes, text) => { const node = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attributes ?? {})) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node; };
const table = (heads, lines) => {
  const wrap = el('div', 'scroll-x'), node = el('table', 'data'), head = el('thead'), body = el('tbody'), top = el('tr');
  for (const name of heads) top.append(el('th', '', name));
  head.append(top);
  for (const cells of lines) { const line = el('tr', cells.sum ? 'sum' : ''); cells.forEach((cell, at) => { const box = el('td', cell?.cls ?? '', cell?.text ?? cell); if (at === 0 && cell?.tone) box.prepend(el('span', `dot ${cell.tone}`), ' '); line.append(box); }); body.append(line); }
  node.append(head, body); wrap.append(node);
  return wrap;
};
const chartOf = cache => {
  const box = el('div', 'chart'), points = cache.points;
  if (cache.requests < 8) { box.append(el('div', 'quiet', TXT.fewRequests)); return box; }
  const series = [['all', TXT.allRequests, 'all', ''], ['turn', TXT.kinds.turn, '', 'p1'], ['world', TXT.kinds.world, '', 'p2']];
  const legend = el('div', 'legend');
  for (const [, name, cls, tones] of series) { const item = el('span', tones), key = el('i'); if (cls) key.style.background = 'var(--soft)'; item.append(key, name); legend.append(item); }
  const W = 640, H = 190, L = 34, R = 12, T = 8, Bm = 22, x = at => L + (points.length === 1 ? 0 : at / (points.length - 1) * (W - L - R)), y = value => T + (1 - value) * (H - T - Bm);
  const picture = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': TXT.chartLabel });
  for (const value of [0, 0.5, 1]) { picture.append(svg('line', { class: 'grid', x1: L, x2: W - R, y1: y(value), y2: y(value) }), svg('text', { x: L - 6, y: y(value) + 4, 'text-anchor': 'end' }, `${value * 100}%`)); }
  picture.append(svg('text', { x: L, y: H - 5 }, TXT.requestN(1)), svg('text', { x: W - R, y: H - 5, 'text-anchor': 'end' }, TXT.requestN(number(cache.requests))));
  for (const [key, , cls, tones] of series) {
    let path = '', pen = false, lastAt = -1;
    points.forEach((point, at) => { if (point[key] === null) return; path += `${pen ? 'L' : 'M'}${x(at).toFixed(1)} ${y(point[key]).toFixed(1)}`; pen = true; lastAt = at; });
    if (lastAt < 0) continue;
    const group = svg('g', { class: tones });
    group.append(svg('path', { class: `series ${cls}`, d: path }));
    if (!cls) group.append(svg('circle', { class: 'end', cx: x(lastAt), cy: y(points[lastAt][key]), r: 4 }));
    picture.append(group);
  }
  const cross = svg('line', { class: 'cross', y1: T, y2: H - Bm, visibility: 'hidden' }), tip = el('div', 'tip');
  picture.append(cross);
  tip.hidden = true;
  const percent = value => value === null ? '—' : `${Math.round(value * 100)}%`;
  picture.addEventListener('pointermove', event => {
    const bounds = picture.getBoundingClientRect(), at = Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * W - L) / (W - L - R) * (points.length - 1)))), point = points[at];
    cross.setAttribute('x1', x(at)); cross.setAttribute('x2', x(at)); cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = TXT.chartTip(number(point.from), number(point.to), percent(point.all), percent(point.turn), percent(point.world));
    const leftSide = x(at) / W > 0.5;
    tip.style.left = leftSide ? '' : `${x(at) / W * 100}%`; tip.style.right = leftSide ? `${(1 - x(at) / W) * 100}%` : '';
  });
  picture.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  box.append(legend, picture, tip);
  return box;
};
const share = value => value === null ? '—' : `${Math.round(value * 100)}%`;
const numbersOf = one => {
  const column = el('div', 'num-col'), { all, kinds, who, cache } = numbersIn(one.usage, one.recs.map(rec => rec.e), [...people.keys()]);
  const ready = one.parts.filter(part => part.ready).length;
  column.append(el('h2', '', `${one.x}${one.s ? ` · ${one.s}` : one.parts.length > 1 ? ` · ${TXT.wholeWorld}` : ''}`));
  const from = one.recs[0], to = one.recs.at(-1);
  column.append(el('div', 'quiet', `${from ? `${TXT.storyClock} ${from.clock} – ${to.clock} · ` : ''}${TXT.eventsN(number(one.recs.length))}${ready < one.parts.length ? ` · ${TXT.notWhole(ready, one.parts.length)}` : ''}`));
  const tiles = el('div', 'tiles');
  const tile = (name, value, title) => { const box = el('div', 'tile'); box.append(el('div', 'k', name), el('div', 'v', value)); if (title) box.title = title; tiles.append(box); };
  tile(TXT.tRequests, number(all.requests));
  tile(TXT.tInput, compact.format(all.input), number(all.input));
  tile(TXT.tCache, share(all.cachedShare), TXT.countOf(number(all.cached), number(all.input)));
  tile(TXT.tOutput, compact.format(all.output), number(all.output));
  tile(TXT.tReasoning, compact.format(all.reasoning), number(all.reasoning));
  tile(TXT.tAnswer, secondsText(all.medianMs));
  // The failures, and under the pointer how many of each code: a code is one of the engine's own words.
  const codes = new Map();
  for (const row of one.usage) if (row.failed) codes.set(str(row.code) || '?', (codes.get(str(row.code) || '?') ?? 0) + 1);
  if (all.failed) tile(TXT.tFailures, number(all.failed), [...codes].map(([code, count]) => `${code} ${number(count)}`).join(', '));
  column.append(tiles);
  if (!one.usage.length) { column.append(el('p', 'quiet', one.s === null && one.parts.length > 1 ? TXT.noUsageWorld : TXT.noUsageStretch)); return column; }
  column.append(el('h3', '', TXT.byKind));
  const kindLine = (name, known, sum) => Object.assign([name, number(known.requests), number(known.input), share(known.cachedShare), number(known.output), number(known.reasoning), secondsText(known.medianMs), { text: known.models.join(', ') || '—', cls: 'model' }], { sum });
  column.append(table(['', TXT.requests, TXT.input, TXT.fromCache, TXT.output, TXT.reasoning, TXT.median, TXT.model],
    [...kinds.map(known => kindLine(KINDS.find(([key]) => key === known.kind)?.[1] ?? known.kind, known)), kindLine(TXT.total, all, true)]));
  column.append(el('h3', '', TXT.cacheShare), chartOf(cache));
  column.append(el('h3', '', TXT.byCharacter));
  column.append(table(['', TXT.speeches, TXT.deeds, TXT.walks, TXT.notes, TXT.turns, TXT.memory, TXT.input, TXT.fromCache, TXT.output, TXT.median],
    who.map(known => [{ text: personName(known.id), tone: tone(known.id) || 'p0' }, number(known.says), number(known.deeds), number(known.moves), number(known.notes), number(known.turns), number(known.memories), number(known.input), share(known.cachedShare), number(known.output), secondsText(known.medianMs)])));
  const experiment = found(one.x);
  if (experiment && experiment.stretches.length > 1) {
    column.append(el('h3', '', TXT.stretchesOf));
    const total = { events: 0, requests: 0, input: 0, cached: 0, output: 0 };
    const lines = experiment.stretches.map(stretch => { total.events += stretch.events; for (const key of ['requests', 'input', 'cached', 'output']) total[key] += stretch.usage[key];
      return [stretch.name, stretch.first && stretch.last ? `${str(stretch.first.clock)} – ${str(stretch.last.clock)}` : '—', number(stretch.events), number(stretch.usage.requests), number(stretch.usage.input), shareOf(stretch.usage.cached, stretch.usage.input), number(stretch.usage.output)]; });
    lines.push(Object.assign([TXT.total, '', number(total.events), number(total.requests), number(total.input), shareOf(total.cached, total.input), number(total.output)], { sum: true }));
    column.append(table(['', TXT.storyClock, TXT.events, TXT.requests, TXT.input, TXT.fromCache, TXT.output], lines));
  }
  return column;
};
const renderNumbers = () => {
  const box = el('div', 'num-cols');
  box.append(numbersOf(A));
  if (comparing()) box.append(numbersOf(B));
  $('numbers').replaceChildren(box);
};

// ---- The story: the chapters a narrator wrote of the world, each retelling one stretch or several, as prose to
// read. From a chapter one goes to its stretches in the feed, and from where a stretch begins in the feed to its
// chapter.
const storyBox = $('story');
const toFeed = name => { Object.assign(state, { v: 'f', s: name, t: null, solo: false }); if (comparing()) Object.assign(state, { cmp: null, cs: null, step: 0 }); follow = false; $('follow').checked = false; writeHash(true); sync(true); };
const openChapter = n => { Object.assign(state, { v: 's', ch: n }); writeHash(true); sync(true); };
const chapterNode = n => [...storyBox.querySelectorAll('article')].find(node => node.dataset.n === String(n)) ?? null;
const renderStory = () => {
  const column = el('div', 'story'), names = stretchNames(A.x), chapters = story.x === A.x ? story.chapters : [], kept = storyBox.scrollTop;
  const link = (name, first) => { const node = el('button', 'link', first ? TXT.toFeed(name) : name); node.type = 'button'; node.title = TXT.toFeedTitle(name); node.addEventListener('click', () => toFeed(name)); return node; };
  const retold = new Set(chapters.flatMap(chapter => list(chapter.stretches)));
  column.append(el('h2', '', A.x ?? '—'));
  column.append(el('div', 'quiet', chapters.length ? TXT.storyCount(number(chapters.length), number(names.filter(name => retold.has(name)).length), number(names.length)) : story.loading ? TXT.chaptersLoading : TXT.noChapters));
  for (const chapter of chapters) {
    const node = el('article', 'chapter'), from = el('div', 'ch-from'), told = list(chapter.stretches).map(str);
    node.dataset.n = String(chapter.n);
    node.append(el('div', 'ch-n', TXT.chapter(str(chapter.n))), el('h3', '', str(chapter.title) || TXT.chapter(str(chapter.n))));
    if (chapter.span) node.append(el('div', 'ch-span', str(chapter.span)));
    // A stretch the chapter names and the run does not have is named still, without a way to it.
    told.forEach((name, at) => { if (names.includes(name)) from.append(link(name, !told.slice(0, at).some(other => names.includes(other)))); else { const gone = el('span', 'gone', name); gone.title = TXT.noSuchStretch; from.append(gone); } });
    if (told.length) node.append(from);
    for (const paragraph of str(chapter.text).split(/\r?\n(?:[ \t]*\r?\n)+/)) if (paragraph.trim() !== '') node.append(el('p', '', paragraph.trim()));
    if (chapter.model) node.append(el('div', 'ch-model', TXT.retoldBy(str(chapter.model))));
    column.append(node);
  }
  const untold = names.filter(name => !retold.has(name));
  if (chapters.length && untold.length) { const rest = el('div', 'ch-from untold'); rest.append(el('span', 'quiet', TXT.untold), ...untold.map(name => link(name, false))); column.append(rest); }
  storyBox.replaceChildren(column);
  storyBox.scrollTop = kept;
};
const scrollStory = () => { const node = state.ch === null ? null : chapterNode(state.ch); storyBox.scrollTop = node ? Math.max(0, node.offsetTop - 8) : 0; };
// The chapters are asked for when the experiment is opened and again when the list says they changed.
const loadStory = () => {
  const x = A.x, told = found(x)?.story;
  if (x === null || !told) return;
  const key = `${told.chapters}:${told.modified}`;
  if (story.loading || (story.x === x && story.key === key)) return;
  if (story.x !== x) story = { x, key: null, chapters: [], loading: false };
  story.loading = true;
  fetch(`story?x=${encodeURIComponent(x)}`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(got => {
    story.loading = false;
    if (got === null || A.x !== x) return;
    const first = story.key === null;
    story = { x, key, chapters: list(got.chapters).filter(chapter => chapter !== null && typeof chapter === 'object'), loading: false };
    renderStory();
    if (first && state.v === 's') scrollStory();
    for (const part of A.parts) showMark(part);
  }).catch(() => { story.loading = false; });
};
let storyTimer = null;
storyBox.addEventListener('scroll', () => {
  clearTimeout(storyTimer);
  storyTimer = setTimeout(() => {
    if (state.v !== 's') return;
    const top = storyBox.scrollTop, at = [...storyBox.querySelectorAll('article')].find(node => node.offsetTop + node.offsetHeight > top + 12);
    state.ch = top < 12 || !at ? null : Number(at.dataset.n) || null;
    writeHash();
  }, 400);
}, { passive: true });

// ---- The transcript: the run as the command line printed it, as plain text. It is all there is to show of an
// experiment that kept no events, and for any other a second way to read it. Each transcript of the experiment is
// asked for piece by piece (`text?x=&n=&from=`), from the byte where its reading stopped, and added as text.
const textBox = $('text');
let texts = { x: null, parts: new Map(), column: null, about: null };
const pumpText = (x, name, part) => {
  if (part.busy) return;
  part.busy = true;
  fetch(`text?x=${encodeURIComponent(x)}&n=${encodeURIComponent(name)}&from=${part.at}`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(piece => {
    part.busy = false;
    if (texts.x !== x || piece === null || !Number.isInteger(piece.at)) return;
    // The file is another one than the one that was read: what was read of it goes.
    if (piece.from === 0 && part.at > 0) part.pre.replaceChildren();
    part.pre.append(str(piece.text));
    part.at = piece.at;
    if (piece.more) pumpText(x, name, part);
  }).catch(() => { part.busy = false; });
};
const loadTexts = () => {
  const x = A.x, experiment = found(x);
  if (state.v !== 't' || x === null) return;
  if (texts.x !== x) {
    texts = { x, parts: new Map(), column: el('div', 'text'), about: el('div', 'quiet') };
    texts.column.append(el('h2', '', x), texts.about);
    textBox.replaceChildren(texts.column);
    textBox.scrollTop = 0;
  }
  const listed = experiment?.texts ?? [], usage = experiment?.usage;
  texts.about.textContent = !listed.length ? TXT.noText : !textOnly(x) ? ''
    : `${TXT.textOnlyNote}${usage?.requests ? ` ${TXT.requests} ${number(usage.requests)} · ${TXT.input} ${number(usage.input)} · ${TXT.fromCache} ${shareOf(usage.cached, usage.input)} · ${TXT.output} ${number(usage.output)}` : ''}`;
  for (const { name, size } of listed) {
    let part = texts.parts.get(name);
    if (!part) { part = { head: el('h3'), pre: el('pre'), at: 0, busy: false }; texts.parts.set(name, part); texts.column.append(part.head, part.pre); }
    part.head.textContent = `${name} · ${sizeOf(size)}`;
    // A transcript that grew, or became another file, is read on from where its reading stopped.
    if (part.at !== size) pumpText(x, name, part);
  }
};

// ---- The map: the places of the world file, each group of near places to a scale of its own, and everyone where
// it is at a moment (`map.js` lays it out and draws it). What it is drawn from is asked for when the view is opened
// and again when the list says that the experiment grew or its world file changed (`map?x=`): the map's part of
// the world file and the moves of every stretch, which the server reads from the events, so that no event has to
// be in the page for it. The moment is `t` of the link, the newest one while the newest is followed, and with
// neither the first of the world.
// `land` is what was loaded for the open experiment and what was drawn of it; `hot` is the place pointed at.
const mapScroll = $('map-scroll'), mapSvg = $('map-svg');
const noLand = x => ({ x, key: null, loading: false, world: null, text: '', moves: [], moments: [], both: null, layout: null, places: new Map(), marks: null, hot: null });
let land = noLand(null), momentTimer = null;
const svgOf = ([tag, attributes, ...children]) => { const node = svg(tag, attributes); for (const child of children) node.append(typeof child === 'string' ? child : svgOf(child)); return node; };
const mapWords = { span: seconds => duration(seconds), due: (to, until) => TXT.mapDue(to, clockAt(until, false).replace(DAY_HEAD, '')), many: count => TXT.mapMany(count) };
const landPerson = id => land.world?.characters.find(one => one.id === id)?.name ?? personName(id);
const landPlace = id => land.world?.places.find(one => one.id === id)?.name ?? placeName(id);
const landWhere = T => whereAt(land.world.characters, land.moves, T, (found(A.x)?.stretches.find(stretch => stretch.first != null)?.first.at ?? 0) === 0);
// The span of the whole world, as the list gives it for the stretches.
const worldSpan = () => {
  let from = Infinity, to = -Infinity;
  for (const stretch of found(A.x)?.stretches ?? []) if (stretch.from != null && stretch.to != null) { from = Math.min(from, stretch.from); to = Math.max(to, stretch.to); }
  return to >= from ? { from, to } : { from: 0, to: 0 };
};
const momentNow = () => { const { from, to } = worldSpan(); return follow ? to : Math.min(to, Math.max(from, state.t ?? from)); };
const loadMap = () => {
  const x = A.x, experiment = found(x);
  if (state.v !== 'm' || x === null || !experiment?.map) return;
  if (land.x !== x) { land = noLand(x); mapSvg.replaceChildren(); }
  const mine = land, key = `${experiment.mapKey}:${experiment.stretches.reduce((sum, stretch) => sum + stretch.events, 0)}`;
  if (mine.loading || mine.key === key) return;
  mine.loading = true;
  fetch(`map?x=${encodeURIComponent(x)}`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(got => {
    mine.loading = false;
    if (land !== mine || got === null || got.world === null || typeof got.world !== 'object') return;
    // The places are laid out anew only when the world file is another one than the one that is drawn.
    const text = JSON.stringify(got.world);
    if (text !== mine.text) Object.assign(mine, { world: got.world, text, both: null, layout: null });
    mine.moves = list(got.stretches).flatMap(stretch => list(stretch?.moves));
    mine.moments = momentsOf(mine.moves);
    mine.key = key;
    showMap();
  }).catch(() => { mine.loading = false; });
};
// The places. A world is laid out both ways once, wide and tall, and the pane shows the one that `fitOf` takes for
// its size, as large as the pane takes it whole, down to four fifths: a larger map is scrolled. They are drawn anew
// when the world file is another one or the pane's size asks for the other layout.
const drawPlaces = () => {
  if (!land.world) return;
  land.both ??= [layoutOf(land.world, { tall: false }), layoutOf(land.world, { tall: true })];
  // The pane's size without its scroll bars' say in it (the style sheet keeps the room of the upright one), so that
  // a bar that comes or goes with a choice does not ask for the other one.
  const { layout } = fitOf(land.both[0], land.both[1], mapScroll.clientWidth - 16, mapScroll.offsetHeight - 16);
  if (land.layout !== layout) {
    land.layout = layout;
    const scene = svgOf(sceneOf(layout, mapWords));
    land.marks = svg('g');
    land.places = new Map([...scene.querySelectorAll('.mp-place')].map(node => [node.dataset.id, node]));
    mapSvg.replaceChildren(scene, land.marks);
  }
};
// Everyone at the moment: the marks on the map, and above it each by name with where it is in words.
const showMoment = () => {
  if (state.v !== 'm') return;
  const { from, to } = worldSpan(), T = momentNow(), range = $('map-t');
  range.min = String(from); range.max = String(to > from ? to : from + 1); range.value = String(T); range.disabled = !(to > from);
  $('map-clock').textContent = $('clock').textContent = clockAt(T);
  $('map-note').textContent = [comparing() ? TXT.mapLeft : '', land.world ? '' : TXT.mapLoading].filter(Boolean).join(' · ');
  if (!land.world || !land.layout) { $('map-who').replaceChildren(); return; }
  const where = landWhere(T), room = roomFor(land.layout, where, mapWords), size = { width: room.w, height: room.h };
  const { by } = fitOf(size, size, mapScroll.clientWidth - 16, mapScroll.offsetHeight - 16);
  mapSvg.setAttribute('viewBox', `${room.x} ${room.y} ${room.w} ${room.h}`);
  mapSvg.setAttribute('width', Math.ceil(room.w * by)); mapSvg.setAttribute('height', Math.ceil(room.h * by));
  for (const id of where.keys()) person(id);
  if (chipsStale) renderChips();
  const marks = svgOf(peopleOf(land.layout, where, { tones: id => tone(id) || 'p0', names: landPerson, words: mapWords }));
  land.marks.replaceWith(marks); land.marks = marks;
  $('map-who').replaceChildren(...[...where].map(([id, is]) => {
    const row = el('span');
    row.append(el('span', `dot ${tone(id) || 'p0'}`), el('b', '', landPerson(id)), is.unknown ? TXT.mapUnknown : is.place === null ? TXT.mapNowhere : is.to !== null ? TXT.mapOnWay(landPlace(is.place), landPlace(is.to), clockAt(is.until, false))
      : `${landPlace(is.place)}${is.asleep ? ` · ${TXT.mapAsleep}` : ''}`);
    return row;
  }));
  for (const [id, node] of land.places) node.classList.toggle('on', state.place.includes(id));
  showCard(where);
};
// The place pointed at: its name, its description, its people whom nobody plays, who is there at the moment and the
// way to every other place, which is written on the map over each of them too.
const showCard = (where = land.world ? landWhere(momentNow()) : new Map()) => {
  const card = $('map-card'), place = land.hot === null ? null : land.world?.places.find(one => one.id === land.hot) ?? null;
  card.hidden = place === null;
  for (const [id, node] of land.places) { node.classList.toggle('hot', id === land.hot); node.querySelector('.mp-way').textContent = ''; }
  if (place === null) return;
  const ways = waysFrom(land.world, place.id), here = [...where].filter(([, is]) => is.place === place.id && is.to === null).map(([id, is]) => `${landPerson(id)}${is.asleep ? ` (${TXT.mapAsleep})` : ''}`);
  for (const way of ways) land.places.get(way.id).querySelector('.mp-way').textContent = duration(way.seconds);
  card.replaceChildren(el('h3', '', str(place.name)), ...(place.about ? [el('p', '', str(place.about))] : []), ...(list(place.figures).length ? [el('p', 'quiet', `${TXT.mapFigures}: ${place.figures.map(figure => str(figure.name)).join(', ')}`)] : []),
    el('p', '', here.length ? `${TXT.mapHere}: ${here.join(', ')}` : TXT.mapNobody), ...(ways.length ? [el('p', 'quiet', `${TXT.mapWays}: ${ways.map(way => `${landPlace(way.id)} ${duration(way.seconds)}`).join(' · ')}`)] : []),
    el('p', 'quiet', state.place.includes(place.id) ? `${TXT.mapFiltered}. ${TXT.mapFilter}` : TXT.mapFilter));
};
const showMap = () => { if (state.v !== 'm') return; drawPlaces(); showMoment(); };
// The moment is chosen: the newest is no longer followed, and the link is written a moment after the hand stopped.
// In the feed of a whole world the link then stands by `t` alone, so that the feed opens at the same moment.
const setMoment = T => {
  if (follow) { follow = false; $('follow').checked = false; }
  state.t = Math.round(T);
  if (A.s === null && !comparing()) state.s = null;
  clearTimeout(momentTimer); momentTimer = setTimeout(() => writeHash(), 250);
  showMoment();
};
// To the next or the previous moment at which someone moved, fell asleep or woke; past the last one, to the end.
const stepMoment = by => { const T = momentNow(), { from, to } = worldSpan(); setMoment((by > 0 ? land.moments.find(at => at > T) : land.moments.findLast(at => at < T)) ?? (by > 0 ? to : from)); };
const placeUnder = event => event.target instanceof Element ? event.target.closest('.mp-place')?.dataset.id ?? null : null;
$('map-t').addEventListener('input', () => setMoment(Number($('map-t').value)));
$('map-prev').addEventListener('click', () => stepMoment(-1));
$('map-next').addEventListener('click', () => stepMoment(1));
mapSvg.addEventListener('pointermove', event => {
  const id = placeUnder(event);
  if (id === land.hot) return;
  land.hot = id;
  // The card stands at the side of the map that the pointer is not on.
  const box = mapScroll.getBoundingClientRect();
  $('map-card').classList.toggle('left', event.clientX > box.left + box.width / 2);
  showCard();
});
mapSvg.addEventListener('pointerleave', () => { land.hot = null; showCard(); });
// A place chosen goes into the feed's filter by place, or out of it, as by its chip.
mapSvg.addEventListener('click', event => { const id = placeUnder(event); if (id === null) return; toggle('place', id); unpin(); showMoment(); });
new ResizeObserver(() => showMap()).observe(mapScroll);

// ---- Bringing the page to the state: after the hash changed, by a link, a click or a key. `moved` says that the
// place to stand may have changed too: the page goes where `s` and `t` say.
let viewWas = 'f';
const sync = moved => {
  if (!listed) return;
  // With no experiment named, the one with the newest activity that is no rehearsal.
  const x = state.x ?? (listing.experiments.find(experiment => !experiment.rehearsal) ?? listing.experiments[0])?.id ?? null;
  if (state.x === null && x !== null) { state.x = x; writeHash(); }
  // An experiment that is a transcript alone opens as that text, and one without a transcript never does.
  // And one without a world file to draw from has no map.
  const view = textOnly(x) ? 't' : found(x) !== null && ((state.v === 't' && !found(x).texts.length) || (state.v === 'm' && !found(x).map)) ? 'f' : state.v;
  if (view !== state.v) { state.v = view; writeHash(); }
  // A stretch is shown by itself when the link says so and the experiment has it; else the side is its whole world.
  const alone = sidesOf(state), sA = alone.a !== null && stretchNames(x).includes(alone.a) ? alone.a : null, sB = alone.b !== null && stretchNames(state.cmp).includes(alone.b) ? alone.b : null;
  let opened = false;
  if (x !== A.x || sA !== A.s) {
    if (x !== A.x) { people.clear(); spots.clear(); story = { x: null, key: null, chapters: [], loading: false }; renderStory(); }
    placed = false; fresh = 0;
    // The newest is followed when the link names no moment and the run grows where the link stands: anywhere when it
    // names no stretch, and else in that stretch, which in a whole world must be the last one.
    const stretches = found(x)?.stretches ?? [], last = stretches.at(-1);
    const grows = sA !== null ? stretches.some(stretch => stretch.name === sA && stretch.growing) : state.s === null || !stretchNames(x).includes(state.s) ? stretches.some(stretch => stretch.growing) : last.name === state.s && last.growing;
    follow = state.t === null && grows; $('follow').checked = follow;
    openSide(A, x, sA, { s: sA === null ? state.s : null, t: state.t });
    opened = true;
  }
  if (state.cmp !== B.x || (state.cmp !== null && sB !== B.s)) { openSide(B, state.cmp, sB, { s: null, t: state.t }); opened = true; }
  if (opened || feed.classList.contains('cmp') !== comparing()) relayout();
  document.body.classList.toggle('no-notes', !state.notes);
  document.body.classList.toggle('no-lists', !state.lists);
  $('notes').checked = state.notes; $('lists').checked = state.lists; $('q-only').checked = state.only;
  if ($('q').value !== state.q) $('q').value = state.q;
  $('reading').hidden = state.v !== 'f';
  $('numbers').hidden = state.v !== 'n';
  storyBox.hidden = state.v !== 's';
  textBox.hidden = state.v !== 't';
  $('map').hidden = state.v !== 'm';
  $('filters').hidden = state.v !== 'f';
  $('follow').parentElement.hidden = state.v !== 'f' && state.v !== 'm';
  renderChips(); renderList(); showTop(); showFresh();
  for (const one of sides) for (const part of one.parts) showMark(part);
  numbersStale = true; countsStale = true; stripStale = true;
  runSearch();
  loadStory();
  loadTexts();
  loadMap();
  showMap();
  if (state.v === 's' && (viewWas !== 's' || moved)) { if (viewWas !== 's') renderStory(); scrollStory(); }
  // Back in the feed, or sent to another place of the same feed: the window goes where the link says.
  if (state.v === 'f' && !opened && (moved || viewWas !== 'f')) { if (follow) bottom(); else stand(state.s, state.t); }
  viewWas = state.v;
};
const choose = id => { if (id === state.x) return; Object.assign(state, { x: id, s: null, solo: false, t: null, ch: null }); if (state.cmp === id) Object.assign(state, { cmp: null, cs: null }); writeHash(true); sync(); };
// Beside another experiment each side is its whole world, unless the open one is a stretch by itself already; an
// experiment beside itself is one of its stretches against another.
const compareWith = id => {
  if (id === null) Object.assign(state, { cmp: null, cs: null, step: 0 });
  else if (id === A.x) { const mine = standing() ?? stretchNames(id)[0] ?? null; Object.assign(state, { cmp: id, s: mine, cs: stretchNames(id).find(name => name !== mine) ?? null, step: 0 }); }
  else Object.assign(state, { cmp: id, s: A.s, cs: null, step: 0 });
  state.t = null;
  writeHash(true); sync();
};
const toggle = (key, id) => { state[key] = state[key].includes(id) ? state[key].filter(other => other !== id) : [...state[key], id]; writeHash(); renderChips(); applyFilters(true); };
const clearFilters = () => { Object.assign(state, { who: [], place: [], q: '', only: false }); $('q').value = ''; $('q-only').checked = false; writeHash(); renderChips(); runSearch(); };
const setView = view => { state.v = view; writeHash(); sync(); };
const flip = key => { state[key] = !state[key]; writeHash(); sync(); };

// ---- Theme and face: the system's theme until the switch is used; the choice stays in this browser.
const THEMES = Object.entries(TXT.themes);
const setTheme = name => { if (name) document.documentElement.dataset.theme = name; else delete document.documentElement.dataset.theme; $('b-theme').title = TXT.themeTitle(THEMES.find(([key]) => key === name)?.[1] ?? ''); stored('sagents-lab-theme', name); stripStale = true; scheduleFrame(); };
const nextTheme = () => { const at = THEMES.findIndex(([key]) => key === (document.documentElement.dataset.theme ?? '')); setTheme(THEMES[(at + 1) % THEMES.length][0]); };
const setFace = name => { if (name === 'sans') document.documentElement.dataset.face = 'sans'; else delete document.documentElement.dataset.face; stored('sagents-lab-face', name); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { stripStale = true; scheduleFrame(); });

// ---- The controls.
$('b-side').addEventListener('click', () => document.body.classList.toggle('noside'));
$('shade').addEventListener('click', () => document.body.classList.add('noside'));
$('b-theme').addEventListener('click', nextTheme);
$('b-face').addEventListener('click', () => setFace(document.documentElement.dataset.face === 'sans' ? 'serif' : 'sans'));
$('b-help').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
$('b-clear').addEventListener('click', clearFilters);
$('v-feed').addEventListener('click', () => setView('f'));
$('v-story').addEventListener('click', () => setView('s'));
$('v-text').addEventListener('click', () => setView('t'));
$('narrow').addEventListener('input', () => { narrowBy = $('narrow').value.trim(); renderList(); });
$('v-numbers').addEventListener('click', () => setView('n'));
$('v-map').addEventListener('click', () => setView('m'));
$('follow').addEventListener('change', () => setFollow($('follow').checked));
$('fresh').addEventListener('click', () => setFollow(true));
$('notes').addEventListener('change', () => flip('notes'));
$('lists').addEventListener('change', () => flip('lists'));
// The picker: in the feed of a world it goes to where the stretch begins; a stretch shown by itself gives way to
// the one picked. The switch beside it shows the stretch the window stands in by itself, or the whole world again,
// at the same moment.
$('stretch').addEventListener('change', () => {
  const name = $('stretch').value, alone = A.s !== null || comparing();
  $('stretch').blur();
  Object.assign(state, { s: name, t: null });
  if (state.v !== 'f') state.v = 'f';
  writeHash(true);
  if (alone) sync(); else { sync(); stand(name, null); }
});
$('solo').addEventListener('change', () => {
  if ($('solo').checked) Object.assign(state, { s: standing() ?? state.s ?? stretchNames(A.x)[0] ?? null, solo: !comparing() });
  else { state.solo = false; if (comparing()) state.s = null; }
  writeHash(true); sync();
});
let typing = null;
$('q').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { state.q = $('q').value; writeHash(); runSearch(); }, 140); });
$('q').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); clearTimeout(typing); if (state.q !== $('q').value) { state.q = $('q').value; writeHash(); runSearch(); } toHit(event.shiftKey ? -1 : 1); }
  else if (event.key === 'Escape') { event.preventDefault(); $('q').blur(); scroller.focus(); }
});
$('q-next').addEventListener('click', () => toHit(1));
$('q-prev').addEventListener('click', () => toHit(-1));
$('q-only').addEventListener('change', () => { state.only = $('q-only').checked; writeHash(); applyFilters(true); });
// The keys go by their place on the keyboard, so that they work in a Russian layout too.
addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || $('help').open) return;
  if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
  const code = event.code, stepBy = by => { const all = shownItems(); if (!all.length || state.v !== 'f') return; if (follow) setFollow(false); const at = itemAt(scroller.scrollTop + headRoom() + 1), next = all[Math.max(0, Math.min(all.length - 1, at + by))]; pinTo(next.el); noteTop(); };
  const experimentBy = by => { const at = ordered.findIndex(experiment => experiment.id === A.x), next = ordered[at === -1 && by < 0 ? ordered.length - 1 : at + by]; if (next) choose(next.id); };
  if (code === 'Slash' && !event.shiftKey || code === 'NumpadDivide') { $('q').focus(); $('q').select(); }
  else if (code === 'Slash' && event.shiftKey) $('help').showModal();
  else if (/^Digit[1-9]$/.test(code) && !event.shiftKey) { const id = [...people.keys()][Number(code.slice(5)) - 1]; if (id === undefined) return; toggle('who', id); }
  else if (code === 'Digit0' && !event.shiftKey) clearFilters();
  else if (code === 'KeyF') setFollow(!follow);
  else if (code === 'KeyJ' || code === 'KeyK') { if (state.v === 'm') stepMoment(code === 'KeyJ' ? 1 : -1); else stepBy(code === 'KeyJ' ? 1 : -1); }
  else if (code === 'KeyG' && state.v === 'm') setMoment(event.shiftKey ? worldSpan().to : worldSpan().from);
  else if (code === 'KeyG' && !event.shiftKey) { if (follow) setFollow(false); toTop(); noteTop(); }
  else if (code === 'KeyG') bottom();
  else if (code === 'KeyN') setView(state.v === 'n' ? 'f' : 'n');
  else if (code === 'KeyS') setView(state.v === 's' ? 'f' : 's');
  else if (code === 'KeyX') { if (found(A.x)?.texts.length) setView(state.v === 't' ? 'f' : 't'); }
  else if (code === 'KeyP') { if (found(A.x)?.map) setView(state.v === 'm' ? 'f' : 'm'); }
  else if (code === 'KeyC') { if (comparing()) compareWith(null); else if (found(A.x)?.stretches.length) { const feeds = ordered.filter(experiment => experiment.stretches.length), at = feeds.findIndex(experiment => experiment.id === A.x), other = feeds[at + 1] ?? feeds[at - 1]; if (other) compareWith(other.id); else if (found(A.x).stretches.length > 1) compareWith(A.x); } }
  else if (code === 'BracketLeft') experimentBy(-1);
  else if (code === 'BracketRight') experimentBy(1);
  else if (code === 'KeyE') document.body.classList.toggle('noside');
  else if (code === 'KeyM') flip('notes');
  else if (code === 'KeyL') flip('lists');
  else if (code === 'KeyT') nextTheme();
  else return;
  event.preventDefault();
});
addEventListener('hashchange', () => { readHash(); sync(true); });
addEventListener('popstate', () => { readHash(); sync(true); });

setTheme(stored('sagents-lab-theme') ?? '');
setFace(stored('sagents-lab-face') ?? 'serif');
readHash();
refreshList();
setInterval(refreshList, 2500);
