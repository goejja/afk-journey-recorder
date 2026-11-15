import { z } from 'zod';
import { problemWith } from './schema.js';

export const TILE = { OPEN: 0, PLAYER: 1, ENEMY: -1, WOOD_WALL: -2, STONE_WALL: -3 } as const;

export type TileType = (typeof TILE)[keyof typeof TILE];

export const ROW_LENGTHS = [2, 5, 6, 6, 7, 6, 6, 5, 2];
export const TILE_COUNT = ROW_LENGTHS.reduce((sum, n) => sum + n, 0);
export const MAP_TAGS = ['Arena', 'Stage'] as const;

/** Left offset of each row in tiles, taken from the editor's layout; it gives the hex stagger. */
export const ROW_OFFSETS = [3, 1.5, 1, 0.5, 0, 0.5, 0, 0.5, 2];

export const TILE_LABELS: Record<TileType, string> = {
  [TILE.OPEN]: 'Open',
  [TILE.PLAYER]: 'Player deployment',
  [TILE.ENEMY]: 'Enemy deployment',
  [TILE.WOOD_WALL]: 'Wood wall (destructible)',
  [TILE.STONE_WALL]: 'Stone wall (indestructible)',
};

/** The order a click steps through when editing a tile. */
export const TILE_CYCLE: TileType[] = [TILE.PLAYER, TILE.ENEMY, TILE.WOOD_WALL, TILE.STONE_WALL, TILE.OPEN];

export function nextTile(current: number): TileType {
  const index = TILE_CYCLE.indexOf(current as TileType);
  return TILE_CYCLE[(index + 1) % TILE_CYCLE.length]!;
}

function isTileType(value: unknown): value is TileType {
  return TILE_CYCLE.includes(value as TileType);
}

const TAGS_MESSAGE = `Tags must be a list of: ${MAP_TAGS.join(', ')}`;
const TILES_MESSAGE = `A map has exactly ${TILE_COUNT} tiles`;

/** What a map is created or changed with: a name (trimmed), the kinds of fight it is for, and its tiles. */
export const MapBodySchema = z.object(
  {
    name: z.string({ error: 'A map needs a name' }).trim().min(1, 'A map needs a name'),
    tags: z
      .array(z.unknown(), { error: TAGS_MESSAGE })
      .refine((tags) => tags.every((t) => (MAP_TAGS as readonly unknown[]).includes(t)), TAGS_MESSAGE)
      .transform((tags) => tags as string[]),
    cells: z
      .array(z.unknown(), { error: TILES_MESSAGE })
      .length(TILE_COUNT, TILES_MESSAGE)
      .refine((cells) => cells.every(isTileType), 'A map may only contain open, player, enemy, wood wall and stone wall tiles')
      .transform((cells) => cells as number[]),
  },
  { error: 'A map needs a name' },
);

/** Returns an error message, or null when the map content is valid. */
export const validateMap = (input: { name: unknown; tags: unknown; cells: unknown }): string | null => problemWith(MapBodySchema, input);

/** A side of a tile: two corners on the lattice described at `zoneEdges`, smaller corner first. */
export type Segment = [[number, number], [number, number]];

/**
 * The sides of the tiles of one kind, split into the outer ones (on the outline of a connected zone) and the
 * inner ones (shared by two tiles of the zone). Corners are on a lattice that fits a map of any size exactly:
 * x counts half tile widths and y counts quarter tile heights, so a row is 3 high and a tile spans 2 by 4.
 */
export function zoneEdges(rowLengths: number[], cells: number[], tile: number): { outer: Segment[]; inner: Segment[] } {
  const seen = new Map<string, { segment: Segment; tiles: number }>();
  let index = 0;
  rowLengths.forEach((length, row) => {
    for (let offset = 0; offset < length; offset++, index++) {
      if (cells[index] !== tile) continue;
      const x = 2 * (ROW_OFFSETS[row] ?? 0) + 2 * offset;
      const y = 3 * row;
      const corners: [number, number][] = [[x + 1, y], [x + 2, y + 1], [x + 2, y + 3], [x + 1, y + 4], [x, y + 3], [x, y + 1]];
      corners.forEach((from, side) => {
        const to = corners[(side + 1) % 6]!;
        const segment = (from[0] < to[0] || (from[0] === to[0] && from[1] < to[1]) ? [from, to] : [to, from]) as Segment;
        const key = segment.flat().join(',');
        const known = seen.get(key);
        if (known) known.tiles++;
        else seen.set(key, { segment, tiles: 1 });
      });
    }
  });
  const all = [...seen.values()];
  return { outer: all.filter((e) => e.tiles === 1).map((e) => e.segment), inner: all.filter((e) => e.tiles > 1).map((e) => e.segment) };
}

/** The row (0 at the top) a tile is in. */
export function rowOf(rowLengths: number[], tile: number): number {
  let start = 0;
  for (const [row, length] of rowLengths.entries()) {
    if (tile < start + length) return row;
    start += length;
  }
  return rowLengths.length;
}

/** The mean row of the tiles of one kind, or null when the map has none. */
export function averageRow(rowLengths: number[], cells: number[], kind: number): number | null {
  const rows = cells.flatMap((cell, tile) => (cell === kind ? [rowOf(rowLengths, tile)] : []));
  return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
}

/** Whether the player's tiles are nearer the top of the map than the enemy's; null when either has no tiles or they are level. */
export function playerOnTop(rowLengths: number[], cells: number[]): boolean | null {
  const player = averageRow(rowLengths, cells, TILE.PLAYER);
  const enemy = averageRow(rowLengths, cells, TILE.ENEMY);
  return player === null || enemy === null || player === enemy ? null : player < enemy;
}
