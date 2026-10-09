// A judge reads the stored journal from outside the story. Nothing is replayed, and nothing here touches the disk.
import { createHash, randomUUID } from 'node:crypto';
import { ModelError } from './chatgpt.ts';
import type { Message } from './chatgpt.ts';
import type { Respond } from './model.ts';
import { cut, isObject, sizeOf, wordsOf } from './reading.ts';

export const INSTRUCTIONS = `You are reading a finished run of a story that several people lived through together. Each of them was played by a model that saw only what that person perceived, and another model, the world, said what came of their deeds and spoke for anyone else they talked to, such as a waiter. Going somewhere, waiting and sleeping need no such answer, and neither does what one of them says to another: the rules settle them. You are none of them and you change nothing: you look at the run from outside and find what is wrong with it.

The run is a list of numbered records in the order they happened. A record is what someone said or did, what the world answered, an arrival, a waking, a change the rules bring on their own, such as the weather turning, or a rewrite of someone's memory. A record may carry fields that this text does not explain, shown as they were saved, as \`name: value\`: build no finding on a guess at what such a field means or counts.

A person holds the one text they remember, which at the start is their first memory, and after it, word for word, the lines of what they have perceived since. A rewrite of memory comes when those lines grow past a limit, and when a person wakes from sleep with something lived through since the last rewrite: it folds the text and the older lines, up to a record that show names when it is known, into one new text, and the later lines stay as they are. Whatever of the old text and of the folded lines the new text does not hold is gone for that person; a rewrite that gave no text leaves the old text as it was, and only the folded lines are gone. A rewrite is asked to begin with what the person wants and what has changed in them, then to keep what will be needed later, such as what is owed and to whom, what was promised and by when, sums agreed, times set, where a thing was put and what the person knows about people, and to leave out passing chores and small talk: a loss is a fault when it is of what was to be kept. A person also knows what every turn tells them and no record holds: the world's title and the names of its places, what the world and each place say under \`about\`, though not under \`facts\`, which places are next door to which, where they are and how far each other place is, the names of the people whom models play, the means of remote contact, their own sheet, looks, pose and tiredness, the things they carry, what those hold and what that holds, no deeper, the time, exact where a clock is at hand and a guess where none is, in some runs how much of the story is left, the weather as it reaches their place, and who is in the place with them: the others whom models play, with how they look, their pose and what they are seen to carry, the people of that place whom no model plays, with their names and looks, and the crowd around. They know nothing else that they did not perceive: not what another carries out of sight, thinks or notes, not the people whom no model plays in a place where they have not been, and not what happened where they were not. So before you call anything in a rewrite invented or lost, compare the two texts that show gives with it, and the records it folded.

Each person is busy for as long as what they do lasts: a deed, a walk, a wait, a sleep. Whoever is free first acts next. A deed and a wait end early when someone speaks, comes or leaves nearby or calls the person from elsewhere, when something is heard from next door, and at every record of the weather that reaches their place, changed or not: whoever was at it is free then, or as soon as what they are saying and what they are hearing is over. A sleep ends early only when the world says that a deed wakes the sleeper: it then ends at the moment that deed was to end, even if the deed itself is cut short, or sooner if the sleep was already due to end sooner, by its own span or by an earlier deed that wakes. A walk never ends early. So a person's next record may come before the seconds of their deed or wait have passed, even seconds into a wait of an hour, and that is no fault of the run.

You read with tools, one in every answer:
- log lists the records from \`from\` to \`to\`, a line for each: its number, the clock, who, and the first words. Rewrites of memory are marked. With \`from\` null it goes on where log stopped.
- show gives the records from \`from\` to \`to\` in full, with private notes and the world's answers, as many as fit one answer, and says where to go on; a record too long for one answer comes in parts, each under its number. A rewrite of memory comes with the numbers of the records it folded, when they are known, and with the text it replaced. With \`from\` and \`who\` null it goes on where show stopped, not where log did. With \`who\` and no numbers it gives a person, a place or a thing of the world as the story began, cut when it is long: for a person the sheet, the first memory and the things carried.
- diff gives the memory of \`who\` as it was before the record \`from\` and as it is after the record \`to\`, each cut when it is long, and says which records each rewrite between them folded. With no numbers it compares the beginning of the run with its end.
- report ends your work. \`summary\` is your short answer to the task. While records have not been shown, a first report is answered once with what is left unread, and the next report ends the work; on your last answer a report ends it at once.
A field that a tool does not use is null.

What you find goes into \`found\`, in the same answer in which the text is still before you: \`kind\` is one of the kinds below, \`at\` holds the numbers of the records it is about, four at most, \`quote\` is a few words copied exactly from one of those records, and \`says\` tells in one sentence what is wrong. With nothing to hand in, \`found\` is an empty list. Hand in only what is wrong: a doubt, or a check that found nothing wrong, belongs in \`notes\`. You are told of each finding whether it was kept: do not hand in again one that was. Only a record can be quoted, not a sheet or a place. What is missing has no words of its own: quote the words it should have followed from, such as the promise that was made. For what a rewrite of memory dropped, name the rewrite: the quote may then also come from the memory it replaced. \`quote\` and \`says\` are cut at 40 words each. \`drop\` holds the numbers of kept findings that you now see were mistaken: they are taken back, and you are told. Otherwise it is an empty list.

You do not keep all you have read: older answers of the tools leave your view. What stays is the list of your findings, without their quotes, and \`notes\`, a short text of your own, 150 words at most, that you may rewrite in any answer: where you are, what to look for next, what to compare later. An empty \`notes\` leaves it as it was.

Read the whole run in order with show unless the task says otherwise: log gives only the first words of a record, to find a place by. The number of your answers is limited: the first message says how many you have, and you are told when few are left. What you hand in or take back with the report that ends your work is checked like the rest, and you are not told what became of it. Write \`notes\`, \`says\` and \`summary\` in the language of the task, whatever language the run is in and wherever its story is set.`;

