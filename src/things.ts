import { amountOf, boundedOf, durationOf, isObject, MAX_FACTS, refuse, textOf } from './reading.ts';

export const MAX_MOVES = 12, MAX_SETS = 6, MAX_STOCK = 20, MAX_DEPTH = 4, MAX_ON_PERSON = 30, MAX_IN_PLACE = 60;
export const THIRDS = 3;
export const NAME_WORDS = 8, SPOT_WORDS = 20, MAX_STATES = 4;
// Keep combined counts and stock additions well inside the exact whole numbers.
export const MAX_N = 1_000_000_000;

export type Thing = { label: string; name: string; facts: string | null; n: number | null; fixed: boolean; open: boolean; stock: boolean; food: number | null; drink?: true; left?: 2 | 1; burns: boolean;
  fire: boolean | string; states: string[] | null; state: string | null; money: boolean; price?: { name: string; n: number }; till?: true; holds: Thing[] | null; hidden: { spot: string; minutes: number } | null };
export type Things = { places: Map<string, Thing[]>; people: Map<string, Thing[]>; next: number; searched: Map<string, number> };
export type Move = { what: string; n: number; to: string };
export type Setting = { what: string; state: string };
export const SINKS = ['eaten', 'burned'];
export type Posting = { what: string; name: string; n: number | null; from: string; to: string; as: string | null; stock: boolean; out: string; into: string; sink?: 'fare'; price?: true; food?: number; drink?: true; thirds?: number; left?: 2 | 1 | 0 };
// Refuse moves that all stay put, or the words could claim a move the lists never took.
export const CODES = ['what', 'hidden', 'fixed', 'n', 'to', 'inside', 'sink', 'full', 'same', 'state', 'price'] as const;
export type Refused = { code: typeof CODES[number]; entry: Move | Setting };
export type Settled = { moved: Posting[]; set: { what: string; name: string; state: string }[]; found: { what: string; name: string; spot: string }[];
  lists: Map<string, Thing[]>; next: number };

