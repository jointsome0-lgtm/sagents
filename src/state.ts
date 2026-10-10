// The state file of a live world: its journal in SQLite. This is the only part of the live mode that touches the disk.
// The file holds the records with their events, and which world they belong to; everything else is rebuilt from them.
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { StateError } from './journal.ts';
import type { Entry, Store } from './journal.ts';
import type { StoredEntry } from './eval.ts';

// Vehicles keep moving places, and routes take fares and follow the clock. Other worlds keep their mark.
const FORMAT = '18', VEHICLES_FORMAT = '19', BUSES_FORMAT = '20';
// Earlier engines ignore these settings and could go on without keeping what they name.
const TOUCH_FORMAT = '21', MARKS_FORMAT = '22', TRACES_FORMAT = '23', WAYS_FORMAT = '30';
const formatOf = (world: string) => {
  try {
    const file = JSON.parse(world);
    return file?.ways === true ? WAYS_FORMAT : Array.isArray(file?.characters) && file.characters.some((character: { traces?: unknown } | null) => character?.traces !== undefined) ? TRACES_FORMAT
      : file?.marks === true ? MARKS_FORMAT : file?.touch === true ? TOUCH_FORMAT
        : Array.isArray(file?.vehicles) && file.vehicles.some((vehicle: { route?: unknown }) => vehicle?.route !== undefined) ? BUSES_FORMAT
          : file?.vehicles !== undefined ? VEHICLES_FORMAT : FORMAT;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return FORMAT;
  }
};
// SQLite's own result codes for a statement that names what the file does not have, for a file another connection
// holds, for a file or directory SQLite cannot write, for a file SQLite cannot open, and for a file that is not a database.
const NO_SUCH = 1, BUSY = 5, READ_ONLY = 8, CANNOT_OPEN = 14, NOT_A_DATABASE = 26;
const FOREIGN = 'The state file cannot be used: it is not a state file of `live`.';
const sqliteCode = (error: unknown) => error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : null;

// Reads the saved events without replaying them or changing a row. Read-only SQLite sees the last committed rows
// in the write-ahead file too; an immutable connection would miss them. The format mark is not this reader's limit.
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

// Opens the journal of the world whose file holds `world` and whose environment's file holds `environment`, or begins
// one. A journal belongs to the two together: under another environment the same records would not be the same world. The file is held until `close` or the end
// of the process, so that two runs cannot write one journal: the second is refused. A step is one transaction, and
// the file is synced at each, so a run that was killed leaves a beginning of its journal, which is a whole world.
// `cache` is a random name the file was given when it began, or when a file older than the name was first opened: the
// names of its players for a service's cache are made of it, so a world that is continued keeps them and a journal
// begun in another file has others. It is no secret and nothing of the story, and it is never printed.
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
    // Nothing is written before the file is known for a new one, with no table in it, or for a state file: a database
    // of something else is refused as it was found, and a file of another format in words. The lock stays through.
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
    // Read row by row: a journal is not held in memory whole. The texts are JSON, which keeps every character as it was.
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
