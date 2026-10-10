// journal.ts rebuilds all other state from the saved records.
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { StateError } from './journal.ts';
import type { Entry, Store } from './journal.ts';
import type { StoredEntry } from './eval.ts';

const FORMAT = '18', VEHICLES_FORMAT = '19', BUSES_FORMAT = '20';
// Earlier engines would ignore these settings and continue without keeping their state.
const TOUCH_FORMAT = '21', MARKS_FORMAT = '22', TRACES_FORMAT = '23', SPEECH_FORMAT = '29', WAYS_FORMAT = '30', HUNGER_FORMAT = '31';
const formatOf = (world: string) => {
  try {
    const file = JSON.parse(world);
    const rated = (person: { wordsPerMinute?: unknown } | null) => person?.wordsPerMinute !== undefined;
    return file?.hunger === true ? HUNGER_FORMAT : file?.ways === true ? WAYS_FORMAT
      : (Array.isArray(file?.characters) && file.characters.some(rated)
        || Array.isArray(file?.places) && file.places.some((place: { figures?: { wordsPerMinute?: unknown }[] } | null) => Array.isArray(place?.figures) && place.figures.some(rated))) ? SPEECH_FORMAT
      : Array.isArray(file?.characters) && file.characters.some((character: { traces?: unknown } | null) => character?.traces !== undefined) ? TRACES_FORMAT
        : file?.marks === true ? MARKS_FORMAT : file?.touch === true ? TOUCH_FORMAT
          : Array.isArray(file?.vehicles) && file.vehicles.some((vehicle: { route?: unknown }) => vehicle?.route !== undefined) ? BUSES_FORMAT
            : file?.vehicles !== undefined ? VEHICLES_FORMAT : FORMAT;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return FORMAT;
  }
};
// SQLite assigns these result codes.
const NO_SUCH = 1, BUSY = 5, READ_ONLY = 8, CANNOT_OPEN = 14, NOT_A_DATABASE = 26;
const FOREIGN = 'The state file cannot be used: it is not a state file of `live`.';
const sqliteCode = (error: unknown) => error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : null;

// An immutable connection would miss committed rows in the write-ahead file.
// Inspection must remain possible for a journal this engine cannot continue.
export function readState(path: string, world?: string, environment = ''): { entries: StoredEntry[]; world?: 'matches' | 'unverified' } {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: 0 });
    database.exec('BEGIN');
    const known = new Map(database.prepare('SELECT key, value FROM meta').all().map(row => [row.key, row.value]));
    if (!known.has('format') || typeof known.get('world') !== 'string') throw new StateError(FOREIGN);
    const entries = database.prepare('SELECT seq, record, event, by FROM journal ORDER BY seq').all().map(row => {
      try {
        return { seq: row.seq as number, record: JSON.parse(row.record as string), event: JSON.parse(row.event as string), by: row.by as string | null };
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new StateError('The state file cannot be used: a record in it is damaged.');
      }
    });
    const hash = world === undefined ? undefined : createHash('sha256').update(JSON.stringify([world, environment])).digest('hex');
    return { entries, ...(hash === undefined ? {} : { world: known.get('world') === hash ? 'matches' as const : 'unverified' as const }) };
  } catch (error) {
    if (sqliteCode(error) === BUSY) throw new StateError('The state file is in use by another run. Wait until that run ends.');
    if (sqliteCode(error) === CANNOT_OPEN || sqliteCode(error) === READ_ONLY) throw new StateError('The state file cannot be opened: it is missing, or its run was not closed and its directory cannot be written for SQLite side files.');
    if (sqliteCode(error) === NO_SUCH || sqliteCode(error) === NOT_A_DATABASE) throw new StateError(FOREIGN);
    throw error;
  } finally { database?.close(); }
}

// The same records under another environment would describe a different world.
// A transaction per step leaves a whole journal prefix if the run is killed.
// The cache name lets live.ts keep service cache names across starts while separating journals.
// It contains no secret or story text and must not be printed.
export function openState(path: string, world: string, environment = ''): Store & { close(): void; cache: string } {
  const hash = createHash('sha256').update(JSON.stringify([world, environment])).digest('hex');
  let database: DatabaseSync, cache: unknown;
  try {
    database = new DatabaseSync(path, { timeout: 0 });
    database.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE');
  } catch (error) {
    if (sqliteCode(error) === BUSY) throw new StateError('The state file is in use by another run. Wait until that run ends.');
    if (sqliteCode(error) === NOT_A_DATABASE) throw new StateError(FOREIGN);
    throw error;
  }
  try {
    // Hold the lock through these checks so no write can touch an unrecognized database.
    const fresh = !database.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get();
    if (!fresh) {
      let known: Map<unknown, unknown>;
      try { known = new Map(database.prepare('SELECT key, value FROM meta').all().map(row => [row.key, row.value])); } catch (error) {
        if (sqliteCode(error) !== NO_SUCH) throw error;
        throw new StateError(FOREIGN);
      }
      if (!known.has('format')) throw new StateError(FOREIGN);
      if (known.get('format') !== formatOf(world)) throw new StateError('The state file cannot be used: it was written by another version of `live`.');
      if (known.get('world') !== hash) throw new StateError('The state file belongs to another world file, or the world file has changed since.');
      cache = known.get('cache');
    }
    database.exec('COMMIT; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL');
    if (fresh) {
      database.exec('BEGIN; CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; '
        + 'CREATE TABLE journal (seq INTEGER PRIMARY KEY, record TEXT NOT NULL, event TEXT NOT NULL, by TEXT) STRICT');
      database.prepare('INSERT INTO meta (key, value) VALUES (?, ?), (?, ?)').run('format', formatOf(world), 'world', hash);
      database.exec('COMMIT');
    }
    if (typeof cache !== 'string') database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('cache', cache = randomUUID());
  } catch (error) {
    database.close();
    if (sqliteCode(error) === NOT_A_DATABASE) throw new StateError(FOREIGN);
    throw error;
  }
  const insert = database.prepare('INSERT INTO journal (seq, record, event, by) VALUES (?, ?, ?, ?)');
  return {
    cache: cache as string,
    // Iterate rows so a long journal need not fit in memory.
    *entries() {
      for (const row of database.prepare('SELECT seq, record, event, by FROM journal ORDER BY seq').iterate()) {
        try {
          yield { seq: row.seq as number, record: JSON.parse(row.record as string), event: JSON.parse(row.event as string), by: row.by as string | null };
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          throw new StateError('The state file cannot be used: a record in it is damaged.');
        }
      }
    },
    append(entries: Entry[]) {
      database.exec('BEGIN');
      try {
        for (const { seq, record, event, by } of entries) insert.run(seq, JSON.stringify(record), JSON.stringify(event), by);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    close() { database.close(); },
  };
}
