// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import type { RoundTeam } from '../../../src/domain/round-deployment.js';
import { turnTeam } from '../../../src/domain/round-deployment.js';
import type { FightDraftSide } from '../../../web/backend.js';
import { emptyFormation, withHeroState } from '../../../web/FormationEditor.js';
import { emptyOpponent } from '../../../web/arena/OpponentEditor.js';
import { RoundDeploymentBar } from '../../../web/arena/RoundDeploymentBar.js';
import { applyToOpponent, applyToOwn, applyTeamChange, deploymentsFromRecords, guessOf, mergeDeployments, opponentFromTeam, ownFromTeam, readSideOf, readSideOfTeam, teamOfOpponent, teamOfOwn, withoutGuess } from '../../../web/arena/round-deployment.js';
import type { ArenaFight, Profile } from '../../../web/backend.js';
import { matchTeam } from '../../../src/domain/round-deployment.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string, tile: number | null, rank: string | null = 'Mythic+', equipmentLevel: number | null = 10) => ({ tile, hero: name, part: '', rank, equipmentLevel });
const team = (heroes: ReturnType<typeof hero>[], artifact: string | null = 'Crown'): RoundTeam => ({ heroes, phantimal: null, artifact });
afterEach(cleanup);

describe('the form and the Round Deployment', () => {
  it('turns Side A of the form into a team and back, with its ranks, equipment and artifact', () => {
    let formation = { ...emptyFormation(), placed: [{ tile: 38, hero: 'Evie' }, { tile: 39, hero: 'Fay' }], artifact: 'Crown' };
    formation = withHeroState(withHeroState(formation, 'Evie', 'Mythic+', '10'), 'Fay', 'Elite', '');
    const made = teamOfOwn(formation)!;
    expect(made.heroes).toEqual([hero('Evie', 38), hero('Fay', 39, 'Elite', null)]);
    expect(made.artifact).toBe('Crown');
    expect(teamOfOwn(emptyFormation())).toBeNull();
    const back = ownFromTeam(made, cells);
    expect(back.placed).toEqual(formation.placed);
    expect(back.snapshots['Evie']).toEqual({ rank: 'Mythic+', equipmentLevel: 10 });
    expect(back.artifact).toBe('Crown');
  });

  it('turns Side B of the form into a team and back', () => {
    const opponent = { ...emptyOpponent(), placed: [{ tile: 0, hero: 'Zed', rank: 'Mythic+', equipment: '10' }], artifact: 'Scepter' };
    const made = teamOfOpponent(opponent)!;
    expect(made.heroes).toEqual([hero('Zed', 0)]);
    expect(opponentFromTeam(made, cells).placed).toEqual(opponent.placed);
  });

  it('puts a team with unknown tiles on free tiles, and a team with tiles on its tiles only when they fit the map', () => {
    const open = team([hero('Evie', null), hero('Fay', null)]);
    expect(ownFromTeam(open, cells).placed.map((p) => p.tile)).toEqual([38, 39]);
    expect(ownFromTeam(team([hero('Evie', 40)]), cells).placed.map((p) => p.tile)).toEqual([40]);
    expect(ownFromTeam(team([hero('Evie', 10)]), cells).placed.map((p) => p.tile)).not.toContain(10); // not on the player's zone
  });

  it('keeps the tiles the form has, and takes only the states, from a team with unknown tiles', () => {
    const current = { ...emptyFormation(), placed: [{ tile: 42, hero: 'Evie' }], artifact: '' };
    const next = applyToOwn(current, team([hero('Evie', null, 'Mythic+', 15)], 'Crown'), cells);
    expect(next.placed).toEqual([{ tile: 42, hero: 'Evie' }]);
    expect(next.snapshots['Evie']).toEqual({ rank: 'Mythic+', equipmentLevel: 15 });
    expect(next.artifact).toBe('Crown');
    const opponent = { ...emptyOpponent(), placed: [{ tile: 3, hero: 'Zed', rank: '', equipment: '' }] };
    expect(applyToOpponent(opponent, team([hero('Zed', null, 'Elite', 0)]), cells).placed).toEqual([{ tile: 3, hero: 'Zed', rank: 'Elite', equipment: '0' }]);
  });

  it('reads a picture side for matching: each hero once, the tiles nobody named counted', () => {
    const side = { name: 'x', profile: null, heroes: [{ tile: 'a', hero: 'Evie', rank: 'Elite', equipmentLevel: null }, { tile: 'b', hero: 'Evie', rank: 'Elite', equipmentLevel: null }], artifact: { name: 'Crown', level: 3 }, phantimal: null, crops: null, unread: ['c'] } as FightDraftSide;
    expect(readSideOf(side)).toEqual({ heroes: [{ hero: 'Evie', rank: 'Elite', equipmentLevel: null }], artifact: 'Crown', phantimal: null, unread: 1 });
  });
});

