import { describe, expect, it } from 'vitest';
import type { Hero } from '../../web/backend.js';
import { derivePhantimal, eligiblePhantimals } from '../../web/phantimal.js';
import type { PlacedRow } from '../../web/units.js';

const hero = (name: string, faction: string): Hero => ({ name, tier: 'S', class: 'Mage', faction, damageType: null, imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: null });
const heroes = [hero('A', 'Lightbearer'), hero('B', 'Lightbearer'), hero('C', 'Lightbearer'), hero('D', 'Wilder')];
const factions = new Map(heroes.map((h) => [h.name, h.faction]));
const options = [
  { name: 'Gervan', faction: 'Lightbearer' },
  { name: 'Aurelian', faction: 'Lightbearer' },
  { name: 'Olden', faction: 'Wilder' },
  { name: 'Wedge of Matter', faction: 'Celestial-Hypogean' },
];
const cells = Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 0 : -2));
const placed = (...names: string[]): PlacedRow[] => names.map((name, i) => ({ tile: 38 + i, hero: name }));
const state = (rows: PlacedRow[], choice = '', phantimal: { name: string; tile: number; partnerTile?: number | null } | null = null) => ({ placed: rows, phantimal, phantimalChoice: choice });
const zone = 0;
const taken = (rows: PlacedRow[]) => (tile: number) => rows.some((p) => p.tile === tile);

describe('eligiblePhantimals', () => {
  it('offers only the Phantimals whose three heroes are on the field', () => {
    expect(eligiblePhantimals(placed('A', 'B'), options, factions)).toEqual([]);
    expect(eligiblePhantimals(placed('A', 'B', 'C'), options, factions)).toEqual(['Gervan', 'Aurelian']);
    expect(eligiblePhantimals(placed('A', 'B', 'D'), options, factions)).toEqual([]);
  });

  it('counts a Pair once, and a Celestial-Hypogean Phantimal accepts either faction', () => {
    const pair: PlacedRow[] = [
      { tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' },
      { tile: 39, hero: 'Elijah & Lailah', part: 'Lailah' },
    ];
    const celestial = new Map([
      ['Elijah & Lailah', 'Celestial'],
      ['X', 'Hypogean'],
      ['Y', 'Hypogean'],
    ]);
    const rows: PlacedRow[] = [...pair, { tile: 40, hero: 'X' }, { tile: 41, hero: 'Y' }];
    expect(eligiblePhantimals(rows, options, celestial)).toEqual(['Wedge of Matter']);
  });
});

describe('derivePhantimal', () => {
  it('does nothing while the chosen Phantimal is not yet eligible', () => {
    expect(derivePhantimal(state(placed('A', 'B'), 'Gervan'), cells, zone, options, factions).phantimal).toBeNull();
  });

  it('puts the chosen Phantimal on the first free tile once the heroes bring it', () => {
    const next = derivePhantimal(state(placed('A', 'B', 'C'), 'Gervan'), cells, zone, options, factions);
    expect(next.phantimal).toEqual({ name: 'Gervan', tile: 41 });
  });

  it('keeps the tiles it already stands on, and drops it when the third hero goes', () => {
    const standing = state(placed('A', 'B', 'C'), 'Gervan', { name: 'Gervan', tile: 41 });
    expect(derivePhantimal(standing, cells, zone, options, factions).phantimal).toEqual({ name: 'Gervan', tile: 41 });
    const without = state(placed('A', 'B'), 'Gervan', { name: 'Gervan', tile: 41 });
    const next = derivePhantimal(without, cells, zone, options, factions);
    expect(next.phantimal).toBeNull();
    expect(next.phantimalChoice).toBe('Gervan'); // the choice stays, so it comes back with the third hero
  });

  it('gives a pair Phantimal both its tiles, and none at all when they do not fit', () => {
    const wedges = new Map([
      ['A', 'Celestial'],
      ['B', 'Celestial'],
      ['C', 'Hypogean'],
    ]);
    const next = derivePhantimal(state(placed('A', 'B', 'C'), 'Wedge of Matter'), cells, zone, options, wedges);
    expect(next.phantimal).toEqual({ name: 'Wedge of Matter', tile: 41, partnerTile: 42 });
    // only one player tile is free, so the pair never appears
    const crowded: PlacedRow[] = [38, 39, 40, 41, 42, 43].map((tile, i) => ({ tile, hero: ['A', 'B', 'C', 'D', 'E', 'F'][i]! }));
    expect(derivePhantimal(state(crowded, 'Wedge of Matter'), cells, zone, options, wedges).phantimal).toBeNull();
  });

  it('takes no phantimal of a season that does not offer the choice', () => {
    const onlySeason7 = [{ name: 'Olden', faction: 'Wilder' }];
    expect(derivePhantimal(state(placed('A', 'B', 'C'), 'Gervan'), cells, zone, onlySeason7, factions).phantimal).toBeNull();
  });

  it('never places the Phantimal on a tile a hero holds', () => {
    const rows = placed('A', 'B', 'C');
    const next = derivePhantimal(state(rows, 'Gervan'), cells, zone, options, factions);
    expect(taken(rows)(next.phantimal!.tile)).toBe(false);
  });
});