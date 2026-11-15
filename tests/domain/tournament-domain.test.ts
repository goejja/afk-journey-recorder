import { describe, expect, it } from 'vitest';
import { checkTournamentRound, reusableIn, roundWarnings, type TournamentSummary } from '../../src/domain/tournament.js';

const tournaments: TournamentSummary[] = [
  { id: 1, season: 8, number: 1, rounds: ['Group stage', 'Swiss stage', 'Top 48', 'Top 16', 'Semi-Finals', 'Finals'] },
  { id: 2, season: 8, number: 2, rounds: ['Group stage', 'Swiss stage'] },
];

describe('what a batch import warns about', () => {
  it('says nothing for the latest Tournament and the Round it is in or comes next', () => {
    expect(roundWarnings({ tournamentId: 2, round: 'Swiss stage' }, tournaments)).toEqual([]);
    expect(roundWarnings({ tournamentId: 2, round: 'Top 48' }, tournaments)).toEqual([]);
  });

  it('warns about an older Tournament, whichever the Round', () => {
    expect(roundWarnings({ tournamentId: 1, round: 'Finals' }, tournaments)).toEqual([{ kind: 'older-tournament', latest: { id: 2, season: 8, number: 2 } }]);
  });

  it('warns about a Round before one that already has Battles', () => {
    expect(roundWarnings({ tournamentId: 2, round: 'Group stage' }, tournaments)).toEqual([{ kind: 'earlier-round', latest: 'Swiss stage' }]);
  });

  it('orders Tournaments by Season then number, and ignores an unknown one', () => {
    const later = [...tournaments, { id: 3, season: 9, number: 1, rounds: [] }];
    expect(roundWarnings({ tournamentId: 2, round: 'Top 16' }, later)).toEqual([{ kind: 'older-tournament', latest: { id: 3, season: 9, number: 1 } }]);
    expect(roundWarnings({ tournamentId: 99, round: 'Top 16' }, later)).toEqual([]);
  });
});

describe('which saved fights a batch import may reuse', () => {
  const fights = [
    { id: 1, tournamentId: 2, round: 'Group stage' as const },
    { id: 2, tournamentId: 2, round: 'Swiss stage' as const },
    { id: 3, tournamentId: 1, round: 'Group stage' as const },
    { id: 4, tournamentId: null, round: null },
  ];

  it('takes only the same Tournament and Round', () => {
    expect(reusableIn(fights, { tournamentId: 2, round: 'Group stage' }).map((f) => f.id)).toEqual([1]);
  });

  it('takes only Battles with no Tournament when there is none', () => {
    expect(reusableIn(fights, null).map((f) => f.id)).toEqual([4]);
  });
});

describe('the Tournament and Round of a body', () => {
  it('is undefined when the body does not mention them', () => {
    expect(checkTournamentRound('Super League', {})).toBeUndefined();
    expect(checkTournamentRound('Arena', null)).toBeUndefined();
  });

  it('clears both on null, and refuses one without the other or another mode', () => {
    expect(checkTournamentRound('Arena', { tournamentId: null, round: null })).toEqual({ tournamentId: null, round: null });
    expect(checkTournamentRound('Super League', { tournamentId: 1 })).toHaveProperty('error');
    expect(checkTournamentRound('Super League', { round: 'Finals' })).toHaveProperty('error');
    expect(checkTournamentRound('Guild Duel', { tournamentId: 1, round: 'Finals' })).toHaveProperty('error');
  });
});