describe('the Round Deployment panel', () => {
  const entry = { profileId: 1, name: 'Luna', playerId: '2222', teams: [team([hero('Evie', 38), hero('Fay', 39)]), null, null, null, null] };
  const show = (over: Partial<Parameters<typeof RoundDeploymentBar>[0]> = {}) => {
    const props = {
      tournament: 'Season 8, Tournament 2',
      round: 'Group stage' as const,
      sides: { A: { profileId: 1, name: 'Luna', teams: [team([hero('Evie', 38), hero('Fay', 39)]), null, null, null, null] }, B: { profileId: null, name: null, teams: [null, null, null, null, null] } },
      entries: [entry],
      busy: false,
      onConfirm: vi.fn(),
      onUse: vi.fn(),
      ...over,
    };
    render(<RoundDeploymentBar {...props} />);
    return props;
  };

  it('says a team matches through its box, asks for a profile for a side with none, and confirms a side', async () => {
    const props = show();
    const sideA = screen.getByRole('group', { name: 'Round Deployment of Side A' });
    // the five boxes are the summary: a matching team is only its box, with no words below
    expect(within(sideA).getByRole('button', { name: 'Team 1 of Side A: matches the Round Deployment' })).toBeTruthy();
    expect(sideA.textContent).not.toMatch(/matches the Round Deployment/);
    expect(screen.getByText(/Side B has no profile/)).toBeTruthy();
    await userEvent.setup().click(within(sideA).getByRole('button', { name: /Confirm Side A as the Round Deployment of Luna/ }));
    expect(props.onConfirm).toHaveBeenCalledWith('A');
  });

  it('flags a team that differs, never replacing it, and offers the Deployment’s team', async () => {
    const differing = team([hero('Evie', 38), hero('Zed', 39, 'Mythic+', 10)]);
    const props = show({ sides: { A: { profileId: 1, name: 'Luna', teams: [differing, null, null, null, null] }, B: { profileId: null, name: null, teams: [null, null, null, null, null] } } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Team 1 of Side A: differs from the Round Deployment' }));
    expect(screen.getByRole('status').textContent).toMatch(/Deployment changed\? Fay replaced by Zed/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use the Deployment’s team 1' }));
    expect(props.onUse).toHaveBeenCalledWith('A', 0, entry.teams[0]);
  });

  it('flags a different rank beside the name, and leaves a team the Profile has no Deployment for to its grey box', async () => {
    const user = userEvent.setup();
    show({ sides: { A: { profileId: 1, name: 'Luna', teams: [team([hero('Evie', 38, 'Elite'), hero('Fay', 39)]), team([hero('Gus', 1)]), null, null, null] }, B: { profileId: null, name: null, teams: [null, null, null, null, null] } } });
    await user.click(screen.getByRole('button', { name: 'Team 1 of Side A: differs from the Round Deployment' }));
    expect(screen.getByRole('status').textContent).toMatch(/Evie rank Mythic\+ to Elite/);
    // an unconfirmed team is only its box: clicking it adds no words
    await user.click(screen.getByRole('button', { name: 'Team 2 of Side A: not confirmed' }));
    expect(screen.queryByText(/Team 2:/)).toBeNull();
  });

  it('turns a Side B team over when it is saved as the Deployment', () => {
    const made = teamOfOpponent({ ...emptyOpponent(), placed: [{ tile: 0, hero: 'Zed', rank: 'Elite', equipment: '' }] })!;
    expect(turnTeam(made).heroes[0]!.tile).toBe(TILE_COUNT - 1);
  });
});

describe('Round Deployments taken from saved Battles', () => {
  const luna = { id: 1, name: 'Luna', playerId: 'P1', isDefault: false, heroCount: 0 } as Profile;
  const fight = (id: number, position: number | null, sideOfLuna: 'A' | 'B', tiles: [number, number], hero = 'Evie') => {
    const heroes = [{ tile: tiles[0], name: hero, part: '', rank: 'Mythic+', equipmentLevel: 10 }, { tile: tiles[1], name: 'Fay', part: '', rank: 'Elite', equipmentLevel: null }];
    const mine = { artifact: 'Crown', heroes, phantimal: null, assist: null, formationId: null };
    const theirs = { artifact: null, heroes: [], phantimal: null, assist: null, formationId: null };
    return { id, battlePosition: position, playerIdA: sideOfLuna === 'A' ? 'p1' : 'P9', playerIdB: sideOfLuna === 'B' ? 'P1' : 'P9', formation: sideOfLuna === 'A' ? mine : theirs, opponent: sideOfLuna === 'B' ? mine : theirs } as unknown as ArenaFight;
  };

  it('keeps the earliest fight of each team of a Player, by Player ID on either side, turning a Side B team back', () => {
    const [entry] = deploymentsFromRecords([fight(10, 1, 'A', [38, 39]), fight(3, 1, 'B', [0, 1]), fight(5, 2, 'A', [40, 41], 'Gus'), fight(30, null, 'A', [1, 2])], [luna]);
    expect(entry).toMatchObject({ profileId: 1, name: 'Luna', recorded: [0, 1] });
    // the earliest fight of team 1 (id 3) put Luna on Side B at tiles 0 and 1: on Side A's map that is 44 and 43
    expect(entry!.teams[0]!.heroes.map((h) => [h.hero, h.tile, h.rank, h.equipmentLevel])).toEqual([['Evie', TILE_COUNT - 1, 'Mythic+', 10], ['Fay', TILE_COUNT - 2, 'Elite', null]]);
    expect(entry!.teams[0]!.artifact).toBe('Crown');
    expect(entry!.teams[1]!.heroes[0]!.hero).toBe('Gus');
    expect(entry!.teams[2]).toBeNull();
  });

  it('has nothing for a Player no Profile has, and a confirmed team wins over a recorded one', () => {
    expect(deploymentsFromRecords([fight(10, 1, 'A', [38, 39])], [{ ...luna, playerId: 'Other' }])).toEqual([]);
    const recorded = deploymentsFromRecords([fight(10, 1, 'A', [38, 39]), fight(11, 2, 'A', [40, 41], 'Gus')], [luna]);
    const confirmed = [{ profileId: 1, name: 'Luna', playerId: 'P1', teams: [{ heroes: [{ tile: null, hero: 'Zed', part: '', rank: null, equipmentLevel: null }], phantimal: null, artifact: null }, null, null, null, null] }];
    const [merged] = mergeDeployments(confirmed, recorded);
    expect(merged!.teams[0]!.heroes[0]!.hero).toBe('Zed');
    expect(merged!.teams[1]!.heroes[0]!.hero).toBe('Gus');
    expect(merged!.recorded).toEqual([1]);
  });

  it('stores no tile the editor only guessed, but keeps one the player moved and drops tiles of another Map', () => {
    const heroes = [hero('A', 38), hero('B', 39)];
    const guess = guessOf('Duel', heroes.map((h) => ({ tile: h.tile!, hero: h.hero })), null);
    const made = { heroes, phantimal: null, artifact: null };
    expect(withoutGuess(made, guess, 'Duel').heroes.map((h) => h.tile)).toEqual([null, null]);
    const moved = { ...made, heroes: [hero('A', 40), hero('B', 39)] };
    expect(withoutGuess(moved, guess, 'Duel').heroes.map((h) => h.tile)).toEqual([40, null]);
    expect(withoutGuess(made, guess, 'Other').heroes.map((h) => h.tile)).toEqual([null, null]);
  });

  it('keeps the tiles a Deployment knows and places the rest, whatever Map it was placed on', () => {
    const made = { heroes: [hero('A', 38), { ...hero('B', 39), tile: null }, { ...hero('C', 40), tile: null }], phantimal: null, artifact: null };
    const current = { ...emptyFormation(), placed: [{ tile: 40, hero: 'A' }, { tile: 41, hero: 'B' }, { tile: 42, hero: 'C' }] };
    expect(applyToOwn(current, made, cells).placed).toEqual([{ tile: 38, hero: 'A' }, { tile: 41, hero: 'B' }, { tile: 42, hero: 'C' }]);
  });

  it('replaces an invalid picture team (the same hero twice) with the Deployment’s team, never saving the duplicate', () => {
    const picture = {
      ...emptyOpponent(),
      placed: [
        { tile: 0, hero: 'Orion', rank: '', equipment: '' },
        { tile: 1, hero: 'Perseus', rank: '', equipment: '' },
        { tile: 3, hero: 'Orion', rank: '', equipment: '' },
        { tile: 4, hero: 'Rowan', rank: '', equipment: '' },
        { tile: 2, hero: 'Vala', rank: '', equipment: '' },
      ],
    };
    const deployed = { heroes: [hero('Orion', 0), hero('Perseus', 1), hero('Evie', 2), hero('Rolan', 3), hero('Taichi & Agumon', 4)], phantimal: null, artifact: null };
    const form = applyToOpponent(picture, deployed, cells);
    expect(form.placed.map((p) => p.hero)).toEqual(['Orion', 'Perseus', 'Evie', 'Rolan', 'Taichi & Agumon']);
  });

  it('replaces one team for a Team change and keeps the team it replaced as a reading', () => {
    const before = [team([hero('Evie', 38)]), team([hero('Fay', 39)]), null, null, null];
    const after = applyTeamChange(before, 0, team([hero('Zed', 38)]));
    expect(after[0]!.heroes[0]!.hero).toBe('Zed');
    expect(after[1]).toBe(before[1]); // the other teams stand as they were
    // the team it replaced is a reading of the new team: the picture that showed it is not flagged again
    expect(matchTeam(after[0], readSideOfTeam(before[0]!), 'A').state).toBe('fits');
  });
});

describe('a hero with two identical summons', () => {
  const laser = (tile: number | null) => ({ tile, hero: 'Zanie', part: 'Laser Turret', rank: null, equipmentLevel: null });

  it('keeps each laser on its own tile when the Deployment knows only some tiles (Side A)', () => {
    // Zanie's own tile is unknown, so the team is partly known and goes through the tiles the form already has
    const partly = team([hero('Zanie', null), laser(40), laser(41)]);
    const current = { ...emptyFormation(), placed: [{ tile: 38, hero: 'Zanie' }, { tile: 42, hero: 'Zanie', part: 'Laser Turret' }, { tile: 43, hero: 'Zanie', part: 'Laser Turret' }] };
    const next = applyToOwn(current, partly, cells);
    const lasers = next.placed.filter((p) => p.part === 'Laser Turret').map((p) => p.tile);
    expect(lasers.sort()).toEqual([40, 41]);
  });

  it('keeps each laser on its own tile when the Deployment knows only some tiles (Side B)', () => {
    const partly = team([hero('Zanie', null), laser(1), laser(2)]);
    const current = { ...emptyOpponent(), placed: [{ tile: 0, hero: 'Zanie', rank: '', equipment: '' }, { tile: 3, hero: 'Zanie', part: 'Laser Turret', rank: '', equipment: '' }, { tile: 4, hero: 'Zanie', part: 'Laser Turret', rank: '', equipment: '' }] };
    const next = applyToOpponent(current, partly, cells);
    const lasers = next.placed.filter((p) => p.part === 'Laser Turret').map((p) => p.tile);
    expect(lasers.sort()).toEqual([1, 2]);
  });
});
