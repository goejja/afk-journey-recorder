import { describe, expect, it } from 'vitest';
import { battleTotal, belowMaxLevel, bestTeams, formatDamage, formatDamageShort, groupBattles, levelsOf, MAX_DAMAGE, parseDamage, sharedByTeams, validateTitanReaverBattle } from '../../src/domain/titan-reaver.js';

describe('reading damage', () => {
  it('takes a whole number, with or without thousands separators', () => {
    expect(parseDamage('1234567890')).toBe(1_234_567_890);
    expect(parseDamage('1,234,567,890')).toBe(1_234_567_890);
    expect(parseDamage(' 1 234 567 ')).toBe(1_234_567);
    expect(parseDamage('0')).toBe(0);
  });

  it('takes the short forms K, M and B, with a point or a comma as the decimal mark', () => {
    expect(parseDamage('1.2B')).toBe(1_200_000_000);
    expect(parseDamage('1,2b')).toBe(1_200_000_000);
    expect(parseDamage('850K')).toBe(850_000);
    expect(parseDamage('3.45m')).toBe(3_450_000);
  });

  it('refuses what is not damage or is beyond any real one', () => {
    for (const text of ['', 'abc', '1.2', '12,34', '-5', '1.2.3B', 'B', '1e9', '1,23,456']) expect(parseDamage(text), text).toBeNull();
    expect(parseDamage(`${MAX_DAMAGE * 10}`)).toBeNull();
    expect(parseDamage('9999999B')).toBeNull();
  });

  it('shows damage with its separators', () => {
    expect(formatDamage(0)).toBe('0');
    expect(formatDamage(999)).toBe('999');
    expect(formatDamage(1_000)).toBe('1,000');
    expect(formatDamage(1_234_567_890)).toBe('1,234,567,890');
  });
});

describe('a Battle', () => {
  const ok = { seasonPhase: 2, titanPhase: 'Clash', level: 900, fights: [{ boss: 'A', damage: 5 }, { boss: 'B', damage: 7 }] };

  it('adds up its fights', () => {
    expect(battleTotal([{ damage: 5 }, { damage: 7 }])).toBe(12);
  });

  it('is valid with two different bosses and a level up to the Season Phase maximum', () => {
    expect(validateTitanReaverBattle(ok)).toBeNull();
    expect(validateTitanReaverBattle({ ...ok, seasonPhase: 3, level: 1200 })).toBeNull();
    expect(validateTitanReaverBattle({ ...ok, level: 901 })).toMatch(/1 to 900 in Season Phase 2/);
  });

  it('is refused for anything else', () => {
    expect(validateTitanReaverBattle({ ...ok, fights: [ok.fights[0]] })).toMatch(/exactly 2 fights/);
    expect(validateTitanReaverBattle({ ...ok, fights: [ok.fights[0], { boss: 'A', damage: 1 }] })).toMatch(/two different bosses/);
    expect(validateTitanReaverBattle({ ...ok, fights: [ok.fights[0], { boss: 'B', damage: 1.5 }] })).toMatch(/Fight 2/);
    expect(validateTitanReaverBattle({ ...ok, titanPhase: 'Siege' })).toMatch(/Charge, Clash or Conquer/);
    expect(validateTitanReaverBattle({ ...ok, level: 'high' })).toMatch(/whole number/);
  });
});

describe('what two teams share', () => {
  it('names a shared hero first, then a shared Artifact', () => {
    expect(sharedByTeams([{ heroes: ['A', 'B'], artifact: 'X' }, { heroes: ['B', 'C'], artifact: 'X' }])).toEqual({ kind: 'hero', name: 'B' });
    expect(sharedByTeams([{ heroes: ['A'], artifact: 'X' }, { heroes: ['C'], artifact: 'X' }])).toEqual({ kind: 'Artifact', name: 'X' });
    expect(sharedByTeams([{ heroes: ['A'], artifact: null }, { heroes: ['C'], artifact: null }])).toBeNull();
  });
});

