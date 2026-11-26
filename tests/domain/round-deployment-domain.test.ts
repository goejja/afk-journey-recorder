import { describe, expect, it } from 'vitest';
import { TILE_COUNT } from '../../src/domain/map.js';
import { matchTeam, sameReading, withSeenAs, roundDeploymentProblem, turnTeam, withPlacement, type ReadSide, type RoundHero, type RoundTeam } from '../../src/domain/round-deployment.js';

const hero = (name: string, tile: number, rank: string | null = 'Mythic', equipmentLevel: number | null = 10): RoundHero => ({ tile, hero: name, part: '', rank, equipmentLevel });
const team = (heroes: RoundHero[], artifact: string | null = 'Crown', phantimal: RoundTeam['phantimal'] = null): RoundTeam => ({ heroes, artifact, phantimal });
const read = (names: string[], extra: Partial<ReadSide> = {}): ReadSide => ({
  heroes: names.map((name) => ({ hero: name, rank: null, equipmentLevel: null })),
  artifact: null,
  phantimal: null,
  unread: 0,
  ...extra,
});
const deployed = team([hero('A', 38), hero('B', 39), hero('C', 40)]);

describe('the Faction Requirement of a Round Deployment team (ADR 0029)', () => {
  const factions = {
    heroFactions: new Map([
      ['A', 'Lightbearer'],
      ['B', 'Lightbearer'],
      ['C', 'Wilder'],
    ]),
    phantimalFactions: new Map([['Gervan', 'Lightbearer']]),
  };
  it('refuses a phantimal the team’s heroes do not support', () => {
    const gervan = team([hero('A', 38), hero('B', 39), hero('C', 40)], 'Crown', { name: 'Gervan', tile: 41, partnerTile: null });
    expect(roundDeploymentProblem([gervan, null, null, null, null], factions)).toBe('Team 1: Gervan needs 3 Lightbearer heroes; this team has 2');
  });
  it('accepts it once three heroes share its faction', () => {
    const two = team([hero('A', 38), hero('B', 39), hero('C', 40)], 'Crown', { name: 'Gervan', tile: 41, partnerTile: null });
    expect(roundDeploymentProblem([two, null, null, null, null], factions)).toBe('Team 1: Gervan needs 3 Lightbearer heroes; this team has 2');
    const third = { ...factions, heroFactions: new Map([...factions.heroFactions, ['D', 'Lightbearer']]) };
    const ok = team([hero('A', 38), hero('B', 39), hero('D', 40)], 'Crown', { name: 'Gervan', tile: 41, partnerTile: null });
    expect(roundDeploymentProblem([ok, null, null, null, null], third)).toBeNull();
  });
  it('does not check when the factions are not given', () => {
    const gervan = team([hero('A', 38)], 'Crown', { name: 'Gervan', tile: 41, partnerTile: null });
    expect(roundDeploymentProblem([gervan, null, null, null, null])).toBeNull();
  });
});