export type StoredEntry = { seq: number; record: unknown; event: unknown; by: string | null };
export type Questions = { task: string; kinds: { [id: string]: string } };
export class EvalError extends Error {}
const QUESTIONS = 'The questions file cannot be used: it needs a task and 1 to 12 kinds, with ids of lower-case letters, digits and `-`, and a text for each.';
export function readQuestions(value: unknown): Questions {
  if (!isObject(value) || typeof value.task !== 'string' || !value.task.trim() || !isObject(value.kinds)) throw new EvalError(QUESTIONS);
  const kinds = Object.entries(value.kinds);
  if (kinds.length < 1 || kinds.length > 12 || kinds.some(([id, text]) => !/^[a-z0-9-]+$/.test(id) || typeof text !== 'string' || !text.trim())) throw new EvalError(QUESTIONS);
  return { task: value.task, kinds: value.kinds as Questions['kinds'] };
}

type Tool = 'log' | 'show' | 'diff' | 'report';
type Found = { kind: string; at: number[]; quote: string; says: string };
type Answer = { notes: string; drop: number[]; found: Found[]; tool: Tool; from: number | null; to: number | null; who: string | null; summary: string | null };
export type Finding = Found & { n: number; clocks: string[] };
type Refused = 'quote' | 'record' | 'duplicate' | 'full';
type Usage = { n: number; tool: Tool | null; from: number | null; to: number | null; who: string | null; kept: number; words: number; ms: number; input: number | null; cached: number | null; output: number | null; reasoning: number | null; error?: string };
export type EvalReport = { status: 'done' | 'failed'; reason?: string; httpStatus?: number; providerCode?: string; param?: string; model: string; world?: 'matches' | 'unverified'; records: number; shown: number;
  findings: Finding[]; dropped: (Finding & { call: number })[]; unkept: (Found & { call: number; why: Refused })[]; refused: { [reason in Refused]: number }; notes: string; summary: string; calls: number; invalid: number; usage: Usage[] };
export type Eval = { entries: Iterable<StoredEntry>; world: unknown; questions: Questions; respond: Respond; model: string; name?: string;
  calls?: number; window?: number; cache?: string; worldCheck?: EvalReport['world'] };

