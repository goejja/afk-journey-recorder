// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import type { BattleDraft, BattleImportPicture } from '../../../web/backend.js';
import { ArenaPage } from '../../../web/arena/ArenaPage.js';
import { feedbackOf, fightCoverage, groupPictures, keptOwn, knownPlacementOpponent, knownPlacementOwn, misfitsMap, placeOpponent, placeOwn, reusedSide, savedPlacements, unplacedUnit } from '../../../web/reader/battle-import.js';
import { draftSide } from '../../support/draft-side.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const heroes = (...names: string[]) => names.map((hero, i) => ({ tile: `${hero}-${i}`, hero, rank: null as string | null, equipmentLevel: null as number | null }));

const draft = (over: Partial<BattleDraft> = {}): BattleDraft => ({
  mode: 'Guild Duel',
  number: 1,
  outcome: 'Win',
  unionLevelA: 57,
  unionLevelB: 37,
  sideA: draftSide({ name: 'Luna', profile: { id: 2, name: 'Luna', playerId: '2222' }, heroes: heroes('Evie', 'Fay').map((h) => ({ ...h, rank: 'Mythic+', equipmentLevel: 10 })) }),
  sideB: draftSide({ name: 'Rover', profile: null, heroes: heroes('Zed') }),
  duplicateOf: null,
  ...over,
});
const picture = (id: number, over: Partial<BattleDraft> = {}): BattleImportPicture => ({ id, label: `IMG_${id}.jpeg`, state: 'done', draft: draft(over) });

describe('groupPictures', () => {
  it('keeps each picture of a mode with one fight a battle (Treasure Rush) in a battle of its own', () => {
    expect(groupPictures([picture(1, { mode: 'Treasure Rush', number: null }), picture(2, { mode: 'Treasure Rush', number: null })])).toHaveLength(2);
  });

  it('puts the pictures of the same two players together, in the order of their fights, and Arena fights apart', () => {
    const groups = groupPictures([picture(1, { number: 2 }), picture(2, { number: 1 }), picture(3, { sideB: draftSide({ name: 'Other', profile: null, heroes: [] }) }), picture(4, { mode: 'Arena', number: null })]);
    expect(groups.map((g) => g.pictures.map((p) => p.id))).toEqual([[2, 1], [3], [4]]);
  });

  it('follows a picture the player moved, and leaves out the ones not read', () => {
    const groups = groupPictures([picture(1), picture(2), { id: 3, label: null, state: 'running' }], { '2': 'picture-2' });
    expect(groups.map((g) => g.pictures.map((p) => p.id))).toEqual([[1], [2]]);
  });
});

describe('fightCoverage', () => {
  it('lists the fights nobody has, the ones two pictures have, and the pictures with no number', () => {
    const group = (...numbers: (number | null)[]) => groupPictures(numbers.map((n, i) => picture(i + 1, { mode: 'Super League', number: n })), Object.fromEntries(numbers.map((_, i) => [i + 1, 'one'])))[0]!;
    expect(fightCoverage(group(1, 2, 3, 4, 5))).toEqual({ expected: 5, missing: [], duplicated: [], unnumbered: 0 });
    expect(fightCoverage(group(1, 3, 5))).toEqual({ expected: 5, missing: [2, 4], duplicated: [], unnumbered: 0 });
    expect(fightCoverage(group(1, 2, 2, null))).toMatchObject({ missing: [3, 4, 5], duplicated: [2], unnumbered: 1 });
  });
});

