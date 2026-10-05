// The state file of a live world: its journal in SQLite. This is the only part of the live mode that touches the disk.
// The file holds the records with their events, and which world they belong to; everything else is rebuilt from them.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { StateError } from './journal.ts';
import type { Entry, Store } from './journal.ts';

const FORMAT = '5';
// SQLite's own result codes for a file another connection holds, and for a file that is not a database.
const BUSY = 5, NOT_A_DATABASE = 26;
const sqliteCode = (error: unknown) => error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 0xff : null;

// Opens the journal of the world whose file holds `world`, or begins one. The file is held until `close` or the end
// of the process, so that two runs cannot write one journal: the second is refused. A step is one transaction, and
// the file is synced at each, so a run that was killed leaves a beginning of its journal, which is a whole world.
export function openState(path: string, world: string): Store & { close(): void } {
  const hash = createHash('sha256').update(world).digest('hex');
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, { timeout: 0 });
    database.exec('PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; BEGIN EXCLUSIVE');
  } catch (error) {
    if (sqliteCode(error) === BUSY) throw new StateError('The state file is in use by another run. Wait until that run ends.');
    if (sqliteCode(error) === NOT_A_DATABASE) throw new StateError('The state file cannot be used: it is not a state file of `live`.');
    throw error;
  }
  try {
    // The format is looked at before the journal's table is touched, so a file of another shape is refused in words.
    database.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; '
      + 'CREATE TABLE IF NOT EXISTS journal (seq INTEGER PRIMARY KEY, record TEXT NOT NULL, event TEXT NOT NULL, by TEXT) STRICT');
    const known = new Map(database.prepare('SELECT key, value FROM meta').all().map(row => [row.key, row.value]));
    if (!known.size) database.prepare('INSERT INTO meta (key, value) VALUES (?, ?), (?, ?)').run('format', FORMAT, 'world', hash);
    else if (known.get('format') !== FORMAT) throw new StateError('The state file cannot be used: it was written by another version of `live`.');
    else if (known.get('world') !== hash) throw new StateError('The state file belongs to another world file, or the world file has changed since.');
    database.exec('COMMIT');
  } catch (error) {
    database.close();
    if (sqliteCode(error) === NOT_A_DATABASE) throw new StateError('The state file cannot be used: it is not a state file of `live`.');
    throw error;
  }
  const insert = database.prepare('INSERT INTO journal (seq, record, event, by) VALUES (?, ?, ?, ?)');
  return {
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
