// The things of a live world, with no model in them: records that the rules count and keep, each under a label and
// with one holder, a person, a place or another thing. The world's answer names what a deed moved by label and where
// it ended up; the rules check each entry, move the record and say what went from where to where. Nothing here reads
// prose, and no text of a model changes a count.
import { boundedOf, isObject, refuse, textOf } from './reading.ts';

// The most entries one answer may move and set, the most taken from a stock by one entry, how deep a thing may lie
// under a person or a place, and how many records a person and a place may hold, so that a request has a largest size.
export const MAX_MOVES = 12, MAX_SETS = 6, MAX_STOCK = 20, MAX_DEPTH = 4, MAX_ON_PERSON = 30, MAX_IN_PLACE = 60;
// The most words a thing's name and the spot of a hidden thing may hold, and the most states a thing may have.
export const NAME_WORDS = 8, SPOT_WORDS = 20, MAX_STATES = 4;

// One record. `n` is how many there are of a thing that is counted, and null for a single thing. `holds` is what a
// thing that can hold others holds, and null for one that never does; a counted thing holds nothing. `fixed` is a
// part of its place and never moves; what an `open` thing holds is in plain sight; a `stock` is a supply with no
// count, which taking does not use up. `food` is the calories of one, and what makes it something to eat; `burns`
// says that it can burn up; `fire` that it can set things alight, always or while it is in the state `fire` names.
// `states` are the states it can be in and `state` the one it is in. `money` is a count that no deed uses up or
// makes. `hidden` is where a thing of a place lies unfound, with the minutes of search that find it.
export type Thing = { label: string; name: string; n: number | null; fixed: boolean; open: boolean; stock: boolean; food: number | null; burns: boolean;
  fire: boolean | string; states: string[] | null; state: string | null; money: boolean; holds: Thing[] | null; hidden: { spot: string; minutes: number } | null };
// The things of a run: what lies in each place and what each person has in hand or wears, with all that those hold;
// the number of the next label, since a label is the world's own and is never used again; and the seconds each
// person has searched each place, under the person's id and the place's.
export type Things = { places: Map<string, Thing[]>; people: Map<string, Thing[]>; next: number; searched: Map<string, number> };
// One entry of the world's answer: so many of the thing `what` end up in `to`, a person here, the place, a thing that
// holds others, or one of the two ways a thing leaves the world. And a thing put into one of its states.
export type Move = { what: string; n: number; to: string };
export type Setting = { what: string; state: string };
export const SINKS = ['eaten', 'burned'];
// What one entry did: so many of the record `what`, called `name`, went from the holder `from` to `to`, and are there
// the record `as`, or gone when `to` is a sink; `n` is null for a thing that has no count. `stock` says that they
// were taken from a supply, which is as it was. `out` and `into` say the two holders as anyone sees them: the
// person who has the thing on them, or the thing of the place it lies in or on, or the place.
export type Posting = { what: string; name: string; n: number | null; from: string; to: string; as: string | null; stock: boolean; out: string; into: string };
// Why the rules refuse an answer whole: the first entry they cannot take, and the cause.
export const CODES = ['what', 'hidden', 'fixed', 'n', 'to', 'inside', 'sink', 'full', 'state'] as const;
export type Refused = { code: typeof CODES[number]; entry: Move | Setting };
export type Settled = { moved: Posting[]; set: { what: string; name: string; state: string }[]; found: { what: string; name: string; spot: string }[];
  lists: Map<string, Thing[]>; next: number };

