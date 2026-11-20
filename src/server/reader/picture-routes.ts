import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { learnedPicturesContract } from '../../shared/contracts/reader.js';
import { fail, revalidated, serve } from '../contract.js';
import { rankMoveReport } from './learned.js';
import { isPictureTable, LEARNED_PICTURES, learnedPicturesRoot, LOOK_SOURCES, PICTURE_TABLES, picturePath, removeLooks } from './learned-pictures.js';

/**
 * What the Admin review does to a learned picture, the same for the four tables (`LEARNED_PICTURES`): show its file, move it to the right
 * hero, rank or name, delete it, or delete every picture of a source. What each table reads of its pictures is in `learned.ts` and `reader-examples.ts`.
 */
export function pictureRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = learnedPicturesRoot(options.imagesDir);

  // before the routes of one picture: `by-source` is not a table
  serve(app, learnedPicturesContract.removeSource, ({ params }) => {
    const source = params.source as (typeof LOOK_SOURCES)[number];
    if (!LOOK_SOURCES.includes(source)) return fail(400, 'Unknown source');
    let deleted = 0;
    for (const table of PICTURE_TABLES) {
      const rows = db.prepare(`SELECT id, file FROM ${table} WHERE source = ?`).all(source) as { id: number; file: string }[];
      removeLooks(db, root, table, rows);
      deleted += rows.length;
    }
    return { deleted };
  });

  serve(app, learnedPicturesContract.image, ({ params }, c) => {
    if (!isPictureTable(params.table)) return fail(404, 'Unknown kind of picture');
    const row = db.prepare(`SELECT file FROM ${params.table} WHERE id = ?`).get(Number(params.id)) as { file: string } | undefined;
    const path = row && picturePath(root, params.table, row.file);
    if (!path || !existsSync(path)) return fail(404, 'No picture');
    return revalidated(c, path, 'image/png');
  });

  serve(app, learnedPicturesContract.move, async ({ params, body }) => {
    const { table } = params;
    if (!isPictureTable(table)) return fail(404, 'Unknown kind of picture');
    const id = Number(params.id);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as { kind?: string } | undefined;
    if (!row) return fail(404, 'No such picture');
    const { column, in: within } = LEARNED_PICTURES[table].moves;
    const target = within === 'kind' ? row.kind! : within; // a Unit Look is an artifact or a phantimal
    if (!db.prepare(`SELECT 1 FROM ${target} WHERE name = ?`).get(body.value)) return fail(400, `Unknown ${target}`);
    const move = () => void db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(body.value, id);
    if (table !== 'rank_look') return move(), null;
    return rankMoveReport(db, root, move);
  });

  serve(app, learnedPicturesContract.remove, ({ params }) => {
    if (!isPictureTable(params.table)) return fail(404, 'Unknown kind of picture');
    const row = db.prepare(`SELECT id, file FROM ${params.table} WHERE id = ?`).get(Number(params.id)) as { id: number; file: string } | undefined;
    if (!row) return fail(404, 'No such picture');
    removeLooks(db, root, params.table, [row]);
  });

  return app;
}
