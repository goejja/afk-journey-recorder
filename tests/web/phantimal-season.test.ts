import { describe, expect, it } from 'vitest';
import type { Hero, Phantimal } from '../../web/backend.js';
import { derivePhantimal, eligiblePhantimals } from '../../web/phantimal.js';
import type { PlacedRow } from '../../web/units.js';

const hero = (name: string, faction: string): Hero => ({ name, tier: 'S', class: 'Mage', faction, damageType: null, imagePath: null, owned: true, rank: null, equipmentLevel: null });
const heroes = [hero('A', 'Celestial'), hero('B', 'Celestial'), hero('C', 'Hypogean')];
const factions = new Map(heroes.map((h) => [h.name, h.faction]));
const cells = Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 0 : -2));
const placed = (...names: string[]): PlacedRow[] => names.map((name, i) => ({ tile: 38 + i, hero: name }));
const wedges: Phantimal[] = [{ name: 'Wedge of Matter', part: 'Wedge of Power', faction: 'Celestial-Hypogean', class: 'Support', seasons: [8], source: 'import' }];

describe('a Phantimal of a season the picker is not showing (ADR 0029, ADR 0025)', () => {
  it('still stands when the record holds it, even though the picker offers another season', () => {
    const state = { placed: placed('A', 'B', 'C'), phantimal: { name: 'Wedge of Matter', tile: 41, partnerTile: 42 }, phantimalChoice: 'Wedge of Matter' };
    const kept = derivePhantimal(state, cells, 0, wedges.map((p) => ({ name: p.name, faction: p.faction })), factions);
    expect(kept.phantimal).toEqual({ name: 'Wedge of Matter', tile: 41, partnerTile: 42 });
  });

  it('is still the offer of a picker that filters by season, when the record brings it', () => {
    expect(eligiblePhantimals(placed('A', 'B', 'C'), wedges.map((p) => ({ name: p.name, faction: p.faction })), factions)).toEqual(['Wedge of Matter']);
  });

  it('is forgotten when the game does not offer that Phantimal here at all', () => {
    const state = { placed: placed('A', 'B', 'C'), phantimal: { name: 'Olden', tile: 41 }, phantimalChoice: 'Olden' };
    const next = derivePhantimal(state, cells, 0, wedges.map((p) => ({ name: p.name, faction: p.faction })), factions);
    expect(next.phantimal).toBeNull();
    expect(next.phantimalChoice).toBe(''); // so the picker is never left on a value it cannot show
  });
});