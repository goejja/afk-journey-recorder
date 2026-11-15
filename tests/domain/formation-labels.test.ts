import { describe, expect, it } from 'vitest';
import { evidenceLabels, type LabelInput } from '../../src/domain/formation-labels.js';

const solid: LabelInput = { games: 40, wins: 22, playerGames: [8, 8, 8, 8, 8], strongAgainst: [], gapAdjustment: null };
const names = (input: Partial<LabelInput>) => evidenceLabels({ ...solid, ...input }).map((l) => l.name);

describe('evidence labels of a formation group', () => {
  it('gives no label to a well-supported group', () => {
    expect(names({})).toEqual([]);
  });

  it('flags limited evidence under 30 games or under 5 Players, and not at the edge', () => {
    expect(names({ games: 29, wins: 15, playerGames: [6, 6, 6, 6, 5] })).toEqual(['Limited evidence']);
    expect(names({ games: 30, wins: 15, playerGames: [6, 6, 6, 6, 6] })).toEqual([]);
    expect(names({ games: 40, wins: 20, playerGames: [10, 10, 10, 10] })).toEqual(['Limited evidence']);
  });

  it('flags a concentrated sample when one Player has 35% of the games or two have 60%', () => {
    expect(names({ playerGames: [14, 6, 6, 7, 7] })).toEqual(['Concentrated sample']);
    expect(names({ playerGames: [13, 6, 7, 7, 7] })).toEqual([]);
    expect(names({ playerGames: [12, 12, 4, 4, 4] })).toEqual(['Concentrated sample']);
  });

  it('flags a high win rate only together with limited evidence', () => {
    expect(names({ games: 10, wins: 6, playerGames: [2, 2, 2, 2, 2] })).toEqual(['Limited evidence', 'High win rate']);
    expect(names({ games: 10, wins: 5, playerGames: [2, 2, 2, 2, 2] })).toEqual(['Limited evidence']);
    expect(names({ games: 40, wins: 30 })).toEqual([]);
  });

  it('flags narrow use for a group under 50% that is a counter to another, naming it', () => {
    const labels = evidenceLabels({ ...solid, wins: 19, strongAgainst: ['Aliceth + Kulu'] });
    expect(labels).toEqual([{ name: 'Narrow use', detail: 'Aliceth + Kulu' }]);
    expect(names({ wins: 20, strongAgainst: ['Aliceth + Kulu'] })).toEqual([]);
  });

  it('flags better or worse than it looks when upgrades move the expected win rate 5 points, on at least 10 battles with a known gap', () => {
    expect(names({ gapAdjustment: { games: 10, shift: -0.05 } })).toEqual(['Worse than it looks']);
    expect(names({ gapAdjustment: { games: 10, shift: 0.05 } })).toEqual(['Better than it looks']);
    expect(names({ gapAdjustment: { games: 10, shift: 0.04 } })).toEqual([]);
    expect(names({ gapAdjustment: { games: 9, shift: 0.2 } })).toEqual([]);
  });
});
