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

/** The tile a fixed relation points to from a tile, or null when it points off the board. `rearmost` is not a tile: see `rearmostOf`. */
export function relatedTile(relation: 'behind' | 'mirror', tile: number, side: Side): number | null {
  const own = side === 'A' ? tile : turn(tile);
  let found: number | null;
  if (relation === 'behind') {
    // Side A faces up the board, so its back edge is the bottom and "behind" is the bottom left neighbour.
    found = tileAt(rowOfTile(own) + 1, xOf(own) - 0.5);
  } else {
    const row = rowOfTile(own);
    const index = own - STARTS[row]!;
    const mirrored = ROW_LENGTHS[row]! - 1 - index;
    found = mirrored === index ? null : STARTS[row]! + mirrored;
  }
  return found === null ? null : side === 'A' ? found : turn(found);
}

/**
 * Orders units from the back edge of their side to the front: by game row, then inside a row the rightmost of the side's own frame
 * (the one counted farther back) first.
 */
export const backToFront = (side: Side) => (a: { tile: number }, b: { tile: number }) =>
  depthOf(a.tile, side) - depthOf(b.tile, side) || xOf(OWN_TILE(b.tile, side)) - xOf(OWN_TILE(a.tile, side));

/** Which of some standing units is the rearmost of its side (the game's definition: the back game row, then its rightmost unit), or null. */
export function rearmostOf<T extends { tile: number }>(units: T[], side: Side): T | null {
  return units.length === 0 ? null : units.reduce((best, unit) => (backToFront(side)(unit, best) < 0 ? unit : best));
}

/** The fewest steps between two tiles, moving to a neighbouring hexagon each step (a line down changes the position by half a tile). */
export function stepsBetween(a: number, b: number): number {
  const lines = Math.abs(rowOfTile(a) - rowOfTile(b));
  const across = Math.abs(xOf(a) - xOf(b));
  return lines + Math.max(0, across - lines / 2);
}