describe('grouping Battles', () => {
  const team = (heroes: string[], artifact: string | null = null) => ({ heroes: heroes.map((name) => ({ name })), artifact });
  const battle = (id: number, total: number, level: number, a = team(['A', 'B']), b = team(['C', 'D'])) => ({
    id,
    total,
    level,
    fights: [
      { boss: 'Aegis', formation: a },
      { boss: 'Basilisk', formation: b },
    ],
  });

  it('puts the Battles of the same two teams in one group whatever their level, ranked by total', () => {
    const groups = groupBattles([battle(1, 100, 600), battle(2, 300, 900), battle(3, 200, 700, team(['B', 'A']))]);
    expect(groups).toHaveLength(1); // the order of the heroes does not matter
    expect(groups[0]).toMatchObject({ average: 200, worst: 100, lowestLevel: 600, highestLevel: 900 });
    expect(groups[0]!.best.id).toBe(2);
    expect(groups[0]!.battles.map((b) => b.id)).toEqual([2, 3, 1]);
  });

  it('makes a group of its own for another hero, Artifact or boss, and ranks the groups by best total', () => {
    const groups = groupBattles([battle(1, 100, 900), battle(2, 500, 900, team(['A', 'E'])), battle(3, 300, 900, team(['A', 'B'], 'Bladestorm'))]);
    expect(groups.map((g) => g.best.id)).toEqual([2, 3, 1]);
    const otherBoss = { ...battle(4, 50, 900), fights: [{ boss: 'Cerberus', formation: team(['A', 'B']) }, battle(4, 50, 900).fights[1]!] };
    expect(groupBattles([battle(1, 100, 900), otherBoss])).toHaveLength(2);
  });

  it('breaks a tie on the total by the Battle recorded last', () => {
    expect(groupBattles([battle(1, 100, 900), battle(2, 100, 900)])[0]!.best.id).toBe(2);
  });

  it('has no group without a Battle', () => {
    expect(groupBattles([])).toEqual([]);
  });

  it('knows a level below the Season Phase maximum', () => {
    expect(belowMaxLevel(2, 850)).toBe(true);
    expect(belowMaxLevel(2, 900)).toBe(false);
    expect(belowMaxLevel(1, 600)).toBe(false);
  });
});

