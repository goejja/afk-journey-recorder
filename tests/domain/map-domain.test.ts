import { describe, expect, it } from 'vitest';
import { mapColumns, MapBodySchema, nextTile, ROW_LENGTHS, TILE, TILE_COUNT, zoneEdges } from '../../src/domain/map.js';
import { problemWith } from '../../src/domain/schema.js';

const cells = Array(TILE_COUNT).fill(TILE.OPEN);

describe('nextTile', () => {
  it('cycles player, enemy, wood wall, stone wall, open, then back to player', () => {
    const seen = [TILE.OPEN as number];
    for (let i = 0; i < 5; i++) seen.push(nextTile(seen.at(-1)!));
    expect(seen).toEqual([0, 1, -1, -2, -3, 0]);
  });
});

describe('the map body schema', () => {
  it('accepts a well-formed map', () => {
    expect(problemWith(MapBodySchema, { name: 'My map', tags: ['Arena', 'Stage'], cells })).toBeNull();
    expect(problemWith(MapBodySchema, { name: 'No tags', tags: [], cells })).toBeNull();
  });
  it('rejects a blank name', () => {
    expect(problemWith(MapBodySchema, { name: '  ', tags: [], cells })).toMatch(/name/);
  });
  it('rejects unknown tags', () => {
    expect(problemWith(MapBodySchema, { name: 'x', tags: ['Dream Hunt'], cells })).toMatch(/Tags/);
  });
  it('rejects the wrong number of tiles', () => {
    expect(problemWith(MapBodySchema, { name: 'x', tags: [], cells: cells.slice(1) })).toMatch(/exactly 45/);
  });
  it('rejects unknown tile types', () => {
    expect(problemWith(MapBodySchema, { name: 'x', tags: [], cells: [...cells.slice(1), 7] })).toMatch(/may only contain/);
  });
});

describe('zoneEdges', () => {
  const only = (tile: number, ...indexes: number[]) => cells.map((c, i) => (indexes.includes(i) ? tile : c));
  const count = (map: number[], tile: number) => {
    const { outer, inner } = zoneEdges(ROW_LENGTHS, map, tile);
    return { outer: outer.length, inner: inner.length };
  };

  it('outlines a single tile with its six sides and no inner edge', () => {
    const { outer, inner } = zoneEdges(ROW_LENGTHS, only(TILE.PLAYER, 0), TILE.PLAYER);
    expect(inner).toEqual([]);
    // the first tile sits at x 6 to 8 and y 0 to 4 on the lattice
    expect(outer).toEqual(
      expect.arrayContaining([[[6, 1], [7, 0]], [[7, 0], [8, 1]], [[8, 1], [8, 3]], [[7, 4], [8, 3]], [[6, 3], [7, 4]], [[6, 1], [6, 3]]]),
    );
    expect(outer).toHaveLength(6);
  });

  it('joins two neighbours in a row: the side they share is inner, not part of the outline', () => {
    expect(count(only(TILE.PLAYER, 0, 1), TILE.PLAYER)).toEqual({ outer: 10, inner: 1 });
  });

  it('joins neighbours on different rows too', () => {
    // tile 0 is on the first row, tile 3 is the second tile of the second row, which touches it
    expect(count(only(TILE.PLAYER, 0, 3), TILE.PLAYER)).toEqual({ outer: 10, inner: 1 });
  });

  it('outlines tiles that do not touch separately', () => {
    expect(count(only(TILE.PLAYER, 0, 40), TILE.PLAYER)).toEqual({ outer: 12, inner: 0 });
  });

  it('looks only at the zone asked for, so a neighbouring zone is a border like any other tile', () => {
    const map = only(TILE.PLAYER, 0).map((c, i) => (i === 1 ? TILE.ENEMY : c));
    expect(count(map, TILE.PLAYER)).toEqual({ outer: 6, inner: 0 });
    expect(count(map, TILE.ENEMY)).toEqual({ outer: 6, inner: 0 });
  });

  it('outlines a whole zone once: only its perimeter is outer', () => {
    // the 13 tiles of the first three rows: 6 * 13 sides, 24 of them shared by two tiles
    const top = Array.from({ length: 13 }, (_, i) => i);
    expect(count(only(TILE.ENEMY, ...top), TILE.ENEMY)).toEqual({ outer: 30, inner: 24 });
  });

  it('is empty when there is no such zone', () => {
    expect(zoneEdges(ROW_LENGTHS, cells, TILE.PLAYER)).toEqual({ outer: [], inner: [] });
  });
});

describe('mapColumns', () => {
  it('is the right edge of the furthest row of the standard map, 7 tiles, not the 8 it was drawn with', () => {
    expect(mapColumns(ROW_LENGTHS)).toBe(7);
  });

  it('counts a row by its offset and its length', () => {
    expect(mapColumns([2])).toBe(5); // the first row starts 3 tiles in
    expect(mapColumns([2, 5])).toBe(6.5);
    expect(mapColumns([])).toBe(0);
  });
});
