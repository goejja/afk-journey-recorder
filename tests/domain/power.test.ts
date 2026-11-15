import { describe, expect, it } from 'vitest';
import { equipmentStep, fitGapSlope, gapShift, GAP_SLOPE_CAP, MIN_GAP_BATTLES, sidePower } from '../../src/domain/power.js';

const positions = new Map([['Elite', 1], ['Legend', 3], ['Mythic', 5]]);

describe('sidePower', () => {
  it('is the mean over the heroes of the rank position plus the equipment step', () => {
    expect(sidePower([{ rank: 'Legend', equipment: 25 }, { rank: 'Elite', equipment: 0 }], positions)).toBe((3 + 5 + 1 + 0) / 2);
  });
  it('is unknown when one hero has no rank, or the side has no heroes', () => {
    expect(sidePower([{ rank: 'Legend', equipment: 25 }, { rank: null, equipment: 25 }], positions)).toBeNull();
    expect(sidePower([{ rank: 'Nowhere', equipment: 25 }], positions)).toBeNull();
    expect(sidePower([], positions)).toBeNull();
  });
  it('steps equipment by fives up to +25, then one for each Resonance level', () => {
    expect([null, 0, 10, 25, 28].map(equipmentStep)).toEqual([0, 0, 2, 5, 8]);
  });
});

describe('gapShift', () => {
  it('is zero when the battle was fought at the gap asked about, or with no slope', () => {
    expect(gapShift(0.6, 2, 2)).toBeCloseTo(0, 12);
    expect(gapShift(0, -3, 4)).toBe(0);
  });
  it('lifts a battle fought behind and lowers one fought ahead, when asked at an equal gap', () => {
    expect(gapShift(0.6, -2, 0)).toBeGreaterThan(0.25);
    expect(gapShift(0.6, 2, 0)).toBeLessThan(-0.25);
  });
  it('is symmetric: as much up behind as down ahead', () => {
    expect(gapShift(0.5, -1.5, 0)).toBeCloseTo(-gapShift(0.5, 1.5, 0), 12);
  });
});

describe('fitGapSlope', () => {
  const battles = (n: number, rule: (i: number) => { gap: number; won: boolean }) => Array.from({ length: n }, (_, i) => rule(i));
  it('finds no slope when the gap says nothing, and none with too few battles', () => {
    const noise = battles(100, (i) => ({ gap: (i % 5) - 2, won: i % 2 === 0 }));
    expect(fitGapSlope(noise)).toBeLessThan(0.1);
    expect(fitGapSlope(battles(MIN_GAP_BATTLES - 1, (i) => ({ gap: i % 2 ? 2 : -2, won: i % 2 === 1 })))).toBe(0);
  });
  it('finds a positive slope when the side ahead mostly wins', () => {
    const data = battles(200, (i) => { const gap = (i % 7) - 3; return { gap, won: (i * 37) % 100 < 50 + gap * 12 }; });
    const slope = fitGapSlope(data);
    expect(slope).toBeGreaterThan(0.2);
    expect(slope).toBeLessThanOrEqual(GAP_SLOPE_CAP);
  });
  it('stays at the cap when the gap separates the results perfectly', () => {
    expect(fitGapSlope(battles(40, (i) => ({ gap: i % 2 ? 3 : -3, won: i % 2 === 1 })))).toBe(GAP_SLOPE_CAP);
  });
  it('never goes below zero: being behind is not a help', () => {
    expect(fitGapSlope(battles(60, (i) => ({ gap: i % 2 ? 3 : -3, won: i % 2 === 0 })))).toBe(0);
  });
});