describe('placing the heroes of a report', () => {
  it('puts each side on the first free tiles of its own zone, in the order of the picture, with the states it was sure of', () => {
    const own = placeOwn(cells, heroes('Evie', 'Fay').map((h) => ({ ...h, rank: 'Mythic+', equipmentLevel: 10 })));
    expect(own.placed.map((p) => [p.hero, p.tile])).toEqual([['Evie', 38], ['Fay', 39]]);
    expect(own.snapshots['Evie']).toEqual({ rank: 'Mythic+', equipmentLevel: 10 });
    const other = placeOpponent(cells, heroes('Zed', 'Fay'));
    expect(other.placed.map((p) => [p.hero, p.tile, p.rank])).toEqual([['Zed', 0, ''], ['Fay', 1, '']]);
  });

  it('places a hero listed twice once on either side: in PvP a hero stands on one tile', () => {
    const own = placeOwn(cells, heroes('Evie', 'Evie', 'Fay'));
    expect(own.placed.map((p) => [p.hero, p.tile])).toEqual([['Evie', 38], ['Fay', 39]]);
    const other = placeOpponent(cells, heroes('Zed', 'Zed', 'Fay'));
    expect(other.placed.map((p) => [p.hero, p.tile])).toEqual([['Zed', 0], ['Fay', 1]]);
  });

  it('puts the artifact, without its level, and the phantimal after the heroes, a phantimal pair on two tiles', () => {
    const own = placeOwn(cells, heroes('Evie'), { artifact: { name: 'Arc Burst', level: 24 }, phantimal: 'Orson' });
    expect([own.artifact, own.phantimal]).toEqual(['Arc Burst', { tile: 39, name: 'Orson' }]);
    const wedge = placeOpponent(cells, heroes('Zed'), { artifact: { name: 'Awakening', level: null }, phantimal: 'Wedge of Matter' });
    expect([wedge.artifact, wedge.phantimal]).toEqual(['Awakening', { tile: 1, name: 'Wedge of Matter', partnerTile: 2 }]);
    expect(placeOwn(cells, heroes('Evie')).phantimal).toBeNull();
    expect(placeOwn(cells, heroes('Evie'), { artifact: { name: null, level: 24 }, phantimal: null }).artifact).toBe('');
  });

  it('places both parts of a pair hero on their own tiles', () => {
    const own = placeOwn(cells, heroes('Elijah & Lailah'));
    expect(own.placed.map((p) => [p.hero, p.part, p.tile])).toEqual([['Elijah & Lailah', 'Elijah', 38], ['Elijah & Lailah', 'Lailah', 39]]);
  });
});

