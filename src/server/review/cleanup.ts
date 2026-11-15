import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import type { CleanupSelection } from '../../domain/cleanup.js';
import { dropEmptyBattles } from '../records/battles.js';
import { cleanupContract } from '../../shared/contracts/review.js';
import { fail, serve } from '../contract.js';

/** Routes to remove old records by mode, age and tag, and to compact the database file. */
export function cleanupRoutes(db: Database.Database): Hono {
  const app = new Hono();

  /** The records a selection covers, as the tail of a query over `attempt a`. Age counts from when the record was entered. */
  function matching(selection: CleanupSelection): { from: string; params: unknown[] } {
    const where = ["a.created_at < datetime('now', ?)"];
    const params: unknown[] = [`-${selection.olderThanDays} days`];
    if (selection.mode) (where.push('COALESCE(r.mode, a.mode) = ?'), params.push(selection.mode));
    if (selection.tag) (where.push('a.id IN (SELECT attempt_id FROM attempt_tag WHERE tag = ?)'), params.push(selection.tag));
    return { from: `FROM attempt a LEFT JOIN arena_attempt r ON r.attempt_id = a.id WHERE ${where.join(' AND ')}`, params };
  }

  function selectedIds(selection: CleanupSelection): number[] {
    const { from, params } = matching(selection);
    return db.prepare(`SELECT a.id ${from}`).pluck().all(...params) as number[];
  }

  const fileSize = () =>
    (db.pragma('page_count', { simple: true }) as number) * (db.pragma('page_size', { simple: true }) as number);

  serve(app, cleanupContract.preview, ({ body }) => {
    // one query over the same records, whatever their number: a list of ids would hit SQLite's limit on variables
    const { from, params } = matching(body);
    return db.prepare(`SELECT count(*) AS count, min(a.created_at) AS oldest, max(a.created_at) AS newest ${from}`).get(...params) as { count: number; oldest: string | null; newest: string | null };
  });

  // `expectedCount` is the count the person saw in the preview and agreed to; if the selection
  // has changed since, nothing is removed and they must preview again.
  serve(app, cleanupContract.delete, ({ body }) => {
    const deleted = db.transaction(() => {
      const ids = selectedIds(body);
      if (ids.length !== body.expectedCount) return null;
      const remove = db.prepare('DELETE FROM attempt WHERE id = ?');
      for (const id of ids) remove.run(id);
      dropEmptyBattles(db);
      return ids.length;
    })();
    if (deleted === null) return fail(409, 'The records changed since the preview, nothing was removed. Preview again.');
    return { deleted };
  });

  serve(app, cleanupContract.optimize, () => {
    const before = fileSize();
    db.exec('VACUUM');
    db.exec('PRAGMA optimize');
    return { bytesBefore: before, bytesAfter: fileSize() };
  });

  return app;
}
