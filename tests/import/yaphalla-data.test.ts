import { describe, expect, it } from 'vitest';
import { extractReferenceData } from '../../src/import/yaphalla-data.js';
import { chunkA, chunkB } from '../fixtures/yaphalla-chunks.js';

describe('extractReferenceData', () => {
  const data = extractReferenceData([chunkA, chunkB]);

  it('rebuilds the 15 ranks with position 0 as the lowest', () => {
    expect(data.ranks).toHaveLength(15);
    expect(data.ranks[0]).toEqual({ name: 'Rare', position: 0 });
    expect(data.ranks.at(-1)).toEqual({ name: 'Paragon 4', position: 14 });
    expect(data.ranks.map((r) => r.name)).not.toContain('Crown'); // another name for Paragon 4 with the R4 weapon
    expect(data.ranks.map((r) => r.name)).not.toContain('None');
    expect(data.ranks.map((r) => r.name)).toContain('Mythic+');
  });

  it('uses the game’s weapon levels, with R1 to R4 as +26 to +29', () => {
    expect(data.equipmentLevels).toEqual([0, 5, 10, 15, 20, 25, 26, 27, 28, 29]);
  });

  it('caps the weapon level by rank', () => {
    const caps = Object.fromEntries(data.rankEquipmentCaps.map((c) => [c.rank, c]));
    expect(caps['Mythic+']).toEqual({ rank: 'Mythic+', minLevel: null, maxLevel: 10 });
    expect(caps['Supreme']).toEqual({ rank: 'Supreme', minLevel: null, maxLevel: 15 });
    expect(caps['Supreme+']).toEqual({ rank: 'Supreme+', minLevel: null, maxLevel: 25 });
    expect(caps['Paragon 1']).toEqual({ rank: 'Paragon 1', minLevel: null, maxLevel: 26 });
    expect(caps['Paragon 4']).toEqual({ rank: 'Paragon 4', minLevel: null, maxLevel: 29 });
  });

  it('collects artifacts with level caps and skips Honor Duel', () => {
    const byName = Object.fromEntries(data.artifacts.map((a) => [a.name, a]));
    expect(byName['Awakening']).toEqual({ name: 'Awakening', group: 'Pre-Season' });
    expect(byName['Arc Burst']).toEqual({ name: 'Arc Burst', group: 'Season 7' });
    expect(byName['Bladestorm']?.group).toBe('Season 8');
    expect(byName['Art of Ruling']).toBeUndefined();
  });

  it('collects phantimals with the seasons they belong to', () => {
    const byName = Object.fromEntries(data.phantimals.map((p) => [p.name, p]));
    expect(data.phantimals).toHaveLength(11);
    expect(byName['Gervan']).toEqual({ name: 'Gervan', faction: 'Lightbearer', class: 'Mage', seasons: [8] });
    expect(byName['Aurelian']?.seasons).toEqual([7]);
    expect(byName['Wedge of Power']).toMatchObject({ faction: 'Celestial-Hypogean', class: 'Support' });
  });

  it('fails loudly when a structure is missing', () => {
    expect(() => extractReferenceData([])).toThrow();
  });
});
