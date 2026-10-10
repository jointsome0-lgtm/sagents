import type { Law } from './laws.ts';
import { amountOf, durationOf, refuse, TIME } from './reading.ts';
import { awakeIn } from './action.ts';
import { clockAt, secondsUntil, timeFor } from './time.ts';
import type { Person, World } from './world.ts';

export type Sleep = { dayStart: string; tiredHours: number; spentHours: number };
// Debt uses seconds.
export type Debt = { debt: number; since: number };
export const SPENT_SLEEP = 28_800;
const SPENT = 'You could stay awake no longer and fell asleep where you were';
const FEELS = ['You feel rested.', 'You have been awake a long while.',
  'You are tired and should sleep soon: stay awake much longer and you fall asleep where you are.',
  'You can hardly stay awake: sleep now, or you fall asleep where you are.'];
const SHOWS = ['', '', ', looks tired', ', can hardly stay awake'];

const debtAt = ({ debt, since }: Debt, asleep: boolean, now: number) => asleep ? Math.max(0, debt - 2 * (now - since)) : debt + now - since;
function weariness(world: World, debt: Debt, person: Person, now: number): 0 | 1 | 2 | 3 {
  const awake = debtAt(debt, person.asleep, now), tired = world.sleep.tiredHours * 3600, spent = world.sleep.spentHours * 3600;
  return awake >= tired + (spent - tired) * 0.75 ? 3 : awake >= tired ? 2 : awake >= tired / 2 ? 1 : 0;
}

export const sleep: Law<'sleep', 'debts'> = {
  kind: 'spent',
  fields: ['dayStart', 'tiredHours', 'spentHours'],
  read(file) {
    const dayStart = file.dayStart ?? '07:00';
    if (typeof dayStart !== 'string' || !TIME.test(dayStart)) return refuse('dayStart', 'must be a time of day like `07:00`');
    const tiredHours = amountOf(file.tiredHours, 'tiredHours', 16), spentHours = amountOf(file.spentHours, 'spentHours', 24);
    durationOf(Math.ceil(tiredHours * 3600), 'tiredHours');
    durationOf(Math.ceil(spentHours * 3600), 'spentHours');
    if (spentHours < tiredHours) return refuse('spentHours', 'must not be less than `tiredHours`');
    return { sleep: { dayStart, tiredHours, spentHours } };
  },
  begin: world => ({ debts: new Map(world.characters.map(character => [character.id, { debt: 86_400 - secondsUntil(world, 0, world.sleep.dayStart), since: 0 }])) }),
  due: (world, parts, actor) => !actor.asleep && actor.place !== null && debtAt(parts.debts.get(actor.id)!, false, actor.freeAt) >= world.sleep.spentHours * 3600
    ? { kind: 'spent', who: actor.id, at: actor.freeAt } : null,
  put(world, _parts, people, record) {
    const person = people.find(item => record.kind === 'spent' && item.id === record.who)!, place = person.place as string;
    Object.assign(person, { asleep: true, pose: null, began: record.at, freeAt: record.at + SPENT_SLEEP });
    return { event: { at: record.at, clock: clockAt(world, record.at), kind: 'sleep', who: person.id, place, to: null, text: null, seconds: SPENT_SLEEP, cut: false,
      heard: awakeIn(people, place, person).map(witness => witness.id), note: null },
    lines: new Map([[person.id, { text: `${timeFor(world, person.id, place, record.at)} ${SPENT} (${SPENT_SLEEP} s)`, idle: true }]]) };
  },
  after(parts, event) {
    if (event.kind !== 'sleep' && event.kind !== 'wake') return;
    const debt = parts.debts.get(event.who)!;
    // Charge the elapsed time before the event changed whether the person was asleep.
    Object.assign(debt, { debt: debtAt(debt, event.kind === 'wake', event.at), since: event.at });
  },
  turn: (world, parts, actor, now) => FEELS[weariness(world, parts.debts.get(actor.id)!, actor, now)],
  seen: (world, parts, person, now) => person.asleep ? '' : SHOWS[weariness(world, parts.debts.get(person.id)!, person, now)],
  size: world => Math.max(...FEELS.map(line => line.length)) + world.characters.length * Math.max(...SHOWS.map(mark => mark.length)),
};