export const schemaOf = (questions: Questions, last = false) => ({ type: 'object', additionalProperties: false,
  required: ['notes', 'drop', 'found', 'tool', 'from', 'to', 'who', 'summary'], properties: {
    notes: { type: 'string' }, drop: { type: 'array', items: { type: 'integer' } }, found: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'at', 'quote', 'says'], properties: {
      kind: { type: 'string', enum: Object.keys(questions.kinds) }, at: { type: 'array', items: { type: 'integer' } },
      quote: { type: 'string' }, says: { type: 'string' } } } },
    tool: { type: 'string', enum: last ? ['report'] : ['log', 'show', 'diff', 'report'] }, from: { type: ['integer', 'null'] }, to: { type: ['integer', 'null'] },
    who: { type: ['string', 'null'] }, summary: { type: ['string', 'null'] } } });
const exact = (value: { readonly [field: string]: unknown }, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function readAnswer(text: string, questions: Questions, last: boolean): Answer | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  if (!isObject(value) || !exact(value, ['notes', 'drop', 'found', 'tool', 'from', 'to', 'who', 'summary']) || typeof value.notes !== 'string'
    || !Array.isArray(value.drop) || !value.drop.every(Number.isSafeInteger)
    || !Array.isArray(value.found) || !value.found.every(item => isObject(item) && exact(item, ['kind', 'at', 'quote', 'says'])
      && typeof item.kind === 'string' && Object.hasOwn(questions.kinds, item.kind) && Array.isArray(item.at)
      && item.at.every(Number.isSafeInteger) && typeof item.quote === 'string' && typeof item.says === 'string')
    || !(last ? ['report'] : ['log', 'show', 'diff', 'report']).includes(value.tool as string)
    || ![value.from, value.to].every(n => n === null || Number.isSafeInteger(n))
    || !(value.who === null || typeof value.who === 'string') || !(value.summary === null || typeof value.summary === 'string')) return null;
  return { ...value, who: typeof value.who === 'string' ? value.who.trim() || null : null } as Answer;
}

