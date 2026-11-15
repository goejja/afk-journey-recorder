import { describe, expect, it, vi } from 'vitest';
import { TILE } from '../../../src/domain/map.js';
import { emptyFormation, placeOnFormation, whenPlaced, type FormationPlacement } from '../../../web/FormationEditor.js';
import type { Borrow } from '../../../web/arena/borrow.js';

const cells = Array.from({ length: 45 }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const base = { cells, formation: emptyFormation(), occupied: () => false };

describe('placeOnFormation', () => {
  it('places a hero at once, without a question, and says nothing is left to place', () => {
    const result = placeOnFormation({ ...base, unit: { type: 'hero', name: 'Evie' }, index: 38 });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({ value: { placed: [{ tile: 38, hero: 'Evie' }] }, next: null });
  });

  it('leaves an unavailable hero off the map', () => {
    const result = placeOnFormation({ ...base, unit: { type: 'hero', name: 'Evie' }, index: 38, unavailable: new Map([['Evie', 'used in match 1']]) });
    expect(result).toMatchObject({ value: { placed: [] }, next: null });
  });

  it('places every Unit of a hero at once, and a phantimal part', () => {
    const pair = placeOnFormation({ ...base, unit: { type: 'hero', name: 'Elijah & Lailah' }, index: 38 }) as Exclude<FormationPlacement, null | { message: string }>;
    expect(pair.value.placed).toEqual([
      { tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' },
      { tile: 39, hero: 'Elijah & Lailah', part: 'Lailah' },
    ]);
    expect(pair.next).toBeNull();
    const phantimal = placeOnFormation({ ...base, unit: { type: 'phantimal', name: 'Orson' }, index: 39 }) as Exclude<FormationPlacement, null | { message: string }>;
    expect(phantimal.value.phantimal).toMatchObject({ tile: 39 });
  });

  it('asks before taking a hero from another team, places it as the team is now, and stops when the tile was taken meanwhile', async () => {
    const borrow = { heroHolder: (hero: string) => (hero === 'Evie' ? 'Team 1' : null), releaseHero: vi.fn(), noun: 'hero' } as unknown as Borrow;
    const confirm = vi.fn().mockResolvedValue(true);
    const common = { ...base, unit: { type: 'hero' as const, name: 'Evie' }, index: 38 };
    const now = { ...emptyFormation(), assist: 'Fay' };
    const placed = await placeOnFormation({ ...common, borrowing: { borrow, confirm, current: () => now, takenNow: () => false } });
    expect(placed).toMatchObject({ value: { assist: 'Fay', placed: [{ hero: 'Evie' }] } });
    expect(borrow.releaseHero).toHaveBeenCalledWith('Evie');
    const takenNow = { ...emptyFormation(), placed: [{ tile: 38, hero: 'Zed' }] };
    const taken = await placeOnFormation({ ...common, borrowing: { borrow, confirm, current: () => takenNow, takenNow: () => true } });
    expect(taken).toEqual({ message: 'That tile has been taken meanwhile: place the hero again' });
    expect(await placeOnFormation({ ...common, borrowing: { borrow, confirm: vi.fn().mockResolvedValue(false), current: () => now, takenNow: () => false } })).toBeNull();
  });
});

describe('whenPlaced', () => {
  it('applies a placement at once, and a pending one when it settles', async () => {
    const apply = vi.fn();
    whenPlaced(null, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    whenPlaced(Promise.resolve({ message: 'x' }), apply);
    expect(apply).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