const SIGNS = /[,;[\]×]/;
const flag = (value: unknown, field: string) => value === undefined || typeof value === 'boolean' ? value === true : refuse(field, 'must be true or false');
// The things of one holder as a world file gives them, each under the next label. `top` says that these are the
// things of a place itself, the only ones that can be hidden.
export function readThings(value: unknown, field: string, labels: { next: number }, top = false, level = 1): Thing[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return refuse(field, 'must be a list of things');
  return value.map((item, at): Thing => {
    const here = `${field}[${at}]`;
    if (!isObject(item)) return refuse(here, 'must be an object');
    if (level > MAX_DEPTH) return refuse(here, `lies deeper than ${MAX_DEPTH} levels`);
    const name = boundedOf(textOf(item.name, `${here}.name`), `${here}.name`, NAME_WORDS) as string;
    if (SIGNS.test(name)) return refuse(`${here}.name`, 'must hold none of `, ; [ ] ×`');
    const label = `t${labels.next++}`;
    const n = item.n === undefined ? null : typeof item.n === 'number' && Number.isSafeInteger(item.n) && item.n > 0 ? item.n : refuse(`${here}.n`, 'must be a whole number above zero');
    const stock = flag(item.stock, `${here}.stock`), money = flag(item.money, `${here}.money`), open = flag(item.open, `${here}.open`);
    const food = item.food === undefined ? null : typeof item.food === 'number' && item.food >= 0 ? item.food : refuse(`${here}.food`, 'must be the calories of one, zero or more');
    const burns = flag(item.burns, `${here}.burns`);
    const states = item.states === undefined ? null : Array.isArray(item.states) && item.states.length >= 2 && item.states.length <= MAX_STATES
      && item.states.every(state => typeof state === 'string' && /^[^\s/()]{1,30}$/.test(state) && !SIGNS.test(state)) && new Set(item.states).size === item.states.length
      ? item.states as string[] : refuse(`${here}.states`, `must be two to ${MAX_STATES} different words`);
    const state = states === null ? item.state === undefined ? null : refuse(`${here}.state`, 'needs `states`')
      : item.state === undefined ? states[0] : states.find(known => known === item.state) ?? refuse(`${here}.state`, 'must be one of `states`');
    const fire = item.fire === undefined || item.fire === false ? false : item.fire === true ? true
      : states?.find(known => known === item.fire) ?? refuse(`${here}.fire`, 'must be true or one of `states`');
    const holds = item.holds === undefined ? null : readThings(item.holds, `${here}.holds`, labels, false, level + 1);
    if (holds && (n !== null || stock || food !== null || burns)) return refuse(`${here}.holds`, 'is not for a thing that is counted, a stock, food or something that burns');
    if (stock && (n !== null || money)) return refuse(`${here}.stock`, 'is a supply with no count, and never of money');
    if (money && n === null) return refuse(`${here}.money`, 'needs `n`');
    if (open && !holds) return refuse(`${here}.open`, 'needs `holds`');
    if (states && (n !== null || stock)) return refuse(`${here}.states`, 'is not for a thing that is counted or a stock');
    let hidden = null;
    if (item.hidden !== undefined) {
      if (!top || !isObject(item.hidden)) return refuse(`${here}.hidden`, 'must be an object, on a thing of a place itself');
      const spot = boundedOf(textOf(item.hidden.spot, `${here}.hidden.spot`), `${here}.hidden.spot`, SPOT_WORDS) as string;
      const minutes = typeof item.hidden.minutes === 'number' && item.hidden.minutes > 0 ? item.hidden.minutes : refuse(`${here}.hidden.minutes`, 'must be a number above zero');
      hidden = { spot, minutes };
    }
    return { label, name, n, fixed: flag(item.fixed, `${here}.fixed`), open, stock, food, burns, fire, states, state, money, holds, hidden };
  });
}

// Every record of some holders' things, with all that they hold.
export const all = (things: Thing[]): Thing[] => things.flatMap(thing => [thing, ...all(thing.holds ?? [])]);
// Whether a thing can set things alight as it is now.
export const lit = (thing: Thing) => thing.fire === true || (thing.fire !== false && thing.fire === thing.state);
// A thing as the world is told of it: its label, name and count, its marks, and in brackets what it holds.
export const written = (thing: Thing): string => `${thing.label} ${thing.name}${thing.n === null ? '' : ` ×${thing.n}`}${
  [thing.fixed && 'fixed', thing.open && 'open', thing.stock && 'stock', thing.food !== null && 'food', thing.burns && 'burns', lit(thing) && 'fire',
    thing.states && `state: ${thing.state} (${thing.states.join('/')})`].filter(Boolean).map(mark => `, ${mark}`).join('')}${
  thing.holds ? ` [${thing.holds.map(written).join('; ')}]` : ''}`;
// Things as a resident is told of them, with no label and no mark: its own three levels deep, and of anyone else's
// the top level and what an open thing holds.
export const shown = (things: Thing[], own: boolean, level = 1): string => things.map(thing =>
  `${thing.name}${thing.n === null ? '' : ` ×${thing.n}`}${thing.holds?.length && (own ? level < 3 : thing.open) ? ` [${shown(thing.holds, own, level + 1)}]` : ''}`).join('; ');
// The most characters one record takes in a request, with its label, count, marks and brackets.
export const RECORD = NAME_WORDS * 10 + (MAX_STATES + 1) * 31 + 90;
// The things of a run as it begins: what the world file gives each place and each person, and nobody has searched.
export const stocked = (world: { places: { id: string; things: Thing[] }[]; characters: { id: string; carries: Thing[] }[] }): Things =>
  ({ places: new Map(world.places.map(place => [place.id, structuredClone(place.things)])), people: new Map(world.characters.map(person => [person.id, structuredClone(person.carries)])),
    next: 1 + all([...world.places.flatMap(place => place.things), ...world.characters.flatMap(person => person.carries)]).length, searched: new Map() });

