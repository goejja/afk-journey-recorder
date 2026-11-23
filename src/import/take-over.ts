import type Database from 'better-sqlite3';
import { isDeploymentTile } from '../domain/map.js';

/** A row of the player's own that the import took over because its source now lists the name (#297). */
export interface TakenOver {
  kind: 'hero' | 'boss' | 'map';
  name: string;
  /** What differed, for the line the import prints: "tier S→A, faction Lightbearer→Graveborn". */
  differed: string;
}

interface Field {
  column: string;
  label: string;
  value: string | null;
  /** False for a field every takeover changes (the picture path), which would only be noise in the line. */
  report?: boolean;
}

/**
 * Takes over a hero or boss the player made by hand (`hand_made`) when the source lists its name: its fields become the source's and
 * the row becomes the importer's. A row an import made and the player then edited is not hand-made and is left alone. The table and
 * column names are the importers' own constants, never user input. Says what differed, or null when the row is not a stand-in.
 */
export function takeOverUnit(db: Database.Database, table: 'hero' | 'boss', name: string, fields: readonly Field[]): TakenOver | null {
  const row = db.prepare(`SELECT * FROM ${table} WHERE name = ? AND source = 'manual' AND hand_made = 1`).get(name) as Record<string, unknown> | undefined;
  if (!row) return null;
  db.prepare(`UPDATE ${table} SET ${fields.map((f) => `${f.column} = ?`).join(', ')}, source = 'import', hand_made = 0 WHERE name = ?`).run(...fields.map((f) => f.value), name);
  const shown = (value: unknown) => (value === null || value === undefined || value === '' ? 'none' : String(value));
  const changes = fields.filter((f) => f.report !== false && (row[f.column] ?? null) !== f.value).map((f) => `${f.label} ${shown(row[f.column])}→${shown(f.value)}`);
  return { kind: table, name, differed: changes.length > 0 ? changes.join(', ') : 'nothing differed' };
}

/**
 * Takes over an Arena map the player drew by hand (`manual`, no imported original) when the source lists its name: the source's tiles
 * and row layout replace it, and it becomes the importer's. The player's Boost tiles stay, except on a tile that is no longer a
 * deployment tile. A map the player edited after an import has its original and is left alone. Says how many tiles differed and how
 * many records use the map, or null when the map is not a stand-in.
 */
export function takeOverMap(db: Database.Database, name: string, rowLengths: number[], cells: number[]): TakenOver | null {
  const row = db.prepare("SELECT cells, boost_tiles FROM map WHERE name = ? AND source = 'manual' AND original_cells IS NULL").get(name) as { cells: string; boost_tiles: string } | undefined;
  if (!row) return null;
  const before = JSON.parse(row.cells) as number[];
  const differing = before.length === cells.length ? cells.filter((cell, i) => cell !== before[i]).length : cells.length;
  const boost = (JSON.parse(row.boost_tiles) as number[]).filter((tile) => isDeploymentTile(cells[tile]));
  db.prepare("UPDATE map SET cells = ?, original_cells = ?, row_lengths = ?, boost_tiles = ?, source = 'import' WHERE name = ?").run(JSON.stringify(cells), JSON.stringify(cells), JSON.stringify(rowLengths), JSON.stringify(boost), name);
  const count = (sql: string) => db.prepare(sql).pluck().get(name) as number;
  const records =
    count('SELECT count(*) FROM arena_attempt WHERE map_name = ?') +
    count('SELECT count(*) FROM dream_hunt_attempt WHERE map_name = ?') +
    count('SELECT count(*) FROM stage_attempt sa JOIN stage s ON s.id = sa.stage_id WHERE s.map_name = ?');
  const tiles = differing > 0 ? `${differing} of ${cells.length} tiles differed` : 'no tile differed';
  return { kind: 'map', name, differed: records > 0 ? `${tiles}; ${records} ${records === 1 ? 'record uses' : 'records use'} it, check their placements` : tiles };
}

/** The lines the import prints for what it took over. */
export const takeOverLines = (taken: readonly TakenOver[]): string[] => taken.map((t) => `Took over ${t.name} from Yaphalla (${t.differed})`);
