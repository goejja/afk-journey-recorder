import { describe, expect, it } from 'vitest';
import { compareLayouts, isFormationId, layoutFrom, layoutKey, normalizeFormationId, rotateLayout, type Layout } from '../../src/domain/layout.js';
import { TILE_COUNT } from '../../src/domain/map.js';

const team: Layout = {
  units: [
    { kind: 'hero', hero: 'Alna', part: '', tile: 31 },
    { kind: 'hero', hero: 'Rolan', part: '', tile: 27 },
    { kind: 'hero', hero: 'Orion', part: '', tile: 33 },
  ],
};

describe('layoutKey', () => {
  it('does not depend on the order the units were placed in', () => {
    expect(layoutKey({ ...team, units: [...team.units].reverse() })).toBe(layoutKey(team));
  });
  it('changes when a hero or a tile changes', () => {
    expect(layoutKey({ ...team, units: [{ kind: 'hero', hero: 'Alna', part: '', tile: 32 }, ...team.units.slice(1)] })).not.toBe(layoutKey(team));
    expect(layoutKey({ ...team, units: [{ kind: 'hero', hero: 'Fay', part: '', tile: 31 }, ...team.units.slice(1)] })).not.toBe(layoutKey(team));
  });
  it('tells a phantimal from a hero of the same name and a part from the whole', () => {
    const one: Layout = { units: [{ kind: 'phantimal', hero: 'Orson', part: '', tile: 30 }] };
    const two: Layout = { units: [{ kind: 'hero', hero: 'Orson', part: '', tile: 30 }] };
    expect(layoutKey(one)).not.toBe(layoutKey(two));
    const pair: Layout = {
      units: [
        { kind: 'hero', hero: 'Elijah & Lailah', part: 'Elijah', tile: 30 },
        { kind: 'hero', hero: 'Elijah & Lailah', part: 'Lailah', tile: 31 },
      ],
    };
    expect(layoutKey(pair)).not.toBe(layoutKey({ units: [pair.units[0]!] }));
  });
});

describe('rotateLayout', () => {
  it('turns the board upside down: tile i goes to the tile 44 - i', () => {
    const turned = rotateLayout({
      units: [
        { kind: 'hero', hero: 'Alna', part: '', tile: 0 },
        { kind: 'hero', hero: 'Fay', part: '', tile: 31 },
        { kind: 'phantimal', hero: 'Orson', part: '', tile: 40 },
        { kind: 'phantimal', hero: 'Orson', part: 'Wedge of Power', tile: 41 },
      ],
    });
    expect(turned.units.map((u) => u.tile)).toEqual([TILE_COUNT - 1, 13, 4, 3]);
  });
  it('undoes itself', () => {
    expect(layoutKey(rotateLayout(rotateLayout(team)))).toBe(layoutKey(team));
  });
});

describe('compareLayouts', () => {
  it('says same for the same units on the same tiles, whatever their rank (which is not in a layout)', () => {
    expect(compareLayouts(team, { ...team, units: [...team.units].reverse() })).toBe('same');
  });
  it('says rotated when the other layout is the same deployment seen from the other half', () => {
    expect(compareLayouts(team, rotateLayout(team))).toBe('rotated');
  });
  it('says nothing for a different deployment', () => {
    expect(compareLayouts(team, { ...team, units: team.units.slice(1) })).toBeNull();
    expect(compareLayouts(team, { ...team, units: [...team.units, { kind: 'phantimal', hero: 'Orson', part: '', tile: 30 }] })).toBeNull();
  });
  it('prefers same when a layout is its own rotation', () => {
    const centre: Layout = { units: [{ kind: 'hero', hero: 'Alna', part: '', tile: 22 }] };
    expect(compareLayouts(centre, centre)).toBe('same');
  });
});

describe('layoutFrom', () => {
  it('reads the units and folds the phantimal in, ignoring rank, equipment and artifact', () => {
    const formation = {
      heroes: [
        { tile: 31, hero: 'Alna', rank: 'Epic', equipmentLevel: 5 },
        { tile: 27, hero: 'Zanie', part: 'Laser Turret' },
      ],
      phantimal: { name: 'Wedge of Matter', tile: 30, partnerTile: 29 },
      artifact: 'Candlestick',
    };
    expect(layoutFrom(formation)).toEqual({
      units: [
        { kind: 'hero', hero: 'Alna', part: '', tile: 31 },
        { kind: 'hero', hero: 'Zanie', part: 'Laser Turret', tile: 27 },
        { kind: 'phantimal', hero: 'Wedge of Matter', part: '', tile: 30 },
        { kind: 'phantimal', hero: 'Wedge of Matter', part: 'Wedge of Power', tile: 29 },
      ],
    });
  });
  it('keeps both tiles of a pair phantimal, so a half pair is a different Layout', () => {
    const whole = layoutFrom({ heroes: [], phantimal: { name: 'Wedge of Matter', tile: 30, partnerTile: 29 } });
    const half = layoutFrom({ heroes: [], phantimal: { name: 'Wedge of Matter', tile: 30 } });
    expect(layoutKey(whole)).not.toBe(layoutKey(half));
  });
});

describe('formation ids', () => {
  it('are eight digits or upper-case letters', () => {
    expect(isFormationId('A1B2C3D4')).toBe(true);
    expect(isFormationId('12345678')).toBe(true);
    for (const bad of ['a1b2c3d4', 'A1B2C3D', 'A1B2C3D45', 'A1B2-3D4', '', 'A1B2C3 ']) expect(isFormationId(bad)).toBe(false);
  });
  it('are typed in any case with spaces around, and normalized', () => {
    expect(normalizeFormationId('  a1b2c3d4 ')).toBe('A1B2C3D4');
  });
});