const SIGNS = /[,;[\]×]/;
const flag = (value: unknown, field: string) => value === undefined || typeof value === 'boolean' ? value === true : refuse(field, 'must be true or false');
export function readThings(value: unknown, field: string, labels: { next: number }, top = false, level = 1, fixable = top, hunger = false, pricing: { prices?: boolean; place?: boolean; hidden?: boolean } = {}): Thing[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return refuse(field, 'must be a list of things');
  return value.map((item, at): Thing => {
    const here = `${field}[${at}]`;
    if (!isObject(item)) return refuse(here, 'must be an object');
    if (level > MAX_DEPTH) return refuse(here, `lies deeper than ${MAX_DEPTH} levels`);
    const name = boundedOf(textOf(item.name, `${here}.name`), `${here}.name`, NAME_WORDS) as string;
    if (SIGNS.test(name)) return refuse(`${here}.name`, 'must hold none of `, ; [ ] ×`');
    const label = `t${labels.next++}`;
    const n = item.n === undefined ? null : typeof item.n === 'number' && Number.isInteger(item.n) && item.n > 0 && item.n <= MAX_N ? item.n : refuse(`${here}.n`, 'must be a whole number from 1 to 1,000,000,000');
    const stock = flag(item.stock, `${here}.stock`), money = flag(item.money, `${here}.money`), open = flag(item.open, `${here}.open`);
    const food = item.food === undefined ? null : typeof item.food === 'number' && Number.isFinite(item.food) && item.food >= 0 ? item.food + 0 : refuse(`${here}.food`, 'must be the calories of one, zero or more');
    const drink = flag(item.drink, `${here}.drink`);
    if (drink && food === null) return refuse(`${here}.drink`, 'needs `food`, zero for water');
    const burns = flag(item.burns, `${here}.burns`), fixed = flag(item.fixed, `${here}.fixed`);
    if (fixed && !fixable) return refuse(`${here}.fixed`, 'is for a thing of a place itself or a thing inside a fixed one');
    const states = item.states === undefined ? null : Array.isArray(item.states) && item.states.length >= 2 && item.states.length <= MAX_STATES
      && item.states.every(state => typeof state === 'string' && /^[^\s/()]{1,30}$/.test(state) && !SIGNS.test(state)) && new Set(item.states).size === item.states.length
      ? item.states as string[] : refuse(`${here}.states`, `must be two to ${MAX_STATES} different words`);
    const state = states === null ? item.state === undefined ? null : refuse(`${here}.state`, 'needs `states`')
      : item.state === undefined ? states[0] : states.find(known => known === item.state) ?? refuse(`${here}.state`, 'must be one of `states`');
    const fire = item.fire === undefined || item.fire === false ? false : item.fire === true ? true
      : states?.find(known => known === item.fire) ?? refuse(`${here}.fire`, 'must be true or one of `states`');
    const holds = item.holds === undefined ? null : readThings(item.holds, `${here}.holds`, labels, false, level + 1, fixed, hunger, { ...pricing, hidden: pricing.hidden || item.hidden !== undefined });
    if (holds && (n !== null || stock || food !== null || burns)) return refuse(`${here}.holds`, 'is not for a thing that is counted, a stock, food or something that burns');
    if (stock && (n !== null || money)) return refuse(`${here}.stock`, 'is a supply with no count, and never of money');
    if (money && n === null) return refuse(`${here}.money`, 'needs `n`');
    if (open && !holds) return refuse(`${here}.open`, 'needs `holds`');
    if (states && (n !== null || stock)) return refuse(`${here}.states`, 'is not for a thing that is counted or a stock');
    let hidden = null;
    if (item.hidden !== undefined) {
      if (!top || !isObject(item.hidden)) return refuse(`${here}.hidden`, 'must be an object, on a thing of a place itself');
      const spot = boundedOf(textOf(item.hidden.spot, `${here}.hidden.spot`), `${here}.hidden.spot`, SPOT_WORDS) as string;
      const minutes = amountOf(item.hidden.minutes ?? null, `${here}.hidden.minutes`, 0);
      durationOf(Math.ceil(minutes * 60), `${here}.hidden.minutes`);
      hidden = { spot, minutes };
    }
    let price;
    if (item.price !== undefined) {
      if (!pricing.prices) return refuse(`${here}.price`, 'needs `prices`');
      if (!pricing.place || money || fixed) return refuse(`${here}.price`, 'is for a movable thing of a place, never money');
      if (!isObject(item.price)) return refuse(`${here}.price`, 'must be an object');
      const name = textOf(item.price.name, `${here}.price.name`), n = item.price.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_N) return refuse(`${here}.price.n`, 'must be a whole number from 1 to 1,000,000,000');
      price = { name, n };
    }
    if (item.till !== undefined && !pricing.prices) return refuse(`${here}.till`, 'needs `prices`');
    const till = flag(item.till, `${here}.till`);
    if (till && (!pricing.place || !holds || !fixed || hidden || pricing.hidden || level === MAX_DEPTH)) return refuse(`${here}.till`, `needs \`holds\` and \`fixed\`, in a place, outside hidden things and above level ${MAX_DEPTH}`);
    return { label, name, facts: boundedOf(item.facts, `${here}.facts`, MAX_FACTS), n, fixed, open, stock, food, burns, fire, states, state, money, holds, hidden,
      ...(price ? { price } : {}), ...(till ? { till: true as const } : {}), ...(hunger && drink ? { drink: true as const } : {}) };
  });
}

export const all = (things: Thing[]): Thing[] => things.flatMap(thing => [thing, ...all(thing.holds ?? [])]);
export const lit = (thing: Thing) => thing.fire === true || (thing.fire !== false && thing.fire === thing.state);
export const written = (thing: Thing, portions = false): string => `${thing.label} ${thing.name}${thing.n === null ? '' : ` ×${thing.n}`}${
  [thing.fixed && 'fixed', thing.open && 'open', thing.stock && 'stock', thing.food !== null && 'food', portions && thing.left && (thing.left === 2 ? 'two thirds left' : 'a third left'), thing.burns && 'burns', lit(thing) && 'fire',
    thing.states && `state: ${thing.state} (${thing.states.join('/')})`, thing.price && `price ${thing.price.n} ${thing.price.name}`, thing.till && 'till'].filter(Boolean).map(mark => `, ${mark}`).join('')}${
  thing.holds ? ` [${thing.holds.map(thing => written(thing, portions)).join('; ') || (portions ? 'empty' : '')}]` : ''}`;
