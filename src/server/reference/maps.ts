import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { isDeploymentTile, OPEN_MAP, ROW_LENGTHS } from '../../domain/map.js';
import { ideasUsing } from '../../advisor/index.js';
import { mapsContract, type GameMap, type MapUses } from '../../shared/contracts/maps.js';
import { describeUsage } from './usage.js';
import { fail, serve } from '../contract.js';

interface MapRow {
  name: string;
  tags: string;
  row_lengths: string;
  cells: string;
  original_cells: string | null;
  boost_tiles: string;
  source: 'import' | 'manual';
}

function toJson(row: MapRow): GameMap {
  return {
    name: row.name,
    tags: JSON.parse(row.tags) as string[],
    rowLengths: JSON.parse(row.row_lengths) as number[],
    cells: JSON.parse(row.cells) as number[],
    boostTiles: JSON.parse(row.boost_tiles) as number[],
    source: row.source,
    // Drawn here while the import's source lacked it (an Arena map with no imported original): the next import takes it over when the source lists it (#297).
    handMade: row.source === 'manual' && row.original_cells === null && (JSON.parse(row.tags) as string[]).includes('Arena'),
    // An edited import can go back to its scraped version.
    canRestore: row.original_cells !== null && row.original_cells !== row.cells,
  };
}

const sorted = (tiles: number[]) => [...tiles].sort((a, b) => a - b);

/** Routes for the map menu: list, create, edit, duplicate, delete and restore. */
export function mapRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const find = (name: string) => db.prepare('SELECT * FROM map WHERE name = ?').get(name) as MapRow | undefined;

  serve(app, mapsContract.list, () => (db.prepare('SELECT * FROM map ORDER BY name').all() as MapRow[]).map(toJson));

  serve(app, mapsContract.create, ({ body }) => {
    const name = body.name;
    if (find(name)) return fail(409, `A map named "${name}" already exists`);
    db.prepare(
      `INSERT INTO map (name, tags, row_lengths, cells, boost_tiles, original_cells, source) VALUES (?, ?, ?, ?, ?, NULL, 'manual')`,
    ).run(name, JSON.stringify(body.tags), JSON.stringify(ROW_LENGTHS), JSON.stringify(body.cells), JSON.stringify(sorted(body.boostTiles)));
    return toJson(find(name)!);
  });

  serve(app, mapsContract.save, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown map');
    const name = body.name;
    if (name !== current.name && find(name)) return fail(409, `A map named "${name}" already exists`);
    const tags = JSON.stringify(body.tags);
    const cells = JSON.stringify(body.cells);
    const boostTiles = JSON.stringify(sorted(body.boostTiles));
    if (name === current.name && tags === current.tags && cells === current.cells && boostTiles === current.boost_tiles) return toJson(current);
    // Any edit makes the map the player's own, so a re-import never overwrites it.
    db.prepare(`UPDATE map SET name = ?, tags = ?, cells = ?, boost_tiles = ?, source = 'manual' WHERE name = ?`).run(
      name,
      tags,
      cells,
      boostTiles,
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
      `INSERT INTO map (name, tags, row_lengths, cells, boost_tiles, original_cells, source) VALUES (?, ?, ?, ?, ?, NULL, 'manual')`,
    ).run(name, current.tags, current.row_lengths, current.cells, current.boost_tiles);
    return toJson(find(name)!);
  });

  serve(app, mapsContract.restore, ({ params }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown map');
    if (current.original_cells === null) return fail(409, 'This map has no imported original');
    db.prepare(`UPDATE map SET cells = original_cells, source = 'import' WHERE name = ?`).run(current.name);
    // The imported original has no Boost tile, but the marks are the player's own: they stay, except on a tile that is no longer a deployment tile.
    const restored = JSON.parse(current.original_cells) as number[];
    const kept = (JSON.parse(current.boost_tiles) as number[]).filter((tile) => isDeploymentTile(restored[tile]));
    db.prepare('UPDATE map SET boost_tiles = ? WHERE name = ?').run(JSON.stringify(kept), current.name);
    return toJson(find(current.name)!);
  });

  const count = (sql: string, name: string) => db.prepare(sql).pluck().get(name) as number;
  const counts = (name: string): MapUses => ({
    stages: { stages: count('SELECT count(*) FROM stage WHERE map_name = ?', name), records: count('SELECT count(*) FROM stage_attempt WHERE stage_id IN (SELECT id FROM stage WHERE map_name = ?)', name) },
    arena: count('SELECT count(*) FROM arena_attempt WHERE map_name = ?', name),
    ideas: ideasUsing(db, 'map', name),
    dreamHunt: count('SELECT count(*) FROM dream_hunt_attempt WHERE map_name = ?', name),
    titanReaver: 0, // a Titan Reaver fight is against a boss and has no map
    scenarios: count('SELECT count(DISTINCT scenario_id) FROM scenario_slot WHERE map_name = ?', name),
  });

  serve(app, mapsContract.uses, ({ params }) => (find(params.name) ? counts(params.name) : fail(404, 'Unknown map')));

  serve(app, mapsContract.moveStages, ({ params, body }) => {
    if (!find(params.name)) return fail(404, 'Unknown map');
    if (params.name === OPEN_MAP) return fail(409, `The stages of ${OPEN_MAP} are never moved off it`);
    if (!find(body.to)) return fail(404, `Unknown map "${body.to}"`);
    if (body.to === params.name) return fail(409, 'Choose another map to move the stages to');
    return { moved: db.prepare('UPDATE stage SET map_name = ? WHERE map_name = ?').run(body.to, params.name).changes };
  });

  serve(app, mapsContract.remove, ({ params }) => {
    if (params.name === OPEN_MAP) return fail(409, `${OPEN_MAP} is the map Stages start on and is never deleted`);
    const n = counts(params.name);
    const used = describeUsage([
      { label: 'stages', count: n.stages.stages },
      { label: 'Dream Hunt records', one: 'Dream Hunt record', count: n.dreamHunt },
      { label: 'PvP records', one: 'PvP record', count: n.arena },
      { label: 'scenarios', count: n.scenarios },
      { label: 'ideas', count: n.ideas },
    ]);
    if (used) return fail(409, `${params.name} is used by ${used}, so it cannot be deleted; see Used by`);
    db.prepare('DELETE FROM map WHERE name = ?').run(params.name);
  });

  return app;
}