describe('Battle import in the Arena page', () => {
  let requests: { method: string; url: string }[];
  let queue: unknown[];

  beforeEach(() => {
    requests = [];
    queue = [picture(1, { number: 1 }), picture(2, { number: 2, outcome: 'Loss', duplicateOf: { id: 7, createdAt: '2026-11-01' } })];
    vi.stubGlobal('window', Object.assign(window, { confirm: () => true }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        requests.push({ method, url });
        if (url === '/api/maps') return Response.json([{ name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
        if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Fay'), hero('Zed')]);
        if (url === '/api/profiles' && method === 'POST') return Response.json({ id: 9, name: 'Rover', playerId: null, isDefault: false, heroCount: 0 });
        if (url === '/api/profiles') return Response.json([{ id: 1, name: 'Me', playerId: '1111', isDefault: true, heroCount: 3 }, { id: 2, name: 'Luna', playerId: '2222', isDefault: false, heroCount: 2 }]);
        if (url === '/api/artifacts' || url === '/api/phantimals') return Response.json([]);
        if (url === '/api/defaults') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Guild Duel': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
        if (url === '/api/boss-rules') return Response.json([]);
        if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
        if (url.startsWith('/api/pvp/battles') && method === 'GET') return Response.json([]);
        if (url === '/api/roster-import?kind=report') return Response.json({ canRead: true, reason: null, busy: false, queue });
        if (url.startsWith('/api/roster-import?ids=') && method === 'DELETE') return new Response(null, { status: 204 });
        return Response.json({}, { status: 404 });
      }),
    );
  });
  afterEach(cleanup);

  it('shows the pictures grouped as one battle, with a warning for one that looks saved already', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    const battle = await screen.findByRole('group', { name: 'Battle 1' });
    expect(within(battle).getByText(/Luna against Rover · Guild Duel/)).toBeTruthy();
    expect(within(battle).getByText('looks like fight 7 already saved')).toBeTruthy();
    // Guild Duel has three fights: the two pictures are numbered 1 and 2
    expect(within(battle).getByRole('status').textContent).toBe('2 of 3 pictures · no picture for fight 3');
    expect(within(battle).getByText(/Side A lost/)).toBeTruthy();
  });

  it('proposes creating the profile of a side that has none, before the battle is opened', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    const battle = await screen.findByRole('group', { name: 'Battle 1' });
    expect(within(battle).queryByText(/Side A “Luna” has no profile/)).toBeNull(); // matched by name already
    expect(within(battle).getByText(/Side B “Rover” has no profile/)).toBeTruthy();
    await user.click(within(battle).getByRole('button', { name: 'Create profile “Rover”' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/profiles')).toBe(true));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Battle 1' })).queryByText(/has no profile/)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Open in the form' }));
    await waitFor(() => expect((screen.getByLabelText('Profile of Side B') as HTMLSelectElement).value).toBe('9'));
  });

  it('opens a battle in the form with the heroes placed and the profiles of both sides shown, and can make a new profile', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    await user.click(await screen.findByRole('button', { name: 'Open in the form' }));
    // the pictures stay in the queue until the form saves
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(within(await screen.findByRole('list', { name: 'Placed on Side A' })).getByText('Evie')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Positions are guesses' })).toBeNull();
    // the profile matched by name is on Side A already, and the player can give Side B one or make a new one
    const sideA = screen.getByLabelText('Profile of Side A') as HTMLSelectElement;
    const sideB = screen.getByLabelText('Profile of Side B') as HTMLSelectElement;
    expect(sideA.value).toBe('2');
    expect(sideB.value).toBe('');
    await user.selectOptions(sideB, '1');
    expect(sideB.value).toBe('1');
    await user.selectOptions(sideB, 'new');
    const naming = await screen.findByRole('dialog', { name: 'Name of the new profile for Side B' });
    expect((within(naming).getByLabelText('Name') as HTMLInputElement).value).toBe('Rover');
    await user.click(within(naming).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/profiles')).toBe(true));
    await waitFor(() => expect((screen.getByLabelText('Profile of Side B') as HTMLSelectElement).value).toBe('9'));
  });

  it('keeps the fight numbers and Battles the player chose with the pictures, even when their ids change', async () => {
    try {
      localStorage.clear();
    } catch {
      // nothing stored
    }
    queue = [{ ...picture(1, { number: 1 }), key: 'aaa' }, { ...picture(2, { number: 2 }), key: 'bbb' }];
    const user = userEvent.setup();
    const first = render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    await user.selectOptions(await screen.findByLabelText('Fight number of IMG_1.jpeg'), '3');
    expect((screen.getByLabelText('Fight number of IMG_1.jpeg') as HTMLSelectElement).value).toBe('3');
    first.unmount();

    // the server restarted: the same pictures come back with other ids
    queue = [{ ...picture(7, { number: 1 }), key: 'aaa' }, { ...picture(8, { number: 2 }), key: 'bbb' }];
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: /Import from pictures/ }));
    await waitFor(() => expect((screen.getByLabelText('Fight number of IMG_7.jpeg') as HTMLSelectElement).value).toBe('3'));
    expect((screen.getByLabelText('Fight number of IMG_8.jpeg') as HTMLSelectElement).value).toBe('2');

    // pictures that left the queue take their edits with them
    queue = [];
    cleanup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: /Import from pictures/ }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('battle-import-edits') ?? '{}').numbers).toEqual({}));
  });

  it('offers to read a failed picture again', async () => {
    queue = [{ id: 3, label: 'IMG_3.jpeg', state: 'failed', error: 'The agent did not reply' }];
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    await user.click(await screen.findByRole('button', { name: 'Read again' }));
    expect(requests.some((r) => r.method === 'POST' && r.url === '/api/roster-import/3/retry')).toBe(true);
  });

  it('goes back to the import with its pictures when the form is left without saving', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    await user.click(await screen.findByRole('button', { name: 'Open in the form' }));
    await user.click(await screen.findByRole('button', { name: 'Back to the import' }));
    expect(await screen.findByRole('group', { name: 'Battle 1' })).toBeTruthy();
    expect((screen.getByLabelText('The reports are from') as HTMLSelectElement).value).toBe('Guild Duel');
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('asks for the Tournament and Round of Super League pictures, starts on the latest, and warns about an older Tournament or an earlier Round', async () => {
    const stubbed = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    const rounds = ['Group stage', 'Swiss stage', 'Top 48', 'Top 16', 'Semi-Finals', 'Finals'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/tournaments') return Response.json([{ id: 2, season: 8, number: 2, startDate: null, battles: 4, rounds: rounds.slice(0, 2) }, { id: 1, season: 8, number: 1, startDate: null, battles: 9, rounds }]);
        if (url === '/api/seasons') return Response.json([{ number: 8, current: true, stages: 0, phantimals: 0 }]);
        return stubbed(url, init);
      }),
    );
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    expect(screen.queryByLabelText('Tournament')).toBeNull(); // only Super League has Tournaments
    await user.selectOptions(await screen.findByLabelText('The reports are from'), 'Super League');
    const tournament = (await screen.findByLabelText('Tournament')) as HTMLSelectElement;
    await waitFor(() => expect(tournament.value).toBe('2'));
    expect((screen.getByLabelText('Round') as HTMLSelectElement).value).toBe('Swiss stage');
    expect(screen.queryByText(/Check that these pictures|check that these pictures/)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Round'), 'Group stage');
    expect(screen.getByText(/A later Round \(Swiss stage\) already has Battles/)).toBeTruthy();
    await user.selectOptions(tournament, '1');
    expect(screen.getByText(/Season 8, Tournament 2 is the latest Tournament/)).toBeTruthy();
  });
});