export const shown = (things: Thing[], own: boolean, level = 1, portions = false): string => things.map(thing =>
  `${thing.name}${thing.n === null ? '' : ` ×${thing.n}`}${portions && thing.left ? `, ${thing.left === 2 ? 'two thirds left' : 'a third left'}` : ''}${
    thing.holds && (own ? level < 3 : thing.open) && (thing.holds.length || portions)
      ? ` [${shown(thing.holds, own, level + 1, portions) || 'empty'}]` : ''}`).join('; ');
// requestLimit() in live.ts needs a per-record bound in characters.
export const RECORD = NAME_WORDS * 10 + (MAX_STATES + 1) * 31 + 90;
export const stocked = (world: { places: { id: string; things: Thing[] }[]; characters: { id: string; carries: Thing[] }[] }): Things =>
  ({ places: new Map(world.places.map(place => [place.id, structuredClone(place.things)])), people: new Map(world.characters.map(person => [person.id, structuredClone(person.carries)])),
    next: 1 + all([...world.places.flatMap(place => place.things), ...world.characters.flatMap(person => person.carries)]).length, searched: new Map() });

export function sought(things: Things, deed: { who: string; place: string; seconds: number }): { found: Thing[]; left: Thing[] } {
  const seconds = (things.searched.get(`${deed.who} ${deed.place}`) ?? 0) + deed.seconds, hidden = things.places.get(deed.place)!.filter(thing => thing.hidden);
  return { found: hidden.filter(thing => seconds >= thing.hidden!.minutes * 60), left: hidden.filter(thing => seconds < thing.hidden!.minutes * 60) };
}

type Slot = { thing: Thing; list: Thing[]; key: string; top: Thing; level: number; root: string };
const height = (thing: Thing): number => 1 + Math.max(0, ...(thing.holds ?? []).map(height));
const alike = (one: Thing, other: Thing) => one.name === other.name && one.food === other.food && one.burns === other.burns && one.money === other.money
  && one.fire === other.fire && one.fixed === other.fixed && one.facts === other.facts && one.drink === other.drink && one.left === other.left
  && one.price?.name === other.price?.name && one.price?.n === other.price?.n;

