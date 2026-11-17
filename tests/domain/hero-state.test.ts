import { describe, expect, it } from 'vitest';
import { allowedEquipmentLevels, allowedRanks, equipmentForRank, minimumRank, validateHeroState, type HeroStateRules } from '../../src/domain/hero-state.js';

const rules: HeroStateRules = {
  ranks: ['Rare', 'Mythic+', 'Supreme', 'Apex'],
  equipmentLevels: [0, 5, 10, 15, 20, 25, 30],
  caps: [
    { rank: 'Mythic+', minLevel: null, maxLevel: 10 },
    { rank: 'Supreme', minLevel: null, maxLevel: 15 },
    { rank: 'Apex', minLevel: 25, maxLevel: null },
  ],
};

describe('allowedEquipmentLevels', () => {
  it('limits levels by the rank cap', () => {
    expect(allowedEquipmentLevels('Mythic+', rules)).toEqual([0, 5, 10]);
  });
  it('applies a minimum for Apex', () => {
    expect(allowedEquipmentLevels('Apex', rules)).toEqual([25, 30]);
  });
  it('allows no equipment below Mythic+ or with an unset rank', () => {
    expect(allowedEquipmentLevels('Rare', rules)).toEqual([]);
    expect(allowedEquipmentLevels(null, rules)).toEqual([]);
  });
});

describe('equipmentForRank', () => {
  it('gives a hero with no equipment the lowest level its new rank allows', () => {
    expect(equipmentForRank(null, 'Mythic+', rules)).toBe(0);
    expect(equipmentForRank(null, 'Apex', rules)).toBe(25);
  });
  it('lowers a level above the cap to the cap', () => {
    expect(equipmentForRank(30, 'Supreme', rules)).toBe(15);
  });
  it('raises a level below the minimum to the minimum', () => {
    expect(equipmentForRank(5, 'Apex', rules)).toBe(25);
  });
  it('keeps a level the new rank allows', () => {
    expect(equipmentForRank(10, 'Supreme', rules)).toBe(10);
  });
  it('removes the equipment where the rank allows none, or when the rank is unset', () => {
    expect(equipmentForRank(10, 'Rare', rules)).toBeNull();
    expect(equipmentForRank(null, 'Rare', rules)).toBeNull();
    expect(equipmentForRank(10, null, rules)).toBeNull();
  });
});

describe('validateHeroState', () => {
  it('accepts an unset state', () => {
    expect(validateHeroState({ rank: null, equipmentLevel: null }, rules)).toBeNull();
  });
  it('accepts no equipment at any rank, including Apex', () => {
    expect(validateHeroState({ rank: 'Apex', equipmentLevel: null }, rules)).toBeNull();
  });
  it('rejects equipment above the cap', () => {
    expect(validateHeroState({ rank: 'Mythic+', equipmentLevel: 15 }, rules)).toMatch(/not allowed at rank Mythic\+/);
  });
  it('rejects Apex below its minimum', () => {
    expect(validateHeroState({ rank: 'Apex', equipmentLevel: 5 }, rules)).toMatch(/not allowed/);
  });
  it('rejects equipment on a rank without a cap row, and with no rank', () => {
    expect(validateHeroState({ rank: 'Rare', equipmentLevel: 5 }, rules)).toMatch(/not allowed at rank Rare/);
    expect(validateHeroState({ rank: null, equipmentLevel: 5 }, rules)).toMatch(/not allowed at rank unset/);
  });
  it('rejects unknown ranks and levels', () => {
    expect(validateHeroState({ rank: 'Godlike', equipmentLevel: null }, rules)).toMatch(/Unknown rank/);
    expect(validateHeroState({ rank: 'Mythic+', equipmentLevel: 7 }, rules)).toMatch(/Unknown equipment level/);
  });
});

describe('rank by tier', () => {
  const ranks = ['Rare', 'Elite', 'Epic', 'Mythic+', 'Apex'];

  it('lets S heroes start at Epic, A heroes at Elite, and R heroes be only Rare', () => {
    expect(allowedRanks('S', ranks)).toEqual(['Epic', 'Mythic+', 'Apex']);
    expect(allowedRanks('A', ranks)).toEqual(['Elite', 'Epic', 'Mythic+', 'Apex']);
    expect(allowedRanks('R', ranks)).toEqual(['Rare']);
  });

  it('allows every rank when the tier is unknown', () => {
    expect(allowedRanks(null, ranks)).toEqual(ranks);
    expect(allowedRanks('X', ranks)).toEqual(ranks);
  });

  it('gives the rank a hero starts at', () => {
    expect(minimumRank('S', ranks)).toBe('Epic');
    expect(minimumRank('A', ranks)).toBe('Elite');
    expect(minimumRank('R', ranks)).toBe('Rare');
    expect(minimumRank(null, ranks)).toBeNull();
  });

  it('rejects a rank the tier cannot have, with a clear message', () => {
    const rules2: HeroStateRules = { ranks, equipmentLevels: [0], caps: [] };
    expect(validateHeroState({ rank: 'Elite', equipmentLevel: null }, rules2, 'S')).toBe('S heroes start at Epic, not Elite');
    expect(validateHeroState({ rank: 'Epic', equipmentLevel: null }, rules2, 'S')).toBeNull();
    expect(validateHeroState({ rank: 'Mythic+', equipmentLevel: null }, rules2, 'R')).toBe('R heroes can only be Rare');
    expect(validateHeroState({ rank: 'Rare', equipmentLevel: null }, rules2, 'R')).toBeNull();
    expect(validateHeroState({ rank: 'Rare', equipmentLevel: null }, rules2, 'A')).toBe('A heroes start at Elite, not Rare');
    expect(validateHeroState({ rank: 'Elite', equipmentLevel: null }, rules2, 'A')).toBeNull();
    expect(validateHeroState({ rank: 'Elite', equipmentLevel: null }, rules2)).toBeNull(); // no tier given: not checked
  });
});
