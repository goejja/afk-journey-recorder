import { describe, expect, it } from 'vitest';
import { foldName, matchProfile } from '../../src/domain/name-match.js';

const profiles = [
  { id: 1, name: 'Brin' },
  { id: 2, name: 'Mokka' },
  { id: 3, name: 'Dom' },
  { id: 4, name: '星の旅人' },
];

describe('foldName', () => {
  it('writes look-alike Cyrillic letters as Latin and ignores case and space', () => {
    expect(foldName('Мокка')).toBe('mokka');
    expect(foldName('  MOKKA ')).toBe('mokka');
  });

  it('leaves other scripts alone', () => {
    expect(foldName('星の旅人')).toBe('星の旅人');
  });
});

describe('matchProfile', () => {
  it('matches a name ignoring case', () => {
    expect(matchProfile('dom', profiles)).toEqual({ profile: profiles[2], spelledDifferently: false });
  });

  it('matches a profile typed with look-alike Latin letters and says the spelling differs', () => {
    expect(matchProfile('Мокка', profiles)).toEqual({ profile: profiles[1], spelledDifferently: true });
  });

  it('matches non-Latin names exactly', () => {
    expect(matchProfile('星の旅人', profiles)?.profile.id).toBe(4);
  });

  it('finds nothing for a new player', () => {
    expect(matchProfile('百円おじさん', profiles)).toBeNull();
  });

  it('does not guess between two profiles that fold to the same name', () => {
    expect(matchProfile('Мокка', [...profiles, { id: 10, name: 'mokkа' }])).toBeNull();
    expect(matchProfile('Mokka', [{ id: 1, name: 'Мокка' }, { id: 2, name: 'mokkа' }])).toBeNull();
  });
});