describe('placing the units a hero brings', () => {
  it('puts the summons of a hero on tiles of their own, after the heroes and the phantimal', () => {
    const own = placeOwn(cells, heroes('Zanie', 'Phraesto'), { artifact: null, phantimal: 'Orson' });
    expect(own.placed.map((p) => [p.hero, p.part ?? '', p.tile])).toEqual([['Zanie', '', 38], ['Phraesto', '', 39], ['Zanie', 'Laser Turret', 41], ['Zanie', 'Laser Turret', 42], ['Phraesto', 'Phraesto clone', 43]]);
    expect(own.phantimal).toMatchObject({ name: 'Orson', tile: 40 });
    const other = placeOpponent(cells, heroes('Zanie'));
    expect(other.placed.map((p) => [p.hero, p.part ?? '', p.tile])).toEqual([['Zanie', '', 0], ['Zanie', 'Laser Turret', 1], ['Zanie', 'Laser Turret', 2]]);
    expect(unplacedUnit(own.placed, own.phantimal, 'Orson')).toBeNull();
  });

  it('places both parts of a phantimal pair whichever part the report showed', () => {
    for (const shown of ['Wedge of Matter', 'Wedge of Power']) {
      const own = placeOwn(cells, heroes('Evie'), { artifact: null, phantimal: shown });
      expect(own.phantimal).toEqual({ name: 'Wedge of Matter', tile: 39, partnerTile: 40 });
    }
  });

  it('says what could not be placed when the zone is full', () => {
    const crowded = placeOwn(cells, heroes('Zanie', 'Phraesto', 'Evie', 'Fay', 'Nara'), { artifact: null, phantimal: 'Wedge of Matter' });
    expect(unplacedUnit(crowded.placed, crowded.phantimal, 'Wedge of Matter')).not.toBeNull();
  });
});