describe('Best teams', () => {
  const heroesOf = (names: string[]) => names.map((name, i) => ({ tile: 38 + i, name, part: '' }));
  const at = (id: number, level: number, boss: string, damage: number, names: string[], artifact: string | null = null) => ({
    id,
    level,
    fights: [{ boss, damage, formation: { heroes: heroesOf(names), artifact } }],
  });

  it('ranks the teams that fought at the level by best damage, with the fights and the median, and calls under 5 fights an anecdote', () => {
    const battles = [at(1, 900, 'Aegis', 100, ['A']), at(2, 900, 'Aegis', 300, ['A']), at(3, 900, 'Aegis', 200, ['A']), at(4, 900, 'Aegis', 500, ['B']), at(5, 900, 'Cerberus', 9999, ['C'])];
    const teams = bestTeams(battles, 'Aegis', 900);
    expect(teams.map((t) => t.heroes)).toEqual([['B'], ['A']]);
    expect(teams[1]).toMatchObject({ fights: 3, best: 300, median: 200, anecdote: true, lowerLevel: null });
    const many = bestTeams(Array.from({ length: 5 }, (_, i) => at(i, 900, 'Aegis', 100 + i, ['A'])), 'Aegis', 900);
    expect(many[0]).toMatchObject({ fights: 5, anecdote: false, median: 102 });
  });

  it('takes the same heroes and Artifact wherever they stood as one team, and another Artifact as another', () => {
    const moved = { id: 2, level: 900, fights: [{ boss: 'Aegis', damage: 50, formation: { heroes: [{ tile: 10, name: 'A', part: '' }], artifact: null } }] };
    const teams = bestTeams([at(1, 900, 'Aegis', 100, ['A']), moved, at(3, 900, 'Aegis', 70, ['A'], 'Bladestorm')], 'Aegis', 900);
    expect(teams).toHaveLength(2);
    expect(teams.find((t) => t.artifact === null)!.placements.map((p) => [p.fights, p.best])).toEqual([[1, 100], [1, 50]]);
  });

  it('lists after them the teams with no fight at the level, by their highest level, and never scales a damage', () => {
    const teams = bestTeams([at(1, 900, 'Aegis', 100, ['A']), at(2, 600, 'Aegis', 9000, ['B']), at(3, 800, 'Aegis', 10, ['C']), at(4, 800, 'Aegis', 50, ['C'])], 'Aegis', 900);
    expect(teams.map((t) => t.heroes[0])).toEqual(['A', 'C', 'B']);
    expect(teams[1]).toMatchObject({ best: null, fights: 0, lowerLevel: { level: 800, best: 50 } });
    expect(teams[2]!.lowerLevel).toEqual({ level: 600, best: 9000 });
  });

  it('notes a team that beat the top one at a level both were recorded at, the highest such level', () => {
    const battles = [
      at(1, 900, 'Aegis', 1000, ['A']),
      at(2, 850, 'Aegis', 1100, ['B']),
      at(3, 850, 'Aegis', 1400, ['B']),
      at(4, 850, 'Aegis', 1100, ['A']),
      at(5, 900, 'Aegis', 600, ['B']),
    ];
    const [top, other] = bestTeams(battles, 'Aegis', 900);
    expect(top!.heroes).toEqual(['A']);
    expect(top!.beat).toBeNull();
    expect(other!.best).toBe(600); // lower damage than the top one at the level...
    expect(other!.beat).toEqual({ level: 850, damage: 1400, against: 1100, fights: 2, againstFights: 1 }); // ...but it did better at 850
  });

  it('gives no note for a team that never shared a level with the top one, or never beat it', () => {
    const teams = bestTeams([at(1, 900, 'Aegis', 1000, ['A']), at(2, 700, 'Aegis', 5000, ['B']), at(3, 900, 'Aegis', 400, ['C']), at(4, 800, 'Aegis', 1, ['A']), at(5, 800, 'Aegis', 0, ['C'])], 'Aegis', 900);
    expect(teams.every((t) => t.beat === null)).toBe(true);
  });

  it('keeps only the teams with every included hero and none of the excluded ones, and ranks what is left', () => {
    const battles = [at(1, 900, 'Aegis', 500, ['A', 'B']), at(2, 900, 'Aegis', 400, ['A']), at(3, 900, 'Aegis', 300, ['C', 'B'])];
    expect(bestTeams(battles, 'Aegis', 900, { include: ['B'] }).map((t) => t.best)).toEqual([500, 300]);
    expect(bestTeams(battles, 'Aegis', 900, { exclude: ['A'] }).map((t) => t.best)).toEqual([300]);
    expect(bestTeams(battles, 'Aegis', 900, { include: ['B'], exclude: ['A'] })[0]!.beat).toBeNull(); // the top is judged among those kept
  });

  it('lists the levels recorded against a boss, highest first', () => {
    expect(levelsOf([at(1, 600, 'Aegis', 1, ['A']), at(2, 900, 'Aegis', 1, ['A']), at(3, 700, 'Cerberus', 1, ['A'])], 'Aegis')).toEqual([900, 600]);
  });
});

describe('formatDamageShort', () => {
  it('keeps 3 significant digits with K, M and B, and drops trailing zeros', () => {
    expect(formatDamageShort(0)).toBe('0');
    expect(formatDamageShort(999)).toBe('999');
    expect(formatDamageShort(1_000)).toBe('1K');
    expect(formatDamageShort(850_000)).toBe('850K');
    expect(formatDamageShort(12_345_678)).toBe('12.3M');
    expect(formatDamageShort(1_234_567_890)).toBe('1.23B');
    expect(formatDamageShort(2_000_000_000)).toBe('2B');
  });

  it('moves to the next unit when rounding reaches 1000', () => {
    expect(formatDamageShort(999_999)).toBe('1M');
    expect(formatDamageShort(999_600_000)).toBe('1B');
  });

  it('stops at B, like the game: 1523B, not 1.5T', () => {
    expect(formatDamageShort(1_523_400_000_000)).toBe('1523B');
    expect(formatDamageShort(999_600_000_000)).toBe('1000B');
    expect(formatDamageShort(123_456_000_000)).toBe('123B');
    expect(parseDamage('1523B')).toBe(1_523_000_000_000);
    expect(parseDamage('1.5T')).toBeNull();
  });

  it('reads back through parseDamage to within its rounding', () => {
    expect(parseDamage(formatDamageShort(1_234_567_890))).toBe(1_230_000_000);
  });
});