// What of the hidden things of a deed's place the deed finds if the world says it is a search: those that the
// doer's searches of the place, this deed with them, have lasted long enough for.
export function sought(things: Things, deed: { who: string; place: string; seconds: number }): { found: Thing[]; left: Thing[] } {
  const seconds = (things.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds, hidden = things.places.get(deed.place)!.filter(thing => thing.hidden);
  return { found: hidden.filter(thing => seconds >= thing.hidden!.minutes * 60), left: hidden.filter(thing => seconds < thing.hidden!.minutes * 60) };
}

type Slot = { thing: Thing; list: Thing[]; key: string; top: Thing; level: number; root: string };
const height = (thing: Thing): number => 1 + Math.max(0, ...(thing.holds ?? []).map(height));
const alike = (one: Thing, other: Thing) => one.name === other.name && one.food === other.food && one.burns === other.burns && one.money === other.money
  && one.fire === other.fire && one.fixed === other.fixed;

// An answer's entries take effect in the place of a deed, among its things and those of the people `present`, whose
// names `names` gives with the place's: first the hidden things `found` are hidden no longer, then each move in its
// order, then each state. The first entry that cannot be taken refuses the whole answer, and then nothing has
// changed. A move to where the thing already is does nothing. A whole record keeps its label and all it holds; a
// part of a count leaves the rest under the old label and is a new record where it went; what is taken from a stock
// is a new record and the stock stays; counted records of one name and kind at one holder become one. Without
// `sinks` nothing is eaten or burned. Nothing of `things` is changed here: `keep` does that with what this gives.
export function settle(things: Things, place: string, present: string[], names: Map<string, string>, found: string[], moves: Move[], sets: Setting[], sinks = true): Settled | Refused {
  const lists = new Map<string, Thing[]>([[place, structuredClone(things.places.get(place)!)], ...present.map((id): [string, Thing[]] => [id, structuredClone(things.people.get(id)!)])]);
  let next = things.next;
  const settled: Settled = { moved: [], set: [], found: [], lists, next };
  for (const thing of lists.get(place)!) {
    if (!thing.hidden || !found.includes(thing.label)) continue;
    settled.found.push({ what: thing.label, name: thing.name, spot: thing.hidden.spot });
    thing.hidden = null;
  }
  const index = () => {
    const slots = new Map<string, Slot>();
    const walk = (list: Thing[], key: string, top: Thing | null, level: number, root: string) => {
      for (const thing of list) {
        slots.set(thing.label, { thing, list, key, top: top ?? thing, level, root });
        if (thing.holds) walk(thing.holds, thing.label, top ?? thing, level + 1, root);
      }
    };
    for (const [id, list] of lists) walk(list, id, null, 1, id);
    return slots;
  };
  const said = (slots: Map<string, Slot>, key: string) => { const slot = slots.get(key); return !slot ? names.get(key)! : slot.root === place ? slot.top.name : names.get(slot.root)!; };
  for (const entry of moves) {
    const slots = index(), slot = slots.get(entry.what);
    if (!slot) return { code: 'what', entry };
    const thing = slot.thing;
    if (slot.top.hidden) return { code: 'hidden', entry };
    if (thing.fixed) return { code: 'fixed', entry };
    if (entry.n < 1 || entry.n > (thing.stock ? MAX_STOCK : thing.n ?? 1)) return { code: 'n', entry };
    const sink = sinks && SINKS.includes(entry.to), into = slots.get(entry.to);
    const target = sink ? null : lists.get(entry.to) ?? into?.thing.holds ?? null;
    if (!sink && !target) return { code: 'to', entry };
    if (into?.top.hidden) return { code: 'hidden', entry };
    if (target === slot.list) continue;
    const whole = !thing.stock && entry.n === (thing.n ?? 1);
    if (into && (into.thing === thing || all(thing.holds ?? []).includes(into.thing))) return { code: 'inside', entry };
    if (target && (into ? into.level : 0) + (whole ? height(thing) : 1) > MAX_DEPTH) return { code: 'inside', entry };
    if (sink && (thing.money || (entry.to === 'eaten' ? thing.food === null : !thing.burns || ![...slots.values()].some(other => lit(other.thing) && !other.top.hidden)))) {
      return { code: 'sink', entry };
    }
    const out = said(slots, slot.key), where = sink ? '' : said(slots, entry.to);
    if (whole) slot.list.splice(slot.list.indexOf(thing), 1);
    else if (!thing.stock) (thing.n as number) -= entry.n;
    let as: string | null = null;
    if (target) {
      const twin = thing.n === null && !thing.stock ? undefined : target.find(item => item.n !== null && !item.hidden && alike(item, thing));
      if (twin) (twin.n as number) += entry.n;
      else target.push(whole ? thing : { ...thing, label: `t${next++}`, n: entry.n, stock: false });
      as = twin?.label ?? target.at(-1)!.label;
    }
    for (const [id, list] of lists) if (all(list).length > (id === place ? MAX_IN_PLACE : MAX_ON_PERSON)) return { code: 'full', entry };
    settled.moved.push({ what: thing.label, name: thing.name, n: thing.n === null && !thing.stock ? null : entry.n, from: slot.key, to: entry.to, as, stock: thing.stock, out, into: where });
  }
  for (const entry of sets) {
    const slot = index().get(entry.what);
    if (slot?.top.hidden) return { code: 'hidden', entry };
    if (!slot?.thing.states?.includes(entry.state)) return { code: 'state', entry };
    if (slot.thing.state === entry.state) continue;
    slot.thing.state = entry.state;
    settled.set.push({ what: slot.thing.label, name: slot.thing.name, state: entry.state });
  }
  settled.next = next;
  return settled;
}
export function keep(things: Things, place: string, settled: Settled): void {
  for (const [id, list] of settled.lists) (id === place ? things.places : things.people).set(id, list);
  things.next = settled.next;
}