describe('placing a known player as in a saved fight', () => {
  const fight = (id: number, over: Record<string, unknown> = {}): any => ({
    id, mode: 'Super League', battlePosition: 2, playerIdA: '1111', playerIdB: '2222',
    formation: { heroes: [{ tile: 40, name: 'Fay', rank: 'Mythic', equipmentLevel: 5 }], phantimal: null, assist: null, artifact: null},
    opponent: { heroes: [{ tile: 3, name: 'Zed', rank: 'Mythic', equipmentLevel: 5 }, { tile: 0, name: 'Evie', rank: null, equipmentLevel: null }], phantimal: { name: 'Orson', tile: 4 }, assist: null, artifact: 'Awakening', formationId: 'ABCD1234' },
    ...over,
  });
  const picked = heroes('Evie', 'Zed').map((h) => ({ ...h, rank: h.hero === 'Zed' ? 'Mythic+' : null }));
  const saved = (fights: any[], playerId: string | null = '2222') => reusedSide(savedPlacements(fights, 'Super League', 2, 'B'), picked, { artifact: null, phantimal: 'Orson' }, cells, TILE.ENEMY, null, playerId);

  it('keeps the tiles, the artifact and the phantimal of the saved fight, with the ranks the picture was sure of', () => {
    const other = placeOpponent(cells, picked, { artifact: null, phantimal: 'Orson' }, saved([fight(1)]));
    expect(other.placed.map((p) => [p.hero, p.tile, p.rank])).toEqual([['Zed', 3, 'Mythic+'], ['Evie', 0, '']]);
    expect([other.artifact, other.phantimal, other.formationId]).toEqual(['Awakening', { name: 'Orson', tile: 4 }, '']);
  });

  it('uses the latest fight, and nothing when the team number, the heroes or the phantimal differ', () => {
    expect(saved([fight(1, { opponent: { ...fight(1).opponent, artifact: 'Old' } }), fight(2)])!.artifact).toBe('Awakening');
    expect(saved([fight(1, { playerIdB: '9999' })])).not.toBeNull(); // another Player's placement is the fallback (tier any)
    expect(saved([fight(1)], null)).toBeNull(); // with no Player ID nothing is reused
    expect(saved([fight(1, { battlePosition: 3 })])).toBeNull();
    expect(saved([fight(1, { opponent: { ...fight(1).opponent, heroes: [{ tile: 3, name: 'Zed', rank: null, equipmentLevel: null }] } })])).toBeNull();
    expect(reusedSide(savedPlacements([fight(1)], 'Super League', 2, 'B'), picked, { artifact: null, phantimal: 'Wedge' }, cells, TILE.ENEMY, null, '2222')).toBeNull();
    expect(reusedSide(savedPlacements([fight(1)], 'Super League', 2, 'B'), picked, { artifact: null, phantimal: null }, cells, TILE.ENEMY, null, null)).toBeNull();
  });

  it('places a player as in a saved fight where they stood on the other side, the board turned upside down', () => {
    const asSideA = fight(1, {
      playerIdA: '2222', playerIdB: '1111',
      formation: { heroes: [{ tile: 41, name: 'Zed', rank: 'Mythic', equipmentLevel: 5 }, { tile: 44, name: 'Evie', rank: null, equipmentLevel: null }], phantimal: { name: 'Orson', tile: 40 }, assist: null, artifact: 'Awakening'},
    });
    const other = placeOpponent(cells, picked, { artifact: null, phantimal: 'Orson' }, saved([asSideA]));
    expect(other.placed.map((p) => [p.hero, p.tile])).toEqual([['Zed', 3], ['Evie', 0]]);
    expect([other.artifact, other.phantimal]).toEqual(['Awakening', { name: 'Orson', tile: 4 }]);

    const asSideB = fight(2, { playerIdA: '3333', playerIdB: '2222' });
    const own = savedPlacements([asSideB], 'Super League', 2, 'A');
    const mine = placeOwn(cells, picked, { artifact: null, phantimal: 'Orson' }, reusedSide(own, picked, { artifact: null, phantimal: 'Orson' }, cells, TILE.PLAYER, null, '2222'));
    expect(mine.placed.map((p) => [p.hero, p.tile])).toEqual([['Zed', 41], ['Evie', 44]]);
  });

  it('prefers the latest fight whichever side the player stood on', () => {
    const older = fight(1);
    const newer = fight(2, { playerIdA: '2222', playerIdB: '1111', formation: { heroes: [{ tile: 41, name: 'Zed', rank: null, equipmentLevel: null }, { tile: 44, name: 'Evie', rank: null, equipmentLevel: null }], phantimal: { name: 'Orson', tile: 40 }, assist: null, artifact: 'Newer'} });
    expect(saved([older, newer])!.artifact).toBe('Newer');
  });

  it('knows a phantimal pair as the same whichever part the picture shows', () => {
    const wedge = savedPlacements([fight(1, { opponent: { ...fight(1).opponent, phantimal: { name: 'Wedge of Matter', tile: 4, partnerTile: 2 } } })], 'Super League', 2, 'B');
    expect(reusedSide(wedge, picked, { artifact: null, phantimal: 'Wedge of Power' }, cells, TILE.ENEMY, null, '2222')).not.toBeNull();
    expect(reusedSide(wedge, picked, { artifact: null, phantimal: 'Orson' }, cells, TILE.ENEMY, null, '2222')).toBeNull();
  });

  it('does not reuse tiles that are not in the zone of the map, nor two units on one tile, nor half a phantimal pair', () => {
    const candidates = (opponent: Record<string, unknown>) => savedPlacements([fight(1, { opponent: { ...fight(1).opponent, ...opponent } })], 'Super League', 2, 'B');
    const extras = { artifact: null, phantimal: 'Orson' };
    expect(misfitsMap(candidates({}), picked, extras, cells, TILE.ENEMY, null, '2222')).toBe(false); // fits
    expect(misfitsMap(candidates({ heroes: [{ tile: 3, name: 'Zed' }, { tile: 3, name: 'Evie' }] }), picked, extras, cells, TILE.ENEMY, null, '2222')).toBe(true);
    expect(misfitsMap(candidates({ heroes: [{ tile: 20, name: 'Zed' }, { tile: 0, name: 'Evie' }] }), picked, extras, cells, TILE.ENEMY, null, '2222')).toBe(true);
    expect(misfitsMap(candidates({ phantimal: { name: 'Wedge of Matter', tile: 4 } }), picked, { artifact: null, phantimal: 'Wedge of Matter' }, cells, TILE.ENEMY, null, '2222')).toBe(true);
    expect(misfitsMap(candidates({ heroes: [{ tile: 3, name: 'Zed' }] }), picked, extras, cells, TILE.ENEMY, null, '2222')).toBe(false); // other heroes: not the same formation, nothing to warn about
  });

  it('does not reuse tiles that are not in the zone of the map', () => {
    expect(saved([fight(1, { opponent: { ...fight(1).opponent, heroes: [{ tile: 20, name: 'Zed' }, { tile: 0, name: 'Evie' }] } })])).toBeNull();
  });
});

