import { describe, expect, it } from 'vitest';
import { checkProposal, pairTiles } from '../../src/import/rank-learning.js';
import type { RankExample } from '../../src/vision/rank-read.js';

/**
 * Looks as bare feature vectors: only the distance function reads them, so a flat vector of one value stands for a look, and the gap between two values
 * is their distance. The vectors are long enough for the grid, ornament and background parts that `distance` sums.
 */
const LENGTH = 4000;
const look = (rank: string, value: number): RankExample => ({ rank, features: new Float32Array(LENGTH).fill(value) });
const around = (rank: string, value: number, count: number): RankExample[] => Array.from({ length: count }, (_, i) => look(rank, value + i * 0.0001));

describe('checkProposal', () => {
  const known = [...around('Supreme+', 0.2, 4), ...around('Paragon 2', 0.6, 4)];

  it('reads each look from all the others, before and after the proposed looks', () => {
    const proposed = around('Paragon 3', 0.4, 4);
    const check = checkProposal(known, proposed);
    expect(check.before.overall.probes).toBe(12);
    expect(check.before.byRank.get('Paragon 3')).toMatchObject({ probes: 4, correct: 0 }); // no Paragon 3 look to read from yet
    expect(check.after.byRank.get('Paragon 3')).toMatchObject({ probes: 4, correct: 4, wrong: 0 });
    expect(check.after.overall.wrong).toBe(0);
    expect(check.refused).toBeNull();
  });

  it('refuses a proposal that makes the reader name a wrong rank more often', () => {
    // one Paragon 3 look lies among the Supreme+ ones: it takes the Supreme+ looks next to it with it
    const proposed = [look('Paragon 3', 0.20045), ...around('Paragon 3', 0.5, 3)];
    const spread = [look('Supreme+', 0.2), look('Supreme+', 0.2003), look('Supreme+', 0.2006), look('Supreme+', 0.2009), ...around('Paragon 2', 0.6, 4)];
    const check = checkProposal(spread, proposed);
    expect(check.after.overall.wrong).toBeGreaterThan(check.before.overall.wrong);
    expect(check.confused.length).toBeGreaterThan(0);
    expect(check.refused).toMatch(/wrong/);
  });
});

describe('pairTiles', () => {
  const side = [{ hero: 'Evie', rank: 'Paragon 3' }, { hero: 'Zed', rank: 'Supreme+' }, { hero: 'Fay', rank: null }, { hero: 'Nara', rank: 'Mythic' }, { hero: 'Ode', rank: 'Epic' }];

  it('pairs a tile with the record only when its hero is on the side once and the rank can be trusted', () => {
    const { paired, skipped } = pairTiles(['Evie', 'Zed', 'Fay', null, 'Nara', 'Gus', 'Ode', 'Ode'], side, new Map([['Zed', 'Supreme+'], ['Evie', 'Paragon 2']]));
    expect(paired).toEqual([{ index: 0, hero: 'Evie', rank: 'Paragon 3' }, { index: 4, hero: 'Nara', rank: 'Mythic' }]);
    expect(Object.fromEntries(skipped)).toEqual({ roster: 1, 'no-rank': 1, unnamed: 1, 'not-on-side': 1, 'named-twice': 2 });
  });
});