describe('matching a picture with the Round Deployment', () => {
  it('has nothing to say for a team nobody confirmed', () => {
    expect(matchTeam(null, read(['A']), 'A')).toEqual({ state: 'none' });
    expect(matchTeam(team([]), read(['A']), 'A')).toEqual({ state: 'none' });
  });

  it('fills tiles, ranks, equipment and artifact from the Deployment when the picture names the same heroes', () => {
    const match = matchTeam(deployed, read(['C', 'A', 'B']), 'A');
    expect(match).toEqual({ state: 'fits', team: deployed });
  });

  it('does not flag a reading the player already corrected into the team, but still flags another one', () => {
    const misread = read(['A', 'B', 'Z']);
    expect(matchTeam(deployed, misread, 'A').state).toBe('changed');
    const learnt = withSeenAs(deployed, [misread]);
    expect(matchTeam(learnt, misread, 'A')).toEqual({ state: 'fits', team: learnt });
    expect(matchTeam(learnt, read(['A', 'B', 'Y']), 'A').state).toBe('changed');
    // the same reading is kept once, whatever the order of the heroes
    expect(withSeenAs(learnt, [read(['Z', 'B', 'A'])]).seenAs).toHaveLength(1);
    expect(sameReading(read(['A'], { artifact: 'Crown' }), read(['A']))).toBe(false);
  });

  it('turns the map over for a Player who stood on Side B', () => {
    const match = matchTeam(deployed, read(['A', 'B', 'C']), 'B');
    expect(match.state).toBe('fits');
    if (match.state === 'fits') expect(match.team.heroes.map((h) => h.tile)).toEqual([TILE_COUNT - 1 - 38, TILE_COUNT - 1 - 39, TILE_COUNT - 1 - 40]);
  });

  it('fills a hero the picture could not name from the Deployment', () => {
    const match = matchTeam(deployed, read(['A', 'B'], { unread: 1 }), 'A');
    expect(match).toEqual({ state: 'fits', team: deployed });
  });

  it('takes a sure rank or equipment level the Deployment lacks, and flags one that differs', () => {
    const open = team([hero('A', 38, null, null), hero('B', 39)]);
    const fill = matchTeam(open, { ...read(['A', 'B']), heroes: [{ hero: 'A', rank: 'Mythic', equipmentLevel: 5 }, { hero: 'B', rank: 'Mythic', equipmentLevel: 10 }] }, 'A');
    expect(fill).toMatchObject({ state: 'fits' });
    if (fill.state === 'fits') expect(fill.team.heroes[0]).toMatchObject({ rank: 'Mythic', equipmentLevel: 5 });

    const differs = matchTeam(deployed, { ...read(['A', 'B', 'C']), heroes: [{ hero: 'A', rank: 'Legendary', equipmentLevel: 10 }, { hero: 'B', rank: null, equipmentLevel: 15 }, { hero: 'C', rank: null, equipmentLevel: null }] }, 'A');
    expect(differs).toMatchObject({ state: 'changed' });
    if (differs.state === 'changed') {
      expect(differs.changes).toEqual([
        { kind: 'rank', hero: 'A', from: 'Mythic', to: 'Legendary' },
        { kind: 'equipment', hero: 'B', from: 10, to: 15 },
      ]);
      expect(differs.deployment).toEqual(deployed);
    }
  });

  it('flags a named hero that is not deployed, never replacing it silently', () => {
    const match = matchTeam(deployed, read(['A', 'B', 'X']), 'A');
    expect(match.state).toBe('changed');
    if (match.state === 'changed') {
      expect(match.changes).toEqual([{ kind: 'hero', gone: ['C'], added: ['X'] }]);
      expect(match.team.heroes.map((h) => h.hero)).toEqual(['A', 'B']);
      expect(match.unplaced.map((h) => h.hero)).toEqual(['X']);
      expect(match.deployment.heroes.map((h) => h.hero)).toEqual(['A', 'B', 'C']);
    }
  });

  it('flags a missing hero that no unread tile explains', () => {
    expect(matchTeam(deployed, read(['A', 'B']), 'A').state).toBe('changed');
  });

  it('flags another artifact and another phantimal, and ignores a picture without them', () => {
    const withPhantimal = team(deployed.heroes, 'Crown', { name: 'Orson', tile: 41 });
    const quiet = matchTeam(withPhantimal, read(['A', 'B', 'C']), 'A');
    expect(quiet.state).toBe('fits');
    const other = matchTeam(withPhantimal, read(['A', 'B', 'C'], { artifact: 'Scepter', phantimal: 'Wedge of Power' }), 'A');
    expect(other).toMatchObject({ state: 'changed', changes: [{ kind: 'artifact', from: 'Crown', to: 'Scepter' }, { kind: 'phantimal', from: 'Orson', to: 'Wedge of Power' }] });
  });

  it('counts a pair phantimal read under either part as the same', () => {
    const pair = team(deployed.heroes, 'Crown', { name: 'Wedge of Matter', tile: 41, partnerTile: 42 });
    expect(matchTeam(pair, read(['A', 'B', 'C'], { phantimal: 'Wedge of Power' }), 'A').state).toBe('fits');
  });
});