// refusal() in answer.ts relies on things staying unchanged here; keep() applies the result.
export function settle(things: Things, place: string, present: string[], names: Map<string, string>, found: string[], moves: Move[], sets: Setting[], sinks = true, hunger = false, portions = false, payer?: string): Settled | Refused {
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
  const money = (held: Thing[], name: string) => all(held).reduce((sum, thing) => sum + (thing.money && thing.name === name ? thing.n! : 0), 0);
  const owed = new Map<string, number>(), till = payer !== undefined && lists.has(payer) ? all(lists.get(place)!).find(thing => thing.till) : undefined;
  const receipt = new Map<string, number>();
  let first: Move | undefined;
  const move = (entry: Move, payment = false): Refused | null => {
    const slots = index(), slot = slots.get(entry.what);
    if (!slot) return { code: 'what', entry };
    const thing = slot.thing;
    if (slot.top.hidden) return { code: 'hidden', entry };
    if (thing.fixed) return { code: 'fixed', entry };
    const tasted = portions && sinks && entry.to === 'tasted', before = thing.left ?? THIRDS;
    if ((tasted && entry.n !== 1) || entry.n < 1 || entry.n > (thing.stock ? MAX_STOCK : thing.n ?? 1)) return { code: 'n', entry };
    const sink = tasted || (sinks && SINKS.includes(entry.to)), into = slots.get(entry.to);
    const target = sink ? null : lists.get(entry.to) ?? into?.thing.holds ?? null;
    if (!sink && !target) return { code: 'to', entry };
    if (into?.top.hidden) return { code: 'hidden', entry };
    if (target === slot.list) return null;
    const whole = !thing.stock && entry.n === (thing.n ?? 1);
    if (into && (into.thing === thing || all(thing.holds ?? []).includes(into.thing))) return { code: 'inside', entry };
    if (target && (into ? into.level : 0) + (whole ? height(thing) : 1) > MAX_DEPTH) return { code: 'inside', entry };
    if (sink && (thing.money || (entry.to === 'eaten' || tasted ? thing.food === null : !thing.burns || ![...slots.values()].some(other => lit(other.thing) && !other.top.hidden)))) {
      return { code: 'sink', entry };
    }
    if (till && !payment) {
      const contents = all(till.holds!);
      const direction = slot.root === payer && into && (into.thing === till || contents.includes(into.thing)) ? 1
        : contents.includes(thing) && (entry.to === payer || into?.root === payer) ? -1 : 0;
      if (direction) for (const carried of all([thing])) {
        if (carried.money) receipt.set(carried.name, (receipt.get(carried.name) ?? 0) + direction * (carried === thing ? entry.n : carried.n!));
      }
    }
    const out = said(slots, slot.key), where = sink ? '' : said(slots, entry.to);
    let as: string | null = null;
    const left = before - 1 as 2 | 1 | 0;
    if (tasted) {
      if (!thing.stock) {
        if (thing.n !== null && thing.n > 1) {
          thing.n -= 1;
          if (left) {
            as = `t${next++}`;
            slot.list.splice(slot.list.indexOf(thing) + 1, 0, { ...thing, label: as, n: 1, left });
          }
        } else if (left) thing.left = left;
        else slot.list.splice(slot.list.indexOf(thing), 1);
      }
    } else if (whole) slot.list.splice(slot.list.indexOf(thing), 1);
    else if (!thing.stock) (thing.n as number) -= entry.n;
    const sold = till && slot.root === place && thing.price && !payment ? thing.price : null;
    if (sold) {
      first ??= entry;
      owed.set(sold.name, (owed.get(sold.name) ?? 0) + sold.n * entry.n);
    }
    const arriving = sold ? { ...thing } : thing;
    if (sold) delete arriving.price;
    if (target) {
      const twin = thing.n === null && !thing.stock ? undefined : target.find(item => item.n !== null && !item.hidden && alike(item, arriving));
      if (twin) (twin.n as number) += entry.n;
      else target.push(whole ? arriving : { ...arriving, label: `t${next++}`, n: entry.n, stock: false });
      as = twin?.label ?? target.at(-1)!.label;
    }
    for (const [id, list] of lists) if (all(list).length > (id === place ? MAX_IN_PLACE : MAX_ON_PERSON)) return { code: 'full', entry };
    settled.moved.push({ what: thing.label, name: thing.name, n: thing.n === null && !thing.stock ? null : entry.n, from: slot.key, to: entry.to, as, stock: thing.stock, out, into: where,
      ...(portions && tasted ? { thirds: 1, ...(!thing.stock ? { left } : {}) } : portions && entry.to === 'eaten' && thing.left ? { thirds: thing.left * entry.n } : {}),
      ...(payment ? { price: true as const } : {}), ...(hunger && (entry.to === 'eaten' || tasted) ? { food: thing.food!, ...(thing.drink ? { drink: true as const } : {}) } : {}) });
    return null;
  };
  for (const entry of moves) {
    const refused = move(entry);
    if (refused) return refused;
  }
  if (till && first) {
    const held = lists.get(payer!)!;
    for (const [name, n] of owed) {
      const after = money(held, name), due = n - (receipt.get(name) ?? 0);
      if (due <= 0) continue;
      if (due > after) return { code: 'price', entry: first };
      let left = due;
      const pockets = [held];
      for (const list of pockets) {
        if (!left) break;
        for (const thing of [...list]) {
          if (!left) break;
          if (thing.money && thing.name === name) {
            const n = Math.min(left, thing.n!), refused = move({ what: thing.label, n, to: till.label }, true);
            if (refused) return { code: refused.code, entry: first };
            left -= n;
          } else if (thing.holds) pockets.push(thing.holds);
        }
      }
    }
  }
  if (moves.length && !settled.moved.length) return { code: 'same', entry: moves[0] };
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

export function pay(things: Things, who: string, name: string, n: number, owner: string): Posting[] {
  const held = things.people.get(who)!;
  if (all(held).reduce((sum, thing) => sum + (thing.money && thing.name === name ? thing.n! : 0), 0) < n) throw new Error('A fare cannot be paid.');
  const moved: Posting[] = [];
  const pockets = [{ list: held, from: who }];
  for (const { list, from } of pockets) {
    if (!n) break;
    for (const thing of [...list]) {
      if (!n) break;
      if (thing.money && thing.name === name) {
        const amount = Math.min(n, thing.n!);
        moved.push({ what: thing.label, name, n: amount, from, to: 'fare', sink: 'fare', as: null, stock: false, out: owner, into: '' });
        n -= amount;
        if (amount === thing.n) list.splice(list.indexOf(thing), 1);
        else thing.n! -= amount;
      } else if (thing.holds) pockets.push({ list: thing.holds, from: thing.label });
    }
  }
  return moved;
}
