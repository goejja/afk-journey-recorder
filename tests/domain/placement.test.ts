import { describe, expect, it, vi } from 'vitest';
import { averageRow, playerOnTop, rowOf, ROW_LENGTHS, TILE, TILE_COUNT } from '../../src/domain/map.js';
import { canDropOnTile, confirmBorrowedMove, placePhantimalPart } from '../../web/placement.js';
import { PAIR_PHANTIMALS } from '../../src/domain/units.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

describe('map rows', () => {
  it('finds the row of a tile, from the top', () => {
    expect(rowOf(ROW_LENGTHS, 0)).toBe(0);
    expect(rowOf(ROW_LENGTHS, 1)).toBe(0);
    expect(rowOf(ROW_LENGTHS, 2)).toBe(1);
    expect(rowOf(ROW_LENGTHS, TILE_COUNT - 1)).toBe(ROW_LENGTHS.length - 1);
  });

  it('averages the rows of a kind of tile, and says which side is on top', () => {
    expect(averageRow(ROW_LENGTHS, cells, TILE.ENEMY)).toBeLessThan(averageRow(ROW_LENGTHS, cells, TILE.PLAYER)!);
    expect(averageRow(ROW_LENGTHS, cells, TILE.WOOD_WALL)).toBeNull();
    expect(playerOnTop(ROW_LENGTHS, cells)).toBe(false);
    expect(playerOnTop(ROW_LENGTHS, cells.map((c) => (c === TILE.ENEMY ? TILE.PLAYER : c === TILE.PLAYER ? TILE.ENEMY : c)))).toBe(true);
    expect(playerOnTop(ROW_LENGTHS, cells.map((c) => (c === TILE.ENEMY ? TILE.OPEN : c)))).toBeNull();
  });
});

describe('canDropOnTile', () => {
  const base = { zone: 'A', moving: null, movingSide: null, sideOfTile: null, dragging: false, occupied: false } as const;
  it('lets an icon go on a free tile of a zone, and nowhere else', () => {
    expect(canDropOnTile({ ...base, dragging: true })).toBe(true);
    expect(canDropOnTile({ ...base, dragging: true, occupied: true })).toBe(false);
    expect(canDropOnTile({ ...base, zone: null, dragging: true })).toBe(false);
    expect(canDropOnTile(base)).toBe(false);
  });

  it('keeps a placed unit on its own side: a free tile or a swap with a unit of that side', () => {
    const moving = { ...base, moving: 40, movingSide: 'A' } as const;
    expect(canDropOnTile(moving)).toBe(true);
    expect(canDropOnTile({ ...moving, sideOfTile: 'A', occupied: true })).toBe(true);
    expect(canDropOnTile({ ...moving, sideOfTile: 'B', occupied: true })).toBe(false);
    expect(canDropOnTile({ ...moving, zone: 'B' })).toBe(false);
  });
});

describe('placePhantimalPart', () => {
  it('puts a single phantimal on the tile', () => {
    const result = placePhantimalPart(cells, TILE.PLAYER, null, 'Orson', 40, () => false);
    expect(result.phantimal).toMatchObject({ name: 'Orson', tile: 40 });
    expect(result.next).toBeNull();
  });

  it('puts the second part of a pair on the next free tile of the zone and asks for none more', () => {
    const [first] = Object.entries(PAIR_PHANTIMALS)[0]!;
    const started = placePhantimalPart(cells, TILE.PLAYER, null, first, 38, (t) => t === 38);
    expect(started.phantimal.partnerTile).toBeDefined();
    expect(started.next).toBeNull();
    expect(started.phantimal.partnerTile).not.toBe(38);
  });
});

describe('confirmBorrowedMove', () => {
  it('lets the hero go only when the player agrees', async () => {
    const borrow = { noun: 'hero', releaseHero: vi.fn() } as any;
    expect(await confirmBorrowedMove(async () => false, borrow, 'Alna', 'Team 1')).toBe(false);
    expect(borrow.releaseHero).not.toHaveBeenCalled();
    expect(await confirmBorrowedMove(async () => true, borrow, 'Alna', 'Team 1')).toBe(true);
    expect(borrow.releaseHero).toHaveBeenCalledWith('Alna');
  });
});