describe('feedback of a Battle import', () => {
  const read = { heroes: [{ hero: 'Evie', rank: 'Supreme', equipmentLevel: null as number | null }, { hero: 'Zed', rank: null as string | null, equipmentLevel: null as number | null }], artifact: { name: 'Arc Burst', level: 24 }, phantimal: 'Orson' };

  it('sends what was read and, beside it, what the form holds once the player moved and changed things, with the crops', () => {
    const formation = placeOwn(cells, heroes('Evie', 'Fay').map((h) => ({ ...h, rank: 'Paragon 1', equipmentLevel: 10 })), { artifact: { name: 'Awakening', level: 20 }, phantimal: 'Orson' });
    const opponent = placeOpponent(cells, heroes('Zed'));
    const crops = { artifact: 'data:image/png;base64,AAAA', phantimal: null };
    const sides = feedbackOf([{ formation, opponent, imported: { A: { read, crops }, B: { read: { ...read, phantimal: null }, crops } } }, { formation, opponent }]);
    expect(sides).toHaveLength(2); // the team that was not read from a picture has none
    expect(sides[0]).toEqual({
      read,
      final: { heroes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 10 }, { hero: 'Fay', rank: 'Paragon 1', equipmentLevel: 10 }], artifact: { name: 'Awakening', level: null }, phantimal: 'Orson' },
      crops,
      skipRank: [],
    });
    expect(sides[1]!.final).toEqual({ heroes: [{ hero: 'Zed', rank: null, equipmentLevel: null }], artifact: null, phantimal: null });
  });

  it('counts a phantimal pair as read whichever part the picture showed', () => {
    const formation = placeOwn(cells, [], { artifact: null, phantimal: 'Wedge of Matter' });
    expect(keptOwn(formation, { ...read, phantimal: 'Wedge of Power' }).phantimal).toBe('Wedge of Power');
  });
});