describe('the rules of a Round Deployment', () => {
  const five = (teams: (RoundTeam | null)[]) => [...teams, ...Array(5 - teams.length).fill(null)];

  it('accepts a legal Deployment', () => {
    expect(roundDeploymentProblem(five([deployed, team([hero('D', 38)], 'Scepter')]))).toBeNull();
  });

  it('refuses a hero or an artifact on two teams, a shared tile, a tile off the map and a wrong number of teams', () => {
    expect(roundDeploymentProblem(five([deployed, team([hero('A', 38)])]))).toMatch(/A is on teams 1 and 2/);
    expect(roundDeploymentProblem(five([deployed, team([hero('D', 38)])]))).toMatch(/Crown is on teams 1 and 2/);
    expect(roundDeploymentProblem(five([team([hero('A', 38), hero('B', 38)])]))).toMatch(/one tile/);
    expect(roundDeploymentProblem(five([team([hero('A', TILE_COUNT)])]))).toMatch(/off the map/);
    expect(roundDeploymentProblem([deployed])).toMatch(/5 teams/);
  });

  it('turning a team twice gives it back', () => {
    expect(turnTeam(turnTeam(deployed))).toEqual(deployed);
  });
});

describe('tiles that are not known yet', () => {
  const unplaced = team([hero('A', null as unknown as number), hero('B', null as unknown as number)]);
  const noTiles = (heroes: RoundHero[]) => heroes.map((h) => ({ ...h, tile: null }));

  it('are allowed in a Deployment, and turning the map leaves them unknown', () => {
    const open = team(noTiles([hero('A', 0), hero('B', 0)]), 'Crown', { name: 'Orson', tile: null });
    expect(roundDeploymentProblem([open, null, null, null, null])).toBeNull();
    expect(turnTeam(open).heroes.map((h) => h.tile)).toEqual([null, null]);
    expect(turnTeam(open).phantimal?.tile).toBeNull();
  });

  it('still refuse a tile off the map or shared by two units', () => {
    expect(roundDeploymentProblem([team([{ ...hero('A', 0), tile: null }, hero('B', TILE_COUNT)]), null, null, null, null])).toMatch(/off the map/);
    expect(roundDeploymentProblem([team([{ ...hero('A', 0), tile: 40 }, hero('B', 40)]), null, null, null, null])).toMatch(/one tile/);
  });

  it('give each of a hero\'s identical summons a tile of its own', () => {
    const unit = (tile: number | null, part: string): RoundHero => ({ tile, hero: 'Zanie', part, rank: null, equipmentLevel: null });
    const open = team([{ ...hero('Zanie', 0), tile: null }, unit(null, 'Laser Turret'), unit(null, 'Laser Turret')]);
    const saved = team([hero('Zanie', 38), unit(40, 'Laser Turret'), unit(41, 'Laser Turret')]);
    expect(withPlacement(open, saved)!.heroes.map((h) => h.tile)).toEqual([38, 40, 41]);
  });

  it('come from the first saved Battle with the same heroes, and are never replaced', () => {
    const open = team(noTiles([hero('A', 0), hero('B', 0), hero('C', 0)]), 'Crown', { name: 'Wedge of Matter', tile: null });
    const saved = team([hero('C', 40), hero('A', 38), hero('B', 39)], 'Crown', { name: 'Wedge of Power', tile: 41, partnerTile: 42 });
    const filled = withPlacement(open, saved)!;
    expect(filled.heroes.map((h) => [h.hero, h.tile])).toEqual([['A', 38], ['B', 39], ['C', 40]]);
    expect(filled.phantimal).toEqual({ name: 'Wedge of Matter', tile: 41, partnerTile: 42 });
    const moved = team([hero('A', 10), hero('B', 11), hero('C', 12)], 'Crown');
    expect(withPlacement(filled, moved)!.heroes.map((h) => h.tile)).toEqual([38, 39, 40]);
  });

  it('are not taken from a Battle with other heroes', () => {
    expect(withPlacement(unplaced, team([hero('A', 38), hero('X', 39)]))).toBeNull();
  });

  it('record the Map whose Battle filled the tiles (ADR 0021)', () => {
    const filled = withPlacement(unplaced, team([hero('A', 38), hero('B', 39)]), 'Duel')!;
    expect(filled.mapName).toBe('Duel');
    expect(withPlacement(unplaced, team([hero('A', 38), hero('B', 39)]))!.mapName).toBeUndefined();
  });
});