const fields = (value: unknown) => isObject(value) ? value : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const printed = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? '';
const empty = (value: unknown) => value === null || value === undefined || value === false || value === '' || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length);
const clock = (entry: StoredEntry) => string(fields(entry.event).clock) || `+${printed(fields(entry.event).at ?? fields(entry.record).at ?? '')} s`;
const head = (entry: StoredEntry) => {
  const event = fields(entry.event), record = fields(entry.record);
  return `#${entry.seq} ${clock(entry)} [${printed(event.place ?? '')}] ${printed(event.who ?? record.who ?? '')} ${printed(event.kind ?? record.kind ?? '')}`;
};
const memory = (entry: StoredEntry) => fields(entry.record).kind === 'memory';
const rewriteText = (entry: StoredEntry) => {
  const record = fields(entry.record), event = fields(entry.event);
  return typeof record.text === 'string' ? record.text : typeof event.text === 'string' ? event.text : undefined;
};
const personOf = (entry: StoredEntry) => string(fields(entry.record).who ?? fields(entry.event).who);
const normalized = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/((?<=\p{N})[,.](?=\p{N})|(?<=\p{L})['\u2019](?=\p{L}))|[^\p{L}\p{N}]/gu, (sign, kept) => kept ? sign === '\u2019' ? "'" : sign : ' ')
  .replace(/ +/g, ' ').trim();
const contains = (text: string, quote: string) => ` ${normalized(text)} `.includes(` ${quote} `);
const UNUSABLE = 'Your answer could not be used; answer with one object of the schema.';
const NO_RECORD = 'There is no such record or range in this journal.';
const NO_PERSON = 'There is no such person in this world file.';
const NO_THING = 'There is no such person, place or thing in this world file.';
const reasons = { quote: 'the quote is not in the records named', record: 'no such record', duplicate: 'the same as an earlier one', full: 'the list is full, at 50' };

export async function runEval({ entries, world, questions: given, respond, model, name, calls: most = 60, window = 6000, cache = randomUUID(), worldCheck }: Eval): Promise<EvalReport> {
  if (!Number.isSafeInteger(most) || most < 1 || !Number.isSafeInteger(window) || window < 1) throw new EvalError('The call and window limits must be whole numbers above zero.');
  const questions = readQuestions(given), journal = [...entries], records = new Map(journal.map(entry => [entry.seq, entry]));
  const source = fields(world), lists = ['characters', ...Object.keys(source).filter(key => key !== 'characters')]
    .flatMap(key => Array.isArray(source[key]) ? [[key, source[key].filter(isObject).filter(item => typeof item.id === 'string')] as const] : [])
    .filter(([, items]) => items.length);
  const people = lists.find(([key]) => key === 'characters')?.[1] ?? [], things = lists.flatMap(([, items]) => items);
  const find = (who: string | null, items = things) => who === null ? undefined : items.find(item => item.id === who)
    ?? items.find(item => string(item.id).toLowerCase() === who.toLowerCase() || string(item.name).toLowerCase() === who.toLowerCase());
  const rewrites = journal.filter(memory), first = journal[0], end = journal.at(-1);
  const report: EvalReport = { status: 'failed', reason: 'calls', model: name ?? model, ...(worldCheck === undefined ? {} : { world: worldCheck }), records: journal.length, shown: 0,
    findings: [], dropped: [], unkept: [], refused: { quote: 0, record: 0, duplicate: 0, full: 0 }, notes: '', summary: '', calls: 0, invalid: 0, usage: [] };
  if (!journal.length) return Object.assign(report, { reason: 'empty_journal' });
  const seen = new Set<number>(), portions = new Map<number, [number, number][]>();
  type Part = { seq: number; from: number; to: number; length: number };
  let showing: Part[] = [], asked = false;
  let logged: number | null = null, displayed: number | null = null;
  let partial: { seq: number; offset: number } | null = null;
  const runHead: Message = { role: 'user', content: [
    `Title: ${printed(source.title ?? '')}`, `First record: #${first.seq} ${clock(first)}`,
    ...(end ? [`Last record: #${end.seq} ${clock(end)}`] : []),
    ...['about', 'facts'].filter(key => string(source[key]).trim()).map(key => `${key === 'about' ? 'About' : 'Facts'}: ${cut(string(source[key]), 150).text}`),
    ...lists.flatMap(([key, items]) => [`${key}:`, ...items.map(item => `${item.id}: ${printed(item.name ?? item.id)}`)]),
    rewrites.length ? 'Memory rewrites (first 30):' : 'Memory rewrites: none.', ...rewrites.slice(0, 30).map(entry => `#${entry.seq} ${personOf(entry)}`),
    ...(rewrites.length > 30 ? [`${rewrites.length - 30} more rewrites are in the journal.`] : []), `You have ${most} answers.`,
    'No record is in this message: ask for them with show.' ].join('\n') };
  const system = `${INSTRUCTIONS}\n\nTask: ${questions.task}\nKinds:\n${Object.entries(questions.kinds).map(([id, text]) => `${id}: ${text}`).join('\n')}`;
  const owned = createHash('sha256').update(JSON.stringify([cache, 'eval'])).digest('hex').slice(0, 32);
  let carried = '', unusable = 0, numbered = 0;
  const pairs: { answer: Message; tool: Message; words: number; showing: Part[]; carried: boolean }[] = [];
  const fail = (reason: string, error?: ModelError) => Object.assign(report, { reason, ...(error?.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...(error?.providerCode ? { providerCode: error.providerCode } : {}), ...(error?.param ? { param: error.param } : {}) });
  const remaining = () => most - report.calls;
  const warning = () => remaining() <= 5 ? `\n${remaining()} ${remaining() === 1 ? 'answer' : 'answers'} left.${remaining() === 1 ? ' The next answer must use report; its schema allows only report.' : ''}` : '';
  const continuation = () => partial ? `Show goes on within #${partial.seq}.` : displayed === null ? 'Show starts at the first record.'
    : displayed === end?.seq ? 'Show has reached the last record.' : `Show goes on after #${displayed}.`;
  const range = (from: number | null, to: number | null, after: number | null) => {
    if ((from !== null && !records.has(from)) || (to !== null && !records.has(to)) || (from !== null && to !== null && from > to)) return null;
    return journal.filter(entry => (from === null ? after === null || entry.seq > after : entry.seq >= from) && (to === null || entry.seq <= to));
  };
  const memoryAt = (who: string, at: number, before = false) => {
    const person = people.find(person => person.id === who);
    let text = person ? printed(person.memory ?? '') : undefined;
    for (const entry of rewrites) if (personOf(entry) === who && (before ? entry.seq < at : entry.seq <= at)) text = rewriteText(entry) ?? text;
    return text;
  };
  const spans = new Map<number, string>(), bounds = new Map<string, number | null>();
  for (const entry of rewrites) {
    const who = personOf(entry), previous = bounds.get(who), value = fields(entry.record).upTo;
    const upTo = typeof value === 'number' && Number.isSafeInteger(value) && value >= first.seq && value < entry.seq
      && (previous == null || value > previous) ? value : null;
    spans.set(entry.seq, upTo === null ? 'an unknown range' : previous === null ? `up to #${upTo}` : `#${previous === undefined ? first.seq : previous + 1} to #${upTo}`);
    bounds.set(who, upTo);
  }
  const shown = (entry: StoredEntry) => {
    const event = fields(entry.event), text: string[] = [];
    if (memory(entry)) {
      const who = personOf(entry), before = memoryAt(who, entry.seq, true), after = rewriteText(entry), span = spans.get(entry.seq)!;
      text.push(span === 'an unknown range' ? `Folds an unknown range of ${who}'s lines.` : `Folds ${who}'s lines ${span.startsWith('#') ? `of ${span}` : span}; later lines stay as they are.`);
      if (after === undefined) text.push('The rewrite gave no text: the memory stayed as it was, and the folded lines are gone.',
        ...(before === undefined ? ['Memory: unknown.'] : [`Memory (${sizeOf(before)} words):`, before]));
      else text.push(...(before ? [`Memory before (${sizeOf(before)} words):`, before] : [`Memory before: ${before === undefined ? 'unknown' : 'none'}.`]), `Memory after (${sizeOf(after)} words):`, after);
    } else if (!empty(event.text)) text.push(printed(event.text));
    return [head(entry), ...text, ...Object.entries(event)
      .filter(([key, value]) => !['at', 'clock', 'place', 'who', 'kind', 'text', 'by'].includes(key) && !empty(value)).map(([key, value]) => `${key}: ${printed(value)}`)].join('\n');
  };
  const tool = (answer: Answer, unread: StoredEntry[]): string => {
    let { from, to } = answer;
    const wanted = answer.who;
    const item = answer.tool === 'diff' ? find(answer.who, people)
      : answer.tool === 'show' && from === null && to === null ? find(answer.who) : undefined;
    const who = answer.who = item ? string(item.id) : null;
    if (answer.tool === 'report') return unread.length
      ? `${unread.length} of ${journal.length} records have not been shown; the first of them is #${unread[0].seq}. Read them with show, or answer report again to end with them unread.`
      : 'The report is complete.';
    if (answer.tool === 'diff') {
      if (who === null) return NO_PERSON;
      from ??= first?.seq ?? null;
      to ??= end?.seq ?? null;
      if (from === null || to === null || !records.has(from) || !records.has(to) || from > to) return NO_RECORD;
      const before = memoryAt(who, from, true)!, after = memoryAt(who, to)!;
      const changes: string[] = [];
      for (const entry of rewrites) if (personOf(entry) === who && entry.seq >= from && entry.seq <= to)
        changes.push(`#${entry.seq} folds ${spans.get(entry.seq)}${rewriteText(entry) === undefined ? '; lost: left the text and dropped the lines all the same' : ''}.`);
      const left = cut(before, 1500), right = cut(after, 1500);
      return [`Before #${from} (${sizeOf(before)} words${left.cut ? '; cut at 1500' : ''}):`, left.text,
        `After #${to} (${sizeOf(after)} words${right.cut ? '; cut at 1500' : ''}):`, right.text, ...changes].join('\n');
    }
    if (answer.tool === 'show' && from === null && to === null && wanted !== null) {
      if (!item) return NO_THING;
      const firstFields = people.includes(item) ? ['name', 'looks', 'sheet', 'memory'] : ['name'];
      const view = [...firstFields, ...Object.keys(item).filter(key => key !== 'id' && !firstFields.includes(key))]
        .filter(key => !empty(item[key])).map(key => ({ key, text: `${key}: ${printed(item[key])}` }));
      const full = view.map(field => field.text).join('\n'), kept = cut(full, 1500);
      let through = 0;
      const missing = view.filter(field => { through += field.text.length + 1; return through - 1 > kept.text.length; }).map(field => field.key);
      return kept.text + (kept.cut ? `\nCut at 1500 words of ${sizeOf(full)}. Not shown in full: ${missing.join(', ')}.` : '');
    }
    const selected = range(answer.tool === 'show' && from === null && partial ? partial.seq : from, to, answer.tool === 'log' ? logged : displayed);
    if (selected === null) return NO_RECORD;
    if (!selected.length) return 'There are no more records in this range.';
    const lines: string[] = [];
    let count = 0;
    for (const entry of selected) {
      if (answer.tool === 'log') {
        if (count === 80) break;
        const event = fields(entry.event), value = memory(entry) ? rewriteText(entry) : event.text;
        const text = empty(value) ? empty(event.to) ? '' : `to ${printed(event.to)}` : wordsOf(printed(value)).slice(0, 10).join(' ');
        lines.push(`${head(entry)} ${text}${memory(entry) ? ` [memory rewrite; folds ${spans.get(entry.seq)}]` : ''}`);
        logged = entry.seq;
      } else {
        if (from !== null) partial = null;
        const full = shown(entry), offset = partial?.seq === entry.seq ? partial.offset : 0, text = full.slice(offset), label = offset ? `#${entry.seq} goes on:\n` : '';
        if (sizeOf([...lines, label + text].join('\n\n')) > 1480) {
          if (!count) {
            let kept = cut(text, 1480 - sizeOf(label)).text || text.slice(0, (1480 - sizeOf(label)) * 10).replace(/[\uD800-\uDBFF]$/, '');
            if (/\S/.test(text[kept.length] ?? '')) {
              const word = kept.search(/\S+$/);
              if (word > 0) kept = kept.slice(0, word);
            }
            showing.push({ seq: entry.seq, from: offset, to: offset + kept.length, length: full.length });
            partial = { seq: entry.seq, offset: offset + kept.length };
            return `${label}${kept}\n\nContinue within #${entry.seq} with show and from null.`;
          }
          break;
        }
        lines.push(label + text);
        showing.push({ seq: entry.seq, from: offset, to: full.length, length: full.length });
        displayed = entry.seq;
        partial = null;
      }
      count += 1;
    }
    if (count < selected.length) lines.push(`Continue at #${selected[count].seq}, or use ${answer.tool} with from null.`);
    else if (journal.some(entry => entry.seq > selected.at(-1)!.seq)) lines.push(`Continue after #${selected.at(-1)!.seq} with ${answer.tool} and from null.`);
    else lines.push('End of the journal.');
    return lines.join(answer.tool === 'log' ? '\n' : '\n\n');
  };
  const keep = (items: Found[]) => items.map((item, index) => {
    const at = [...new Set(item.at.slice(0, 4))].sort((a, b) => a - b), quote = cut(item.quote.normalize('NFC'), 40).text, says = cut(item.says, 40).text, quoted = normalized(item.quote);
    const refused: Refused | null = !at.length || at.some(n => !records.has(n)) ? 'record'
      : !quoted || !at.some(n => contains(shown(records.get(n)!), quoted)) ? 'quote'
      : report.findings.some(found => found.kind === item.kind && JSON.stringify(found.at) === JSON.stringify(at) && normalized(found.quote) === normalized(quote)) ? 'duplicate'
      : report.findings.length >= 50 ? 'full' : null;
    if (refused) {
      report.refused[refused] += 1;
      if (report.unkept.length < 50) report.unkept.push({ call: report.calls, kind: item.kind, at, quote, says, why: refused });
      return `Finding ${index + 1} not kept: ${reasons[refused]}.`;
    }
    const n = ++numbered;
    report.findings.push({ n, kind: item.kind, at, clocks: at.map(n => clock(records.get(n)!)), quote, says });
    return `Finding ${index + 1} kept as #${n}.`;
  });
  const drop = (numbers: number[]) => numbers.map(n => {
    const index = report.findings.findIndex(finding => finding.n === n);
    if (index < 0) return `There is no kept finding #${n}.`;
    const [finding] = report.findings.splice(index, 1);
    if (report.dropped.length < 50) report.dropped.push({ ...finding, call: report.calls });
    return `Finding #${n} taken back.`;
  });
  // Made anew only when answers leave the window or a finding is taken back: a first message that changed with
  // every answer would be read afresh by a service that keeps what it has read.
  const carriedText = () => [ 'Earlier answers have left the window.', `Notes: ${report.notes}`, 'Kept findings:',
    ...report.findings.map(found => `#${found.n} ${found.kind} [${found.at.join(', ')}]: ${found.says}`) ].join('\n');
  const compact = () => {
    if (pairs.length < 2 || pairs.reduce((sum, pair) => sum + pair.words, 0) <= window) return;
    const before = pairs.length;
    while (pairs.length > 1 && pairs.reduce((sum, pair) => sum + pair.words, 0) > window / 2) {
      const index = pairs.findIndex((pair, i) => pair.carried && i < pairs.length - 1);
      if (index < 0) break;
      pairs.splice(index, 1);
    }
    if (pairs.length === before) return;
    carried = carriedText();
  };
  while (report.calls < most) {
    compact();
    const last = report.calls + 1 === most;
    const messages = [{ ...runHead, content: runHead.content + (carried ? `\n\n${carried}` : '')
      + (most === 1 ? '\nThis is the last request. Use report; the schema allows only report.' : '') }, ...pairs.flatMap(pair => [pair.answer, pair.tool])];
    const row: Usage = { n: ++report.calls, tool: null, from: null, to: null, who: null, kept: 0, words: 0, ms: 0, input: null, cached: null, output: null, reasoning: null };
    report.usage.push(row);
    const began = performance.now();
    let text = '';
    let failure: ModelError | undefined;
    try {
      const answer = await respond({ model, system, messages, schema: schemaOf(questions, last), cache: owned });
      text = answer.text;
      Object.assign(row, { input: answer.usage?.inputTokens ?? null, cached: answer.usage?.cachedInputTokens ?? null,
        output: answer.usage?.outputTokens ?? null, reasoning: answer.usage?.reasoningTokens ?? null });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      row.error = error.code;
      if (!['output_limit', 'declined'].includes(error.code)) { fail(error.code, error); break; }
      failure = error;
    } finally { row.ms = Math.round(performance.now() - began); }
    if (!failure) for (const pair of pairs) {
      pair.carried = true;
      for (const part of pair.showing) {
        const spans = portions.get(part.seq) ?? [];
        spans.push([part.from, part.to]);
        portions.set(part.seq, spans);
        let through = 0;
        for (const [from, to] of spans.sort((a, b) => a[0] - b[0])) {
          if (from > through) break;
          through = Math.max(through, to);
        }
        if (through === part.length) seen.add(part.seq);
      }
      pair.showing = [];
    }
    const answer = row.error ? null : readAnswer(text, questions, last);
    const assistant: Message = { role: 'assistant', content: answer ? text : text.trim() ? cut(text, 60).text : '{}' };
    if (!answer) {
      report.invalid += 1;
      if (++unusable === 3) { fail(row.error ?? 'invalid', failure); break; }
      const content = `${UNUSABLE}\n${continuation()}` + warning();
      row.words = sizeOf(content);
      pairs.push({ answer: assistant, tool: { role: 'user', content }, words: sizeOf(assistant.content) + row.words, showing: [], carried: false });
      continue;
    }
    unusable = 0;
    row.tool = answer.tool;
    if (answer.notes.trim()) report.notes = cut(answer.notes, 150).text;
    if (answer.summary !== null) report.summary = cut(answer.summary, 300).text;
    const had = report.findings.length, receipts = drop(answer.drop), before = report.findings.length;
    receipts.push(...keep(answer.found));
    row.kept = report.findings.length - before;
    if (carried && before < had) carried = carriedText();
    showing = [];
    const unread = answer.tool === 'report' && !last && !asked ? journal.filter(entry => !seen.has(entry.seq)) : [];
    if (unread.length) asked = true;
    if (answer.tool === 'report' && !unread.length) {
      Object.assign(row, { from: answer.from, to: answer.to, who: null });
      report.status = 'done'; delete report.reason; break;
    }
    const content = [...receipts, tool(answer, unread), ...(showing.length || unread.length ? [] : [continuation()])].join('\n') + warning();
    Object.assign(row, { from: answer.from, to: answer.to, who: answer.who, words: sizeOf(content) });
    pairs.push({ answer: assistant, tool: { role: 'user', content }, words: sizeOf(assistant.content) + row.words, showing, carried: false });
  }
  report.shown = seen.size;
  return report;
}