describe('offering the placement of a saved fight once the heroes are fixed', () => {
  const fight = (id: number, over: Record<string, unknown> = {}): any => ({
    id, mode: 'Super League', battlePosition: 2, playerIdA: '1111', playerIdB: '2222',
    formation: { heroes: [{ tile: 40, name: 'Fay', rank: 'Mythic', equipmentLevel: 5 }], phantimal: null, assist: null, artifact: null},
    opponent: { heroes: [{ tile: 3, name: 'Zed', rank: 'Mythic', equipmentLevel: 5 }, { tile: 0, name: 'Evie', rank: null, equipmentLevel: null }], phantimal: { name: 'Orson', tile: 4 }, assist: null, artifact: 'Awakening', formationId: 'ABCD1234' },
    ...over,
  });

  it('gives the tiles, artifact and phantimal of the saved side, keeping the ranks of the form, and no level', () => {
    const current = placeOpponent(cells, heroes('Zed', 'Evie').map((h) => ({ ...h, rank: h.hero === 'Zed' ? 'Mythic+' : null, equipmentLevel: null })), { artifact: null, phantimal: 'Orson' });
    const next = knownPlacementOpponent([fight(1)], 'Super League', 2, '2222', current, cells)!;
    expect(next.placed.map((p) => [p.hero, p.tile, p.rank])).toEqual([['Zed', 3, 'Mythic+'], ['Evie', 0, '']]);
    expect([next.artifact, next.phantimal]).toEqual(['Awakening', { name: 'Orson', tile: 4 }]);
  });

  it('offers nothing when the heroes already stand there, differ, or the team number is another', () => {
    const current = placeOpponent(cells, heroes('Zed', 'Evie'), { artifact: null, phantimal: 'Orson' });
    const placed = knownPlacementOpponent([fight(1)], 'Super League', 2, '2222', current, cells)!;
    expect(knownPlacementOpponent([fight(1)], 'Super League', 2, '2222', placed, cells)).toBeNull();
    expect(knownPlacementOpponent([fight(1)], 'Super League', 2, '2222', placeOpponent(cells, heroes('Zed', 'Fay')), cells)).toBeNull();
    expect(knownPlacementOpponent([fight(1)], 'Super League', 3, '2222', current, cells)).toBeNull();
  });

  it('finds a side that stood on the other side of the board, turned over, and falls back to other Players', () => {
    const own = { ...fight(1).opponent, heroes: [{ tile: 41, name: 'Zed', rank: null, equipmentLevel: null }, { tile: 44, name: 'Evie', rank: null, equipmentLevel: null }], phantimal: { name: 'Orson', tile: 40 } };
    const asSideA = fight(1, { formation: own, opponent: fight(1).formation, playerIdA: '2222', playerIdB: '1111' });
    const current = placeOpponent(cells, heroes('Zed', 'Evie'), { artifact: null, phantimal: 'Orson' });
    expect(knownPlacementOpponent([asSideA], 'Super League', 2, '2222', current, cells)!.placed.map((p) => [p.hero, p.tile])).toEqual([['Zed', 3], ['Evie', 0]]);
    expect(knownPlacementOpponent([fight(1)], 'Super League', 2, '9999', current, cells)).not.toBeNull();
  });

  it('works for your own side', () => {
    const current = placeOwn(cells, heroes('Fay'));
    const next = knownPlacementOwn([fight(1)], 'Super League', 2, '1111', current, cells)!;
    expect(next.placed.map((p) => [p.hero, p.tile])).toEqual([['Fay', 40]]);
  });
});
