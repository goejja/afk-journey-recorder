import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ROW_LENGTHS } from '../../domain/map.js';
import { mapsContract, type GameMap } from '../../shared/contracts/maps.js';
import { fail, serve } from '../contract.js';

interface MapRow {
  name: string;
  tags: string;
  row_lengths: string;
  cells: string;
  original_cells: string | null;
  source: 'import' | 'manual';
}

function toJson(row: MapRow): GameMap {
  return {
    name: row.name,
    tags: JSON.parse(row.tags) as string[],
    rowLengths: JSON.parse(row.row_lengths) as number[],
    cells: JSON.parse(row.cells) as number[],
    source: row.source,
    // An edited import can go back to its scraped version.
    canRestore: row.original_cells !== null && row.original_cells !== row.cells,
  };
}

/** Routes for the map menu: list, create, edit, duplicate, delete and restore. */
export function mapRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const find = (name: string) => db.prepare('SELECT * FROM map WHERE name = ?').get(name) as MapRow | undefined;

  serve(app, mapsContract.list, () => (db.prepare('SELECT * FROM map ORDER BY name').all() as MapRow[]).map(toJson));

  serve(app, mapsContract.get, ({ params }) => {
    const row = find(params.name);
    return row ? toJson(row) : fail(404, 'Unknown map');
  });

  serve(app, mapsContract.create, ({ body }) => {
    const name = body.name;
    if (find(name)) return fail(409, `A map named "${name}" already exists`);
    db.prepare(
      `INSERT INTO map (name, tags, row_lengths, cells, original_cells, source) VALUES (?, ?, ?, ?, NULL, 'manual')`,
    ).run(name, JSON.stringify(body.tags), JSON.stringify(ROW_LENGTHS), JSON.stringify(body.cells));
    return toJson(find(name)!);
  });

  serve(app, mapsContract.save, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown map');
    const name = body.name;
    if (name !== current.name && find(name)) return fail(409, `A map named "${name}" already exists`);
    const tags = JSON.stringify(body.tags);
    const cells = JSON.stringify(body.cells);
    if (name === current.name && tags === current.tags && cells === current.cells) return toJson(current);
    // Any edit makes the map the player's own, so a re-import never overwrites it.
    db.prepare(`UPDATE map SET name = ?, tags = ?, cells = ?, source = 'manual' WHERE name = ?`).run(
      name,
      tags,
      cells,
      current.name,
    );
    return toJson(find(name)!);
  });

  serve(app, mapsContract.duplicate, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown map');
    const name = body.name;
    if (find(name)) return fail(409, `A map named "${name}" already exists`);
    db.prepare(
      `INSERT INTO map (name, tags, row_lengths, cells, original_cells, source) VALUES (?, ?, ?, ?, NULL, 'manual')`,
    ).run(name, current.tags, current.row_lengths, current.cells);
    return toJson(find(name)!);
  });

  serve(app, mapsContract.restore, ({ params }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown map');
    if (current.original_cells === null) return fail(409, 'This map has no imported original');
    db.prepare(`UPDATE map SET cells = original_cells, source = 'import' WHERE name = ?`).run(current.name);
    return toJson(find(current.name)!);
  });

  serve(app, mapsContract.remove, ({ params }) => {
    db.prepare('DELETE FROM map WHERE name = ?').run(params.name);
  });

  return app;
}
