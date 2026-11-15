import { describe, expect, it } from 'vitest';
import { weaponLabel, weaponStars, WEAPON_CAPS, WEAPON_LEVELS } from '../../src/domain/exclusive-weapon.js';
import { allowedEquipmentLevels } from '../../src/domain/hero-state.js';

describe('exclusive weapon levels', () => {
  it('names R1 to R4 as +26 to +29', () => {
    expect(WEAPON_LEVELS.map(weaponLabel)).toEqual(['+0', '+5', '+10', '+15', '+20', '+25', 'R1', 'R2', 'R3', 'R4']);
  });

  it('draws two to six grey stars up to +25, then six purple, yellow, red and rainbow stars', () => {
    expect([5, 10, 15, 20, 25].map((l) => weaponStars(l))).toEqual([
      { count: 2, color: 'grey' }, { count: 3, color: 'grey' }, { count: 4, color: 'grey' }, { count: 5, color: 'grey' }, { count: 6, color: 'grey' },
    ]);
    expect([26, 27, 28, 29].map((l) => weaponStars(l))).toEqual([
      { count: 6, color: 'purple' }, { count: 6, color: 'yellow' }, { count: 6, color: 'red' }, { count: 6, color: 'rainbow' },
    ]);
  });

  it('limits the level by rank: +10 at Mythic+, +15 at Supreme, +25 at Supreme+, R1 to R4 at Paragon 1 to 4', () => {
    const rules = { ranks: [], equipmentLevels: WEAPON_LEVELS, caps: WEAPON_CAPS };
    expect(allowedEquipmentLevels('Mythic+', rules)).toEqual([0, 5, 10]);
    expect(allowedEquipmentLevels('Supreme', rules)).toEqual([0, 5, 10, 15]);
    expect(allowedEquipmentLevels('Supreme+', rules)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(allowedEquipmentLevels('Paragon 1', rules)).toEqual([0, 5, 10, 15, 20, 25, 26]);
    expect(allowedEquipmentLevels('Paragon 4', rules).at(-1)).toBe(29);
    expect(allowedEquipmentLevels('Legendary+', rules)).toEqual([]);
  });
});
