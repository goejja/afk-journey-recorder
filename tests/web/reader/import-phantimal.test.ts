import { describe, expect, it } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import type { Hero } from '../../../web/backend.js';
import { placeOwn, unplacedUnit } from '../../../web/reader/battle-import.js';
import { derivePhantimal } from '../../../web/phantimal.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string, faction: string): Hero => ({ name, tier: 'S', class: 'Mage', faction, damageType: null, imagePath: null, owned: true, rank: null, equipmentLevel: null });
const heroes = [hero('A', 'Lightbearer'), hero('B', 'Lightbearer'), hero('E', 'Lightbearer'), hero('C', 'Wilder'), hero('D', 'Wilder'), hero('Zanie', 'Wilder')];
const factions = new Map(heroes.map((h) => [h.name, h.faction]));
const options = [
  { name: 'Gervan', faction: 'Lightbearer' },
  { name: 'Wedge of Matter', faction: 'Celestial-Hypogean' },
];
const read = (...names: string[]) => names.map((name) => ({ tile: '', hero: name, rank: null, equipmentLevel: null }));
const derive = (state: ReturnType<typeof placeOwn>, zone = TILE.PLAYER) =>
  derivePhantimal({ ...state, phantimalChoice: state.phantimal?.name ?? '' }, cells, zone, options, factions);

describe('a Phantimal read off a picture (ADR 0029)', () => {
  it('is dropped whole when the heroes do not meet its faction, so nothing is left half placed', () => {
    // Dom's case: a Wedge read for a team with no Celestial or Hypogean hero at all
    const placed = derive(placeOwn(cells, read('A', 'B', 'C', 'D'), { artifact: null, phantimal: 'Wedge of Matter' }));
    expect(placed.phantimal).toBeNull();
    expect(unplacedUnit(placed.placed, null, null)).toBeNull(); // nothing to place by hand
  });

  it('stands when three heroes of its faction are there', () => {
    const placed = derive(placeOwn(cells, read('A', 'B', 'E'), { artifact: null, phantimal: 'Gervan' }));
    expect(placed.phantimal).toMatchObject({ name: 'Gervan' });
  });

  it('is dropped whole when a pair has no room for both tiles', () => {
    // A full player zone (7 of 7 tiles taken) leaves no tile for even the first part of the Wedge
    const five = placeOwn(cells, read('A', 'B', 'C', 'D', 'Zanie'), { artifact: null, phantimal: null });
    expect(five.placed).toHaveLength(7);
    const placed = derive(placeOwn(cells, read('A', 'B', 'C', 'D', 'Zanie'), { artifact: null, phantimal: 'Wedge of Matter' }));
    expect(placed.phantimal).toBeNull();
  });

  it('is never taken from a saved side when the picture showed none', () => {
    const saved = {
      heroes: [{ tile: 39, name: 'A', part: '', rank: null, equipmentLevel: null }],
      phantimal: { name: 'Gervan', tile: 40 },
      artifact: null,
      assist: null,
      formationId: null,
    } as never;
    const reused = placeOwn(cells, [{ tile: '', hero: 'A', rank: null, equipmentLevel: null }], { artifact: null, phantimal: null }, saved);
    expect(reused.phantimal).toBeNull();
    expect(reused.phantimalChoice).toBe('');
  });
});