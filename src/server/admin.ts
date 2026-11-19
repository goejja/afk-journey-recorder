import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { openDb, SCHEMA_VERSION } from '../db/open.js';
import { adminContract } from '../shared/contracts/admin.js';
import { fail, Failure, file, readUpload, serve } from './contract.js';

const SQLITE_HEADER = 'SQLite format 3\0';
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
/** Tables made from other data and from picture files, so a restore empties them and they are made again when next read. */
const DERIVED_TABLES = new Set(['rank_look_feature', 'hero_example_feature', 'hero_look_feature', 'unit_look_feature']);
/** The Looks and Examples are rows that name a picture in `images/custom`, and the backup holds the rows only. */
const PICTURES_NOTE = 'The pictures that the Hero, Rank and Unit Looks and the Hero Examples name are not in a backup: they stay in the images folder as they are now.';
/** A backup must at least hold these, or it is some other SQLite file. */
const REQUIRED_TABLES = ['hero', 'attempt', 'roster', 'map'];

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const tablesOf = (db: Database.Database, schema: string) =>
  db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).pluck().all() as string[];
const columnsOf = (db: Database.Database, schema: string, table: string) =>
  (db.prepare(`PRAGMA ${schema}.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

/** Routes to download a backup of the database and to restore one. */
export function adminRoutes(db: Database.Database): Hono {
  const app = new Hono();

  serve(app, adminContract.backup, () => file(new Uint8Array(db.serialize()), 'application/octet-stream', { 'content-disposition': `attachment; filename="afk-backup-${stamp()}.db"` }));

  /**
   * Replaces every record with the ones in an uploaded backup. The current data is first saved next to the
   * database, so a wrong restore can be undone. The upload is only read as data: its rows are copied into
   * the existing tables, nothing in it is run.
   */
  serve(app, adminContract.restore, async (_, c) => {
    // A custom header cannot be sent by another web page without this server's permission, so a page
    // open in the browser cannot trigger a restore.
    const bytes = await readUpload(c, MAX_BACKUP_BYTES, 'The file is too large to be a backup');
    if (bytes instanceof Failure) return bytes;
    if (bytes.subarray(0, 16).toString('latin1') !== SQLITE_HEADER) return fail(400, 'This is not a database backup');

    const dir = mkdtempSync(join(tmpdir(), 'afk-restore-'));
    const file = join(dir, 'restore.db');
    try {
      writeFileSync(file, bytes);
      let source: Database.Database;
      try {
        source = new Database(file, { fileMustExist: true });
      } catch {
        return fail(400, 'This is not a database backup');
      }
      try {
        const have = new Set(tablesOf(source, 'main'));
        const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
        if (missing.length) return fail(400, `This is not a backup of this app's database (no ${missing.join(', ')} table)`);
        if (source.pragma('integrity_check', { simple: true }) !== 'ok') return fail(400, 'The backup file is damaged');
        const version = source.pragma('user_version', { simple: true }) as number;
        if (version > SCHEMA_VERSION) return fail(400, `This backup is from a newer version of the app (database version ${version}, this app knows up to ${SCHEMA_VERSION}): nothing was changed`);
      } catch {
        return fail(400, 'This is not a database backup');
      } finally {
        source.close();
      }
      // An older backup is brought to this version first, in the uploaded copy, so that every table of this version is in it and
      // none of the live ones is emptied for want of a table the backup was made before.
      try {
        openDb(file).close();
      } catch (e) {
        return fail(400, `This backup does not fit this version of the app: ${(e as Error).message.replaceAll(file, 'the backup')}`);
      }

      let savedAs: string | null = null;
      if (db.name && db.name !== ':memory:') {
        const folder = join(dirname(db.name), 'backups');
        mkdirSync(folder, { recursive: true });
        savedAs = join(folder, `before-restore-${stamp()}.db`);
        writeFileSync(savedAs, db.serialize());
      }

      db.pragma('foreign_keys = OFF'); // rows are copied table by table; the whole result is checked at the end
      try {
        db.prepare('ATTACH DATABASE ? AS restore').run(file);
        try {
          const rows = db.transaction(() => {
            const backedUp = new Set(tablesOf(db, 'restore'));
            let copied = 0;
            for (const table of tablesOf(db, 'main')) {
              // derived rows would point at looks that are no longer the same ones
              if (DERIVED_TABLES.has(table)) {
                db.exec(`DELETE FROM main."${table}"`);
                continue;
              }
              // a table the backup does not have keeps what it holds
              if (!backedUp.has(table)) continue;
              db.exec(`DELETE FROM main."${table}"`);
              const inBackup = new Set(columnsOf(db, 'restore', table));
              const shared = columnsOf(db, 'main', table).filter((name) => inBackup.has(name));
              if (shared.length === 0) continue;
              const list = shared.map((name) => `"${name}"`).join(', ');
              copied += db.prepare(`INSERT INTO main."${table}" (${list}) SELECT ${list} FROM restore."${table}"`).run().changes;
            }
            // Keeps record numbers from being reused; the sequence table is internal and may be absent.
            if (db.prepare("SELECT 1 FROM restore.sqlite_master WHERE name = 'sqlite_sequence'").get()) {
              db.exec('DELETE FROM main.sqlite_sequence');
              db.exec('INSERT INTO main.sqlite_sequence SELECT * FROM restore.sqlite_sequence');
            }
            if ((db.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('The backup does not fit this version of the app (broken links between records)');
            return copied;
          })();
          return { restoredRows: rows, savedAs, note: PICTURES_NOTE };
        } finally {
          db.exec('DETACH DATABASE restore');
        }
      } catch (e) {
        return fail(400, `Restore failed, nothing was changed: ${(e as Error).message}`);
      } finally {
        db.pragma('foreign_keys = ON');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return app;
}
