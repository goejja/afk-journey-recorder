import { describe, expect, it } from 'vitest';
import type { LayoutUnit } from '../../src/domain/layout.js';
import { resolveSavedPlacement, type PlacementTarget, type SavedPlacement } from '../../src/domain/placement-reuse.js';
import { TILE } from '../../src/domain/map.js';

const cells = Array.from({ length: 45 }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const unit = (hero: string, tile: number, part = ''): LayoutUnit => ({ kind: 'hero', hero, part, tile });
const phantimal = (name: string, tile: number, partnerTile?: number): LayoutUnit[] => [
  { kind: 'phantimal', hero: name, part: '', tile },
  ...(partnerTile === undefined ? [] : [{ kind: 'phantimal' as const, hero: name, part: 'Wedge of Power', tile: partnerTile }]),
];
const record = (attemptId: number, mapName: string, units: LayoutUnit[], playerId: string | null = null, artifact: string | null = null): SavedPlacement => ({ attemptId, mapName, playerId, units, artifact });
const target = (heroes: string[], overrides: Partial<PlacementTarget> = {}): PlacementTarget => ({ mapName: 'Open', cells, zone: TILE.PLAYER, heroes, playerId: null, ...overrides });

describe('resolveSavedPlacement (ADR 0030)', () => {
  it('takes the same Profile before another one, whatever the order', () => {
    const records = [
      record(9, 'Open', [unit('A', 40), unit('B', 41)], '9999'),
      record(3, 'Open', [unit('A', 38), unit('B', 39)], '1111'),
    ];
    const found = resolveSavedPlacement(target(['A', 'B'], { playerId: '1111' }), records);
    expect(found).toMatchObject({ tier: 'profile', attemptId: 3 });
    expect(found.units.map((u) => u.tile)).toEqual([38, 39]);
  });

  it('takes the newest placement of any Profile when the team’s own has none', () => {
    const records = [record(4, 'Open', [unit('A', 38), unit('B', 39)]), record(7, 'Open', [unit('A', 40), unit('B', 41)])];
    const found = resolveSavedPlacement(target(['B', 'A'], { playerId: '1111' }), records);
    expect(found).toMatchObject({ tier: 'any', attemptId: 7 });
    expect(found.units.map((u) => u.tile)).toEqual([40, 41]);
  });

  it('needs the Map itself: a placement of another map is not reused', () => {
    const records = [record(1, 'Duel', [unit('A', 38), unit('B', 39)])];
    const found = resolveSavedPlacement(target(['A', 'B'], { playerId: '1111' }), records);
    expect(found.tier).toBe('free');
    expect(found.units.map((u) => u.tile)).toEqual([38, 39]); // first free tiles
  });

  it('needs every hero: a lookalike team is never reused', () => {
    const records = [record(1, 'Open', [unit('A', 38), unit('B', 39)])];
    expect(resolveSavedPlacement(target(['A', 'C'], { playerId: '1111' }), records).tier).toBe('free');
    expect(resolveSavedPlacement(target(['A', 'B', 'C'], { playerId: '1111' }), records).tier).toBe('free');
  });

  it('brings all of a hero’s Units with the placement, both pair parts and the summons', () => {
    const units = [unit('Elijah & Lailah', 38, 'Elijah'), unit('Elijah & Lailah', 39, 'Lailah'), unit('Zanie', 40), unit('Zanie', 41, 'Laser Turret'), unit('Zanie', 42, 'Laser Turret')];
    const found = resolveSavedPlacement(target(['Zanie', 'Elijah & Lailah'], { playerId: '1111' }), [record(1, 'Open', units)]);
    expect(found.tier).toBe('any');
    expect(found.units).toEqual(units);
  });

  it('does not reuse a placement whose Units do not fit the map', () => {
    const records = [record(1, 'Open', [unit('A', 0), unit('B', 1)])]; // enemy tiles
    const found = resolveSavedPlacement(target(['A', 'B'], { playerId: '1111' }), records);
    expect(found.tier).toBe('free');
    expect(found.units.map((u) => u.tile)).toEqual([38, 39]);
  });

  it('does not reuse a half Phantimal during a scene where the pair stands on two tiles', () => {
    const half = [unit('A', 38), unit('B', 39), unit('C', 40), ...phantimal('Wedge of Matter', 41)];
    expect(resolveSavedPlacement(target(['A', 'B', 'C'], { playerId: '1111' }), [record(1, 'Open', half)]).tier).toBe('free');
    const whole = [unit('A', 38), unit('B', 39), unit('C', 40), ...phantimal('Wedge of Matter', 41, 42)];
    expect(resolveSavedPlacement(target(['A', 'B', 'C'], { playerId: '1111' }), [record(1, 'Open', whole)]).tier).toBe('any');
  });

  it('puts the confirmed team first, tiles and all, when they fit', () => {
    const confirmed = { units: [unit('A', 40), unit('B', 41)], artifact: 'Bladestorm' };
    const found = resolveSavedPlacement(target(['A', 'B']), [record(9, 'Open', [unit('A', 38), unit('B', 39)])], confirmed);
    expect(found).toMatchObject({ tier: 'confirmed', artifact: 'Bladestorm' });
    expect(found.units.map((u) => u.tile)).toEqual([40, 41]);
  });

  it('keeps the confirmed heroes and Artifact when its tiles do not fit, and takes the tiles from the rule', () => {
    const confirmed = { units: [unit('A', 0), unit('B', 1)], artifact: 'Bladestorm' }; // enemy tiles
    const found = resolveSavedPlacement(target(['A', 'B'], { playerId: '1111' }), [record(9, 'Open', [unit('A', 38), unit('B', 39)])], confirmed);
    expect(found).toMatchObject({ tier: 'any', artifact: 'Bladestorm', fromConfirmed: false });
    expect(found.units.map((u) => u.tile)).toEqual([38, 39]);
    const none = resolveSavedPlacement(target(['A', 'B']), [], confirmed);
    expect(none).toMatchObject({ tier: 'free', artifact: 'Bladestorm', fromConfirmed: true });
    expect(none.units.map((u) => u.tile)).toEqual([38, 39]);
  });

  it('falls back to the first free tiles of the side, in the order a hero places its Units', () => {
    const found = resolveSavedPlacement(target(['Zanie', 'Elijah & Lailah']), []);
    expect(found).toMatchObject({ tier: 'free', attemptId: null });
    expect(found.units).toEqual([
      unit('Zanie', 38),
      unit('Zanie', 39, 'Laser Turret'),
      unit('Zanie', 40, 'Laser Turret'),
      unit('Elijah & Lailah', 41, 'Elijah'),
      unit('Elijah & Lailah', 42, 'Lailah'),
    ]);
  });

  it('leaves the team empty when the side has no free tile left', () => {
    const full = Array.from({ length: 45 }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.ENEMY : TILE.OPEN));
    expect(resolveSavedPlacement(target(['A'], { cells: full }), []).units).toEqual([]);
  });

  it('takes the newest match by default and the earliest when the target asks for it', () => {
    const records = [record(4, 'Open', [unit('A', 38), unit('B', 39)], '1111'), record(7, 'Open', [unit('A', 40), unit('B', 41)], '1111')];
    expect(resolveSavedPlacement(target(['A', 'B'], { playerId: '1111' }), records)).toMatchObject({ tier: 'profile', attemptId: 7 });
    expect(resolveSavedPlacement(target(['A', 'B'], { playerId: '1111', order: 'earliest' }), records)).toMatchObject({ tier: 'profile', attemptId: 4 });
  });

  it('reuses no record when the target has no Player ID', () => {
    const records = [record(4, 'Open', [unit('A', 40), unit('B', 41)], '1111')];
    const found = resolveSavedPlacement(target(['A', 'B']), records);
    expect(found).toMatchObject({ tier: 'free', attemptId: null });
    expect(found.units.map((u) => u.tile)).toEqual([38, 39]);
  });

  it('takes a side that won before one that lost when asked, the newest of each', () => {
    const records = [
      { ...record(9, 'Open', [unit('A', 38), unit('B', 39)], '1111'), won: false },
      { ...record(4, 'Open', [unit('A', 40), unit('B', 41)], '1111'), won: true },
      { ...record(2, 'Open', [unit('A', 42), unit('B', 43)], '1111'), won: true },
    ];
    expect(resolveSavedPlacement(target(['A', 'B'], { playerId: '1111', order: 'won' }), records)).toMatchObject({ attemptId: 4 });
    expect(resolveSavedPlacement(target(['A', 'B'], { playerId: '1111' }), records)).toMatchObject({ attemptId: 9 });
  });

  it('skips a win whose tiles do not fit the map and takes the next side that does', () => {
    const records = [
      { ...record(4, 'Open', [unit('A', 0), unit('B', 1)], '1111'), won: true }, // enemy tiles
      { ...record(2, 'Open', [unit('A', 40), unit('B', 41)], '1111'), won: false },
    ];
    expect(resolveSavedPlacement(target(['A', 'B'], { playerId: '1111', order: 'won' }), records)).toMatchObject({ tier: 'profile', attemptId: 2 });
  });
});
