import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { normalizeTags } from '../../domain/tags.js';
import { tagsContract, type TagCount } from '../../shared/contracts/tags.js';
import { fail, serve } from '../contract.js';

/** The tags of a record. */
export const loadTags = (db: Database.Database, attemptId: number): string[] =>
  db.prepare('SELECT tag FROM attempt_tag WHERE attempt_id = ? ORDER BY tag').pluck().all(attemptId) as string[];

/** Replaces the tags of a record; `undefined` leaves them as they are. */
export function saveTags(db: Database.Database, attemptId: number, tags: string[] | undefined): void {
  if (tags === undefined) return;
  db.prepare('DELETE FROM attempt_tag WHERE attempt_id = ?').run(attemptId);
  const insert = db.prepare('INSERT INTO attempt_tag (attempt_id, tag) VALUES (?, ?)');
  for (const tag of tags) insert.run(attemptId, tag);
}

/** SQL for "this attempt has one of these tags", to add to a WHERE clause of a query on `attempt a`. */
export const hasAnyTag = (tags: string[]) => ({
  clause: `a.id IN (SELECT attempt_id FROM attempt_tag WHERE tag IN (${tags.map(() => '?').join(', ')}))`,
  params: tags,
});

/** The routes of the tags in use: list, rename and remove (`tagsContract`). */
export function tagRoutes(db: Database.Database): Hono {
  const app = new Hono();
  serve(app, tagsContract.list, () => db.prepare('SELECT tag, count(DISTINCT attempt_id) AS count FROM attempt_tag GROUP BY tag ORDER BY tag').all() as TagCount[]);

  serve(app, tagsContract.rename, ({ params, body }) => {
    const cleaned = normalizeTags([body.name]);
    if ('error' in cleaned || !cleaned.tags || cleaned.tags.length !== 1) return fail(400, 'Give the new name of the tag');
    const name = cleaned.tags[0]!;
    const records = db.transaction(() => {
      const ids = db.prepare('SELECT attempt_id FROM attempt_tag WHERE tag = ?').pluck().all(params.tag) as number[];
      if (ids.length === 0) return null;
      db.prepare('DELETE FROM attempt_tag WHERE tag = ?').run(params.tag);
      const insert = db.prepare('INSERT OR IGNORE INTO attempt_tag (attempt_id, tag) VALUES (?, ?)');
      for (const id of ids) insert.run(id, name);
      return ids.length;
    })();
    return records === null ? fail(404, 'Unknown tag') : { name, records };
  });

  serve(app, tagsContract.remove, ({ params }) => {
    const removed = db.prepare('SELECT count(DISTINCT attempt_id) FROM attempt_tag WHERE tag = ?').pluck().get(params.tag) as number;
    db.prepare('DELETE FROM attempt_tag WHERE tag = ?').run(params.tag);
    return removed === 0 ? fail(404, 'Unknown tag') : { removed };
  });

  return app;
}
