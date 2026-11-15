import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { adminContract } from '../shared/contracts/admin.js';
import { fail, file, serve } from './contract.js';

const SQLITE_HEADER = 'SQLite format 3\0';
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
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
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length > MAX_BACKUP_BYTES) return fail(413, 'The file is too large to be a backup');
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
      } catch {
        return fail(400, 'This is not a database backup');
      } finally {
        source.close();
      }

      let savedAs: string | null = null;
      if (db.name && db.name !== ':memory:') {
        const folder = join(dirname(db.name), 'backups');
        mkdirSync(folder, { recursive: true });
        savedAs = join(folder, `before-restore-${stamp()}.db`);
        writeFileSync(savedAs, db.serialize());
      }

      db.pragma('foreign_keys = OFF'); // rows are copied table by table; the whole result is checked at the end
      db.prepare('ATTACH DATABASE ? AS restore').run(file);
      try {
        const rows = db.transaction(() => {
          const backedUp = new Set(tablesOf(db, 'restore'));
          let copied = 0;
          for (const table of tablesOf(db, 'main')) {
            db.exec(`DELETE FROM main."${table}"`);
            if (!backedUp.has(table)) continue;
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
        return { restoredRows: rows, savedAs };
      } catch (e) {
        return fail(400, `Restore failed, nothing was changed: ${(e as Error).message}`);
      } finally {
        db.exec('DETACH DATABASE restore');
        db.pragma('foreign_keys = ON');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return app;
}
