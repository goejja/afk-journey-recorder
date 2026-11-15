import { ROW_LENGTHS, ROW_OFFSETS, TILE_COUNT } from './map.js';

/** Which side of the board a team stands on: A is the player's (the bottom rows), B the opponent's, the same board turned upside down. */
export type Side = 'A' | 'B';

export const STARTS = ROW_LENGTHS.map((_, row) => ROW_LENGTHS.slice(0, row).reduce((sum, n) => sum + n, 0));

export const rowOfTile = (tile: number) => STARTS.findLastIndex((start) => start <= tile);
export const xOf = (tile: number) => {
  const row = rowOfTile(tile);
  return ROW_OFFSETS[row]! + (tile - STARTS[row]!);
};

/** The tile at a row and a horizontal position (in tile widths, halves for the stagger), or null off the board. */
export function tileAt(row: number, x: number): number | null {
  if (row < 0 || row >= ROW_LENGTHS.length) return null;
  const index = x - ROW_OFFSETS[row]!;
  return Number.isInteger(index) && index >= 0 && index < ROW_LENGTHS[row]! ? STARTS[row]! + index : null;
}

/** The board turned upside down: tile `i` becomes `44 - i`. Side B reads the board as Side A does, through it. */
export const turn = (tile: number) => TILE_COUNT - 1 - tile;

export const OWN_TILE = (tile: number, side: Side) => (side === 'A' ? tile : turn(tile));

/**
 * A tile's depth in its own side's frame: the game's rows are diagonal lines (down and to the right), not the horizontal lines of the
 * Map editor, so tiles of one game row share `x - 1.5 * line`, x being the position in tile widths. A lower depth is nearer the side's
 * back edge. Side B's tile is turned first, so both sides read the board from their own back edge.
 */
export function depthOf(tile: number, side: Side): number {
  const own = OWN_TILE(tile, side);
  return xOf(own) - 1.5 * rowOfTile(own);
}

const BACK_DEPTH = Math.min(...Array.from({ length: TILE_COUNT }, (_, tile) => depthOf(tile, 'A')));

/** The game row of a tile counted from its side's back edge: 1 is the back row, up to 15 for the front one. */
export const gameRowOf = (tile: number, side: Side): number => depthOf(tile, side) - BACK_DEPTH + 1;
