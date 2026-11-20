import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/domain/map.js';
import type { Hero } from '../../web/backend.js';
import { addHeroUnits, addUnit, resolveUnit, selectorHeroes, swapTiles, unitsUnavailable, type PlacedRow } from '../../web/units.js';

const hero = (name: string): Hero => ({ name, tier: 'S', class: 'Support', faction: 'Celestial', damageType: null, imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: null });
const cells = Array.from({ length: 45 }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const place = (placed: PlacedRow[], name: string, tile = 38) =>
  addHeroUnits(placed, name, tile, cells, TILE.PLAYER, (t) => placed.some((p) => p.tile === t), (row) => row);
const rows = (placed: PlacedRow[], name: string, tile = 38) => place(placed, name, tile).placed;
const unit = (placed: PlacedRow[], name: string, tile: number) => addUnit(placed, name, tile, (row) => row);

describe('the unit selector', () => {
  it('shows one icon per hero: a pair and a hero with summons are one Hero', () => {
    const icons = selectorHeroes([hero('Alna'), hero('Elijah & Lailah'), hero('Zanie')]);
    expect(icons.map((h) => h.name)).toEqual(['Alna', 'Elijah & Lailah', 'Zanie']);
    expect(resolveUnit('Lailah')).toEqual({ hero: 'Elijah & Lailah', part: 'Lailah' });
    expect(resolveUnit('Laser Turret')).toEqual({ hero: 'Zanie', part: 'Laser Turret' });
    expect(resolveUnit('Alna')).toEqual({ hero: 'Alna', part: '' });
  });

  it('greys out a hero once any of its Units is placed, and the heroes held by another team', () => {
    const placed = rows(rows(rows([], 'Zanie', 38), 'Elijah & Lailah', 41), 'Alna', 43);
    const why = unitsUnavailable(placed);
    for (const name of ['Zanie', 'Elijah & Lailah', 'Alna']) expect(why.get(name)).toBe('Already placed');
    expect(why.has('Lailah')).toBe(false); // a part is not an icon any more
    const elsewhere = unitsUnavailable([], new Map([['Zanie', 'Used in team 2']]));
    expect(elsewhere.get('Zanie')).toBe('Used in team 2');
  });
});

describe('placing a hero places every Unit it owns', () => {
  it('puts both parts of a pair down at once', () => {
    const pair = place([], 'Elijah & Lailah', 38);
    expect(pair.message).toBeNull();
    expect(pair.placed).toEqual([
      { tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' },
      { tile: 39, hero: 'Elijah & Lailah', part: 'Lailah' },
    ]);
  });

  it('puts a hero and all its summons down at once: two turrets for Zanie, one clone for Phraesto', () => {
    expect(place([], 'Zanie', 38).placed).toEqual([
      { tile: 38, hero: 'Zanie' },
      { tile: 39, hero: 'Zanie', part: 'Laser Turret' },
      { tile: 40, hero: 'Zanie', part: 'Laser Turret' },
    ]);
    expect(place([], 'Phraesto', 38).placed).toEqual([
      { tile: 38, hero: 'Phraesto' },
      { tile: 39, hero: 'Phraesto', part: 'Phraesto clone' },
    ]);
  });

  it('refuses the whole hero when its Units do not all fit, and says so', () => {
    // Zanie and three others fill all but tile 44, and Phraesto needs two tiles
    const four = rows(rows(rows(rows([], 'Zanie', 38), 'A', 41), 'B', 42), 'C', 43);
    const full = place(four, 'Phraesto', 44);
    expect(full.message).toBe('Phraesto needs 2 free tiles; only 1 is free');
    expect(full.placed).toEqual(four);
  });

  it('takes a tile that is already used, or a hero that is already placed, as a refusal', () => {
    expect(place([], 'Alna', 38).message).toBeNull();
    expect(place([{ tile: 38, hero: 'B' }], 'Alna', 38).message).toBe('Tile 39 is taken');
    expect(place(rows([], 'Alna'), 'Alna', 39).message).toBe('Alna is already placed');
  });

  it('counts a pair and a hero with turrets as one hero each against the limit of five', () => {
    const four = ['A', 'B', 'C', 'D'].reduce((all, name, i) => rows(all, name, 38 + i), [] as PlacedRow[]);
    const pair = rows(four, 'Elijah & Lailah', 42);
    expect(place(pair, 'Alna', 44).message).toMatch(/At most 5/);
  });
});

describe('placing one unit on its own', () => {
  it('is how a picture lays out Units, and keeps the rules of units', () => {
    expect(unit([], 'Laser Turret', 41).message).toBe('Place Zanie first');
    let placed = unit([], 'Zanie', 40).placed;
    placed = unit(unit(placed, 'Laser Turret', 41).placed, 'Laser Turret', 42).placed;
    expect(unit(placed, 'Laser Turret', 43).message).toBe('Zanie has at most 2 Laser Turret');
    expect(resolveUnit('Phraesto clone')).toEqual({ hero: 'Phraesto', part: 'Phraesto clone' });
  });
});

describe('moving units', () => {
  it('swaps two units, or moves one onto an empty tile, keeping its unit and anything else it carries', () => {
    const placed: PlacedRow[] = [{ tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' }, { tile: 39, hero: 'Elijah & Lailah', part: 'Lailah' }, { tile: 40, hero: 'A' }];
    expect(swapTiles(placed, 39, 45)).toEqual([placed[0], { tile: 45, hero: 'Elijah & Lailah', part: 'Lailah' }, placed[2]]);
    expect(swapTiles(placed, 38, 40)).toEqual([{ tile: 40, hero: 'Elijah & Lailah', part: 'Elijah' }, placed[1], { tile: 38, hero: 'A' }]);
  });
});