import type Database from 'better-sqlite3';
import { ROW_LENGTHS } from '../domain/map.js';
import { MAP_CORRECTIONS } from './map-corrections.js';
import { evalConst, parseChunk, type Json } from './static-eval.js';
import { takeOverMap, type TakenOver } from './take-over.js';

export interface MapRow {
  name: string;
  rowLengths: number[];
  cells: number[];
}

const MIN_MAPS = 20;
/** The editor's empty scratch row; it is not a real arena. */
const BLANK_MAP = 'Custom';
const CELL_VALUES = new Set([-3, -2, -1, 0, 1]);

const isNumberArray = (value: Json | undefined): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number');

function isMapTable(value: Json | undefined): value is Record<string, number[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'Arena I' in value &&
    Object.values(value).every(isNumberArray)
  );
}

/** A list of row descriptors like [{length: 2, ...}, {length: 5, ...}], one per hex row. */
function rowLengthsOf(value: Json | undefined): number[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const lengths: number[] = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
    if (typeof row['length'] !== 'number' || !('offset' in row)) return null;
    lengths.push(row['length']);
  }
  return lengths;
}

/**
 * Reads the Arena row table and its row layout from the editor's chunks.
 * Cells are listed row by row, left to right, in the order of the row lengths.
 */
export function extractMaps(chunkSources: string[]): MapRow[] {
  let table: Record<string, number[]> | undefined;
  let rowLengths: number[] | null = null;
  for (const source of chunkSources) {
    for (const { node, ancestors } of parseChunk(source).nodes) {
      if (node.type !== 'ObjectExpression' && node.type !== 'ArrayExpression') continue;
      const value = evalConst(node, ancestors);
      if (value === undefined) continue;
      if (!table && isMapTable(value)) table = value;
      rowLengths ??= rowLengthsOf(value);
    }
  }
  if (!table) throw new Error('Arena row table not found in chunks');
  if (!rowLengths) throw new Error('Map row layout not found in chunks');
  const cellCount = rowLengths.reduce((sum, n) => sum + n, 0);

  const maps: MapRow[] = [];
  for (const [name, cells] of Object.entries(table)) {
    if (name === BLANK_MAP) continue;
    if (cells.length !== cellCount) throw new Error(`Map ${name} has ${cells.length} cells, expected ${cellCount}`);
    const unknown = cells.find((c) => !CELL_VALUES.has(c));
    if (unknown !== undefined) throw new Error(`Map ${name} has unknown cell value ${unknown}`);
    maps.push({ name, rowLengths, cells });
  }
  if (maps.length < MIN_MAPS) throw new Error(`Only ${maps.length} maps found; expected at least ${MIN_MAPS}`);
  return maps;
}

/**
 * Upserts the imported Arena maps. The imported version is always refreshed in `original_cells`,
 * but a map the player edited (source = 'manual') keeps its own tiles. A map with a known correction
 * takes the corrected tiles as its imported version. A map the player drew by hand while the source lacked it is taken over when the
 * source lists it (said in what it returns).
 */
export function storeArenaMaps(db: Database.Database, maps: MapRow[], corrections: Record<string, number[]> = MAP_CORRECTIONS, overwrite = false): TakenOver[] {
  const upsert = db.prepare(
    `INSERT INTO map (name, tags, row_lengths, cells, original_cells, source)
     VALUES (@name, '["Arena"]', @rowLengths, @cells, @cells, 'import')
     ON CONFLICT (name) DO UPDATE SET
       original_cells = excluded.original_cells,
       row_lengths = CASE WHEN map.source = 'import' THEN excluded.row_lengths ELSE map.row_lengths END,
       cells = CASE WHEN map.source = 'import' THEN excluded.cells ELSE map.cells END`,
  );
  const taken: TakenOver[] = [];
  db.transaction(() => {
    for (const row of maps) {
      const cells = corrections[row.name] ?? row.cells;
      if (cells.length !== row.cells.length) throw new Error(`The correction of ${row.name} has ${cells.length} tiles, expected ${row.cells.length}`);
      const over = takeOverMap(db, row.name, row.rowLengths, cells, overwrite);
      if (over) taken.push(over);
      upsert.run({ name: row.name, rowLengths: JSON.stringify(row.rowLengths), cells: JSON.stringify(cells) });
    }
  })();
  return taken;
}

/** The one blank Stage map the importer provides; the player draws any other in Admin > Maps (#382). */
const STAGE_MAP_NAMES = ['Open'];

/**
 * Creates the Stage map "Open" as a blank open field. The real stage deployment zones and walls
 * are not known to the importer, so the player paints them in the map editor. Existing maps
 * are never touched.
 */
export function seedStageMaps(db: Database.Database): void {
  const tileCount = ROW_LENGTHS.reduce((sum, n) => sum + n, 0);
  const blank = JSON.stringify(Array(tileCount).fill(0));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO map (name, tags, row_lengths, cells, original_cells, source)
     VALUES (?, '["Stage"]', ?, ?, NULL, 'manual')`,
  );
  db.transaction(() => {
    for (const name of STAGE_MAP_NAMES) insert.run(name, JSON.stringify(ROW_LENGTHS), blank);
  })();
}
