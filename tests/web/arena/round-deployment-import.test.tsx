// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import type { RoundTeam } from '../../../src/domain/round-deployment.js';
import { ArenaPage } from '../../../web/arena/ArenaPage.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const deployedHero = (name: string, tile: number | null) => ({ tile, hero: name, part: '', rank: 'Mythic+', equipmentLevel: 10 });
const picture = {
  id: 1,
  label: 'IMG_1.jpeg',
  state: 'done',
  draft: {
    mode: 'Super League',
    number: 1,
    outcome: 'Win',
    unionLevelA: null,
    unionLevelB: null,
    sideA: { name: 'Luna', profile: { id: 2, name: 'Luna', playerId: '2222' }, heroes: ['Evie', 'Fay'].map((h) => ({ tile: h, hero: h, rank: 'Mythic+', equipmentLevel: 10 })), artifact: null, phantimal: null, crops: null, unread: [] },
    sideB: { name: 'Rover', profile: null, heroes: [{ tile: 'z', hero: 'Zed', rank: null, equipmentLevel: null }], artifact: null, phantimal: null, crops: null, unread: [] },
    duplicateOf: null,
  },
};

describe('a Super League battle imported into a Round', () => {
  let requests: { method: string; url: string; body: any }[];
  let stored: { profileId: number; name: string; playerId: string; teams: (RoundTeam | null)[] }[];

  beforeEach(() => {
    requests = [];
    stored = [{ profileId: 2, name: 'Luna', playerId: '2222', teams: [{ heroes: [deployedHero('Evie', 38), deployedHero('Fay', 39)], phantimal: null, artifact: null }, null, null, null, null] }];
    vi.stubGlobal('window', Object.assign(window, { confirm: () => true }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ method, url, body });
        if (url === '/api/maps') return Response.json([{ name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
        if (url.startsWith('/api/heroes')) return Response.json([hero('Evie'), hero('Fay'), hero('Zed')]);
        if (url === '/api/profiles') return Response.json([{ id: 1, name: 'Me', playerId: '1111', isDefault: true, heroCount: 3 }, { id: 2, name: 'Luna', playerId: '2222', isDefault: false, heroCount: 2 }]);
        if (url === '/api/artifacts' || url === '/api/phantimals') return Response.json([]);
        if (url === '/api/defaults') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Guild Duel': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
        if (url === '/api/boss-rules') return Response.json([]);
        if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
        if (url === '/api/tournaments') return Response.json([{ id: 2, season: 8, number: 2, startDate: null, battles: 0, rounds: [] }]);
        if (url === '/api/seasons') return Response.json([{ number: 8, current: true, stages: 0, phantimals: 0, records: 0, tournaments: 0 }]);
        if (url === '/api/tournaments/2/rounds/Group%20stage/deployments') return Response.json(stored);
        if (url === '/api/tournaments/2/rounds/Group%20stage/deployments' && method === 'PUT') {
          for (const entry of body.entries) {
            const found = stored.find((e) => e.profileId === entry.profileId);
            if (found) found.teams = entry.teams;
            else stored.push({ profileId: entry.profileId, name: 'Me', playerId: '1111', teams: entry.teams });
          }
          return Response.json({ entries: body.entries });
        }
        if (url.startsWith('/api/tournaments/2/rounds/Group%20stage/deployments/') && method === 'PUT') {
          const id = Number(url.split('/').pop());
          const entry = stored.find((e) => e.profileId === id);
          if (entry) entry.teams = body.teams;
          else stored.push({ profileId: id, name: 'Me', playerId: '1111', teams: body.teams });
          return Response.json({ profileId: id, teams: body.teams });
        }
        if (url === '/api/pvp/battle-groups' && method === 'POST') return Response.json({ id: 5, fights: [{ id: 51 }] }, { status: 201 });
        if (url.startsWith('/api/pvp/battles') && method === 'GET') return Response.json([]);
        if (url === '/api/roster-import?kind=report') return Response.json({ canRead: true, reason: null, busy: false, queue: [picture] });
        if (url.startsWith('/api/roster-import?ids=') && method === 'DELETE') return new Response(null, { status: 204 });
        return Response.json({}, { status: 404 });
      }),
    );
  });
  afterEach(cleanup);

  async function openForm() {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    await user.selectOptions(await screen.findByLabelText('The reports are from'), 'Super League');
    await waitFor(() => expect((screen.getByLabelText('Tournament') as HTMLSelectElement).value).toBe('2'));
    await user.click(await screen.findByRole('button', { name: 'Open in the form' }));
    return user;
  }

  it('shows each side against the Round Deployment of its Profile, and fills the side that matches', async () => {
    await openForm();
    const panel = await screen.findByRole('region', { name: 'Round Deployment' });
    expect(panel.textContent).toMatch(/Season 8, Tournament 2, Group stage/);
    const sideA = within(panel).getByRole('group', { name: 'Round Deployment of Side A' });
    // the five boxes say which teams match, with no words below: a matching team is only its box
    expect(within(sideA).getByRole('button', { name: 'Team 1 of Side A: matches the Round Deployment' })).toBeTruthy();
    expect(sideA.textContent).not.toMatch(/matches the Round Deployment/);
    expect(within(panel).getByText(/Side B has no profile/)).toBeTruthy();
    // the Deployment knows the tiles: the heroes stand where it says
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).getByText('Evie')).toBeTruthy();
  });

  it('confirms Side B as the Round Deployment of the Profile given to it', async () => {
    const user = await openForm();
    await screen.findByRole('region', { name: 'Round Deployment' });
    await user.selectOptions(screen.getByLabelText('Profile of Side B'), '1');
    await user.click(await screen.findByRole('button', { name: /Confirm Side B as the Round Deployment of Me/ }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url.endsWith('/deployments/1'))).toBe(true));
    const put = requests.find((r) => r.method === 'PUT' && r.url.endsWith('/deployments/1'))!;
    expect(put.body.teams[0].heroes.map((h: any) => h.hero)).toEqual(['Zed']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers one Confirm per side, and no button that confirms both', async () => {
    const user = await openForm();
    await screen.findByRole('region', { name: 'Round Deployment' });
    await user.selectOptions(screen.getByLabelText('Profile of Side B'), '1');
    expect(await screen.findByRole('button', { name: /Confirm Side B as the Round Deployment of Me/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm both sides' })).toBeNull();
  });

  it('shows beside the buttons why a Deployment was refused', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (init?.method === 'PUT' && url.endsWith('/deployments/1') ? Response.json({ error: 'Zed is on teams 1 and 2: a hero plays on one team only' }, { status: 400 }) : base(url, init))));
    const user = await openForm();
    await screen.findByRole('region', { name: 'Round Deployment' });
    await user.selectOptions(screen.getByLabelText('Profile of Side B'), '1');
    await user.click(await screen.findByRole('button', { name: /Confirm Side B as the Round Deployment of Me/ }));
    expect((await within(screen.getByRole('region', { name: 'Round Deployment' })).findByRole('alert')).textContent).toMatch(/Side B was not saved as the Round Deployment: Zed is on teams 1 and 2/);
  });

  it('drops a Phantimal the Round Deployment carries but the team cannot bring, and still saves (ADR 0029)', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        url === '/api/phantimals' ? Response.json([{ name: 'Wedge of Matter', faction: 'Celestial-Hypogean', class: 'Support', seasons: [8], source: 'import' }]) : base(url, init),
      ),
    );
    // Luna's confirmed team carries a Wedge, but her heroes are Wilders: the Phantimal cannot have stood there
    stored[0]!.teams[0] = {
      heroes: [deployedHero('Evie', 38), deployedHero('Fay', 39)],
      phantimal: { name: 'Wedge of Matter', tile: 40, partnerTile: 41 },
      artifact: null,
    };
    const user = await openForm();
    await screen.findByRole('region', { name: 'Round Deployment' });
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).queryByText('Wedge of Matter')).toBeNull();
    expect(screen.queryByText(/still has to be placed/)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Save battle/ }));
    // one picture of five: the Battle is saved only after the player says so (ADR 0021)
    await user.click(await screen.findByRole('button', { name: 'Save 1' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    const saved = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')!;
    expect(saved.body.fights[0].formation.phantimal).toBeNull();
  });

  it('saves the corrected side as the Round Deployment without the tiles the form only guessed (ADR 0021)', async () => {
    stored[0]!.teams = [{ heroes: [deployedHero('Evie', null), deployedHero('Fay', null)], phantimal: null, artifact: null }, null, null, null, null];
    const user = await openForm();
    await screen.findByRole('region', { name: 'Round Deployment' });
    await user.click(screen.getByRole('button', { name: /Confirm Side A as the Round Deployment of Luna/ }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url.endsWith('/deployments/2'))).toBe(true));
    const confirmed = requests.find((r) => r.method === 'PUT' && r.url.endsWith('/deployments/2'))!;
    // a picture shows no tiles, so the first-free-tile placement is a guess: it is not stored as the Round's placement
    expect(confirmed.body.teams[0].heroes.every((h: any) => h.tile === null)).toBe(true);
    // what the picture said goes with the team, so the same reading is not flagged again
    expect(confirmed.body.teams[0].seenAs[0].heroes.map((h: any) => h.hero)).toEqual(['Evie', 'Fay']);

    await user.click(screen.getByRole('button', { name: /Save battle/ }));
    // one picture of five: the Battle is saved only after the player says so (ADR 0021)
    await user.click(await screen.findByRole('button', { name: 'Save 1' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    const saved = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')!;
    expect(saved.body).toMatchObject({ mode: 'Super League', tournamentId: 2, round: 'Group stage' });
    // the pictures of the saved battle leave the queue, and the import comes back instead of the overview
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url.startsWith('/api/roster-import'))).toBe(true));
    expect(await screen.findByRole('region', { name: 'Import battles from pictures' })).toBeTruthy();
  });
});

describe('the batch table of a Super League Round', () => {
  let requests: { method: string; url: string; body: any }[];
  let deployments: { profileId: number; name: string; playerId: string; teams: (RoundTeam | null)[] }[];
  let savedFights: unknown[];
  let mirrored: boolean;
  let both: boolean;
  /** The pictures read no rank or equipment for one hero, to check the Profile's roster fills them. */
  let unreadRank = false;
  /** A second Arena Map whose player zone starts two tiles later, so a placement guessed on it differs from the one guessed on Duel. */
  let secondMap = false;
  const names = (side: 'A' | 'B', i: number) => [`${side}${i}a`, `${side}${i}b`];
  const everyHero = [1, 2, 3, 4, 5].flatMap((i) => [...names('A', i), ...names('B', i)]);
  const side = (id: number, name: string, playerId: string, heroes: string[], tag: string) => ({
    name,
    profile: { id, name, playerId },
    heroes: heroes.map((h, i) => ({ tile: `${tag}${i}`, hero: h, rank: unreadRank && h === 'A1a' ? null : 'Mythic+', equipmentLevel: unreadRank && h === 'A1a' ? null : 10 })),
    artifact: null,
    phantimal: null,
    crops: null,
    unread: [],
  });
  const picture = (id: number) => {
    const i = ((id - 1) % 5) + 1;
    const luna = side(2, 'Luna', '2222', names('A', i), `a${id}`);
    const rover = side(3, 'Rover', '3333', names('B', i), `b${id}`);
    const flipped = mirrored || id > 5; // pictures 6 to 10 show the same Battle from the other Player
    return { id, label: `IMG_${id}.jpeg`, state: 'done', draft: { mode: 'Super League', number: i, outcome: 'Win', unionLevelA: null, unionLevelB: null, sideA: flipped ? rover : luna, sideB: flipped ? luna : rover, duplicateOf: null } };
  };
  /** A saved fight of the Round: the Player on Side A at tiles 40 and 41 with the A heroes, the one on Side B at tiles 0 and 1 with the B heroes. */
  const savedFight = (i: number, a = '2222', b = '3333', id = i) => ({
    id, mode: 'Super League', createdAt: '2026-11-05 20:00:00', outcome: 'Win', note: null, mapName: 'Duel', rule: null, tags: [], unionLevel: null, opponentUnionLevel: null, battleFormationId: null, battleOpponentFormationId: null, battleId: 1, battlePosition: i, tournamentId: 2, round: 'Group stage', playerIdA: a, playerIdB: b,
    formation: { artifact: null, heroes: names('A', i).map((name, k) => ({ tile: 40 + k, name, part: '', rank: 'Mythic+', equipmentLevel: 10 })), phantimal: null, assist: null, formationId: null },
    opponent: { artifact: null, heroes: names('B', i).map((name, k) => ({ tile: k, name, part: '', rank: 'Mythic+', equipmentLevel: 10 })), assist: null, phantimal: null, formationId: null },
  });
  const team = (i: number, tiles: [number, number], who: 'A' | 'B'): RoundTeam => ({ heroes: names(who, i).map((h, k) => deployedHero(h, tiles[k]!)), phantimal: null, artifact: null });
  // Side B stands on tiles 0 and 1; a Deployment keeps Side A's tiles, so they are turned over: 44 and 43
  const entries = () => [
    { profileId: 2, name: 'Luna', playerId: '2222', teams: [1, 2, 3, 4, 5].map((i) => team(i, [38, 39], 'A')) },
    { profileId: 3, name: 'Rover', playerId: '3333', teams: [1, 2, 3, 4, 5].map((i) => team(i, [TILE_COUNT - 1, TILE_COUNT - 2], 'B')) },
  ];

  beforeEach(() => {
    requests = [];
    deployments = entries();
    savedFights = [];
    mirrored = false;
    unreadRank = false;
    secondMap = false;
    both = false;
    vi.stubGlobal('window', Object.assign(window, { confirm: () => true }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ method, url, body });
        if (url === '/api/maps') return Response.json([{ name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }, ...(secondMap ? [{ name: 'Open', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: cells.map((c, i) => (i === 38 || i === 39 ? TILE.OPEN : c)), source: 'manual', canRestore: false }] : [])]);
        if (url.startsWith('/api/heroes')) return Response.json(everyHero.map(hero));
        if (url === '/api/profiles') return Response.json([{ id: 2, name: 'Luna', playerId: '2222', isDefault: true, heroCount: 10 }, { id: 3, name: 'Rover', playerId: '3333', isDefault: false, heroCount: 10 }]);
        if (url === '/api/artifacts' || url === '/api/phantimals') return Response.json([]);
        if (url === '/api/defaults') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Guild Duel': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
        if (url === '/api/boss-rules') return Response.json([]);
        if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
        if (url === '/api/tournaments') return Response.json([{ id: 2, season: 8, number: 2, startDate: null, battles: 0, rounds: [] }]);
        if (url === '/api/seasons') return Response.json([{ number: 8, current: true, stages: 0, phantimals: 0, records: 0, tournaments: 0 }]);
        if (url === '/api/tournaments/2/rounds/Group%20stage/deployments') return Response.json(deployments);
        if (url === '/api/tournaments/2/rounds/Group%20stage/deployments' && method === 'PUT') {
          for (const entry of body.entries) {
            const found = deployments.find((e: any) => e.profileId === entry.profileId);
            if (found) found.teams = entry.teams;
            else deployments.push({ profileId: entry.profileId, name: 'Me', playerId: '1111', teams: entry.teams });
          }
          return Response.json({ entries: body.entries });
        }
        if (url.startsWith('/api/tournaments/2/rounds/Group%20stage/deployments/') && method === 'PUT') {
          const id = Number(url.split('/').pop());
          deployments = [...deployments.filter((e) => e.profileId !== id), { profileId: id, name: id === 2 ? 'Luna' : 'Rover', playerId: id === 2 ? '2222' : '3333', teams: body.teams }];
          return Response.json({ profileId: id, teams: body.teams });
        }
        if (url === '/api/pvp/battle-groups' && method === 'POST') return Response.json({ id: 5, fights: [51, 52, 53, 54, 55].map((id) => ({ id })) }, { status: 201 });
        if (url === '/api/tournaments/2/rounds/Group%20stage/deployments/2' && method === 'DELETE') {
          deployments = deployments.filter((entry) => entry.profileId !== 2);
          return new Response(null, { status: 204 });
        }
        if (url.startsWith('/api/pvp/battles') && method === 'GET') return Response.json(savedFights);
        if (url === '/api/roster-import?kind=report') return Response.json({ canRead: true, reason: null, busy: false, queue: (both ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5]).map(picture) });
        if (url.startsWith('/api/roster-import?ids=') && method === 'DELETE') return new Response(null, { status: 204 });
        return Response.json({}, { status: 404 });
      }),
    );
  });
  afterEach(cleanup);

  async function openImport() {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Import from pictures' }));
    await user.selectOptions(await screen.findByLabelText('The reports are from'), 'Super League');
    await waitFor(() => expect((screen.getByLabelText('Tournament') as HTMLSelectElement).value).toBe('2'));
    return user;
  }

  it('fills a rank and equipment the picture could not read from the Profile’s roster (ADR 0021)', async () => {
    deployments = [];
    unreadRank = true;
    const user = await openImport();
    await user.click(await screen.findByRole('button', { name: 'Open battle 1 in the form' }));
    await user.click(await screen.findByRole('button', { name: /Save battle/ }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    const saved = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')!;
    expect(saved.body.fights[0].formation.heroes.find((h: any) => h.hero === 'A1a')).toMatchObject({ rank: 'Mythic+', equipmentLevel: 10 });
  });

  it('saves the battles whose sides all fit the Round Deployments, together, with the Round', async () => {
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/1 of 1 battle ready/)).toBeTruthy());
    expect(within(table).getByText('Ready')).toBeTruthy();
    await user.click(within(table).getByRole('button', { name: 'Save 1 ready battle' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    const saved = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')!;
    expect(saved.body).toMatchObject({ mode: 'Super League', tournamentId: 2, round: 'Group stage' });
    expect(saved.body.fights).toHaveLength(5);
    expect(saved.body.fights[0].formation.heroes.map((h: any) => [h.hero, h.tile])).toEqual([['A1a', 38], ['A1b', 39]]);
    expect(saved.body.fights[0].opponent.heroes.map((h: any) => [h.hero, h.tile])).toEqual([['B1a', 0], ['B1b', 1]]);
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/roster-import?ids=1,2,3,4,5')).toBe(true));
    expect(await screen.findByText(/Saved 1 battle in Season 8, Tournament 2, Group stage/)).toBeTruthy();
  });

  it('keeps a battle out of the batch, with the reasons, when a Player has no Round Deployment or a team changed', async () => {
    deployments = [deployments[0]!];
    deployments[0]!.teams[2] = team(3, [38, 39], 'A');
    deployments[0]!.teams[2]!.heroes = [deployedHero('Other', 38), deployedHero('Another', 39)];
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/0 of 1 battle ready/)).toBeTruthy());
    expect(within(table).getByText('Team 1, Side B (Rover): no Round Deployment')).toBeTruthy();
    expect(within(table).getByText('Team 3, Side A (Luna): differs from the Round Deployment')).toBeTruthy();
    expect((within(table).getByRole('button', { name: /Save 0 ready battles/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(table).getByRole('button', { name: 'Open battle 1 in the form' }));
    expect(await screen.findByRole('region', { name: 'Round Deployment' })).toBeTruthy();
  });

  it('uses the Round Deployment when a picture mostly agrees with it, and says so in the table', async () => {
    // team 3 of Luna is Deployed with A3a and Other: the picture names A3a and A3b, one hero apart
    deployments[0]!.teams[2] = { ...team(3, [38, 39], 'A'), heroes: [deployedHero('A3a', 38), deployedHero('Other', 39)] };
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/1 of 1 battle ready/)).toBeTruthy());
    expect(within(table).getByText(/Team 3, Side A \(Luna\): the picture reads differently from the Round Deployment \(Other replaced by A3b\), so the Deployment’s team is used/)).toBeTruthy();
    await user.click(within(table).getByRole('button', { name: 'Save 1 ready battle' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    const saved = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')!;
    expect(saved.body.fights[2].formation.heroes.map((h: any) => h.hero)).toEqual(['A3a', 'Other']);
  });

  it('confirms every team of a side, also those a Player has no saved Battle for, and the batch then has no team without a Deployment', async () => {
    deployments = [deployments[0]!];
    // Rover was recorded in this Round for teams 1, 3 and 4 only
    savedFights = [1, 3, 4].map((i) => savedFight(i, '9999', '3333', 20 + i));
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText('Team 2, Side B (Rover): no Round Deployment')).toBeTruthy());
    expect(within(table).getByText('Team 5, Side B (Rover): no Round Deployment')).toBeTruthy();
    await user.click(within(table).getByRole('button', { name: 'Open battle 1 in the form' }));
    await user.click(await screen.findByRole('button', { name: /Confirm Side B as the Round Deployment of Rover/ }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url.endsWith('/deployments/3'))).toBe(true));
    const put = requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/deployments/3')).at(-1)!;
    expect(put.body.teams.map((t: any) => t !== null)).toEqual([true, true, true, true, true]);
    await user.click(screen.getByRole('button', { name: 'Back to the import' }));
    const back = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(back).queryByText(/Side B \(Rover\): no Round Deployment/)).toBeNull());
  });

  it('accepts a reading the player corrected into the Deployment, and flags the same Player when the reading is another', async () => {
    // Luna's team 3 is Deployed as two other heroes, but the pictures keep reading A3b: the player corrected that when confirming
    deployments[0]!.teams[2] = { ...team(3, [38, 39], 'A'), heroes: [deployedHero('Other', 38), deployedHero('Another', 39)] };
    await openImport();
    let table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText('Team 3, Side A (Luna): differs from the Round Deployment')).toBeTruthy());
    cleanup();
    deployments[0]!.teams[2]!.seenAs = [{ heroes: names('A', 3).map((hero) => ({ hero, rank: 'Mythic+', equipmentLevel: 10 })), artifact: null, phantimal: null, unread: 0 }];
    await openImport();
    table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/1 of 1 battle ready/)).toBeTruthy());
  });

  it('shows every Player of the Round with its five teams, and deletes a Deployment saved under the wrong Profile', async () => {
    const user = await openImport();
    const view = await screen.findByRole('region', { name: 'Round Deployments' });
    // collapsed to one line per Player: the name and five boxes
    expect(within(view).queryByText('A1a, A1b')).toBeNull();
    await user.click(within(view).getByRole('button', { name: /Round Deployments ·/ }));
    await user.click(await within(view).findByRole('button', { name: /^Luna/ }));
    expect(within(view).getByText('A1a, A1b')).toBeTruthy();
    await user.click(await within(view).findByRole('button', { name: /^Rover/ }));
    expect(within(view).getByText('B5a, B5b')).toBeTruthy();
    await user.click(within(view).getByRole('button', { name: 'Delete the Deployment of Luna' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/tournaments/2/rounds/Group%20stage/deployments/2')).toBe(true));
    // the table is worked out again, so the deleted Deployment is gone
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Round Deployments' })).queryByRole('button', { name: 'Delete the Deployment of Luna' })).toBeNull());
  });

  it('confirms a Team change for the one team a picture shows differently', async () => {
    deployments[0]!.teams[2] = { ...team(3, [38, 39], 'A'), heroes: [deployedHero('Other', 38), deployedHero('Another', 39)] };
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText('Team 3, Side A (Luna): differs from the Round Deployment')).toBeTruthy());
    await user.click(within(table).getByRole('button', { name: 'Team 3, Side A (Luna): this team changed' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url === '/api/tournaments/2/rounds/Group%20stage/deployments/2')).toBe(true));
    const put = requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/deployments/2')).at(-1)!;
    expect(put.body.teams[2].heroes.map((h: any) => h.hero)).toEqual(['A3a', 'A3b']);
    // the team it replaced is kept as a reading, so the same picture is not flagged again
    expect(put.body.teams[2].seenAs.flatMap((s: any) => s.heroes.map((h: any) => h.hero))).toContain('Other');
  });

  it('edits one team with the form’s own editor, tiles and Map included, and keeps the other four', async () => {
    const user = await openImport();
    const view = await screen.findByRole('region', { name: 'Round Deployments' });
    await user.click(within(view).getByRole('button', { name: /Round Deployments ·/ }));
    await user.click(await within(view).findByRole('button', { name: /^Luna/ }));
    await user.click(within(view).getByRole('button', { name: 'Edit team 1 of Luna' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save the team' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url === '/api/tournaments/2/rounds/Group%20stage/deployments/2')).toBe(true));
    const put = requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/deployments/2')).at(-1)!;
    expect(put.body.teams[0].mapName).toBe('Duel');
    expect(put.body.teams[0].heroes.map((h: any) => h.tile)).toEqual([38, 39]);
    expect(put.body.teams.slice(1).every((t: any) => t !== null)).toBe(true); // the other four stand as they were
  });

  /** Opens the editor of team 1 of Luna, whose tiles nobody placed, and returns the PUT the saved team makes. */
  async function saveUnplacedTeam(change?: (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => Promise<void>) {
    deployments[0]!.teams[0] = { ...team(1, [38, 39], 'A'), heroes: names('A', 1).map((h) => deployedHero(h, null)) };
    const user = await openImport();
    const view = await screen.findByRole('region', { name: 'Round Deployments' });
    await user.click(within(view).getByRole('button', { name: /Round Deployments ·/ }));
    await user.click(await within(view).findByRole('button', { name: /^Luna/ }));
    await user.click(within(view).getByRole('button', { name: 'Edit team 1 of Luna' }));
    const dialog = await screen.findByRole('dialog');
    await change?.(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Save the team' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url === '/api/tournaments/2/rounds/Group%20stage/deployments/2')).toBe(true));
    return requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/deployments/2')).at(-1)!;
  }

  it('stores no tile and no Map for a team saved untouched, whose tiles the form only guessed', async () => {
    const put = await saveUnplacedTeam();
    expect(put.body.teams[0].heroes.map((h: any) => h.tile)).toEqual([null, null]);
    expect(put.body.teams[0].mapName).toBeUndefined();
    expect(put.body.teams.slice(1).every((t: any) => t !== null)).toBe(true); // the other four stand as they were
  });

  it('stores no tile of a former Map after the Map was changed in the editor', async () => {
    secondMap = true;
    const put = await saveUnplacedTeam(async (user, dialog) => {
      await user.selectOptions(within(dialog).getByLabelText('Map of the team'), 'Open');
    });
    expect(put.body.teams[0].heroes.map((h: any) => h.tile)).toEqual([null, null]);
    expect(put.body.teams[0].mapName).toBeUndefined();
  });

  it('fills the tiles of a confirmed Deployment from the first Battle saved for it, and records the Map', async () => {
    // both Profiles are confirmed, but nobody placed the tiles: the pictures show none
    deployments = entries().map((entry) => ({ ...entry, teams: entry.teams.map((made) => made && { ...made, heroes: made.heroes.map((h) => ({ ...h, tile: null })) }) }));
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/1 of 1 battle ready/)).toBeTruthy());
    await user.click(within(table).getByRole('button', { name: 'Save 1 ready battle' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url === '/api/tournaments/2/rounds/Group%20stage/deployments/2')).toBe(true));
    const put = requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/deployments/2')).at(-1)!;
    expect(put.body.teams[0].heroes.map((h: any) => h.tile)).toEqual([38, 39]);
    expect(put.body.teams[0].mapName).toBe('Duel');
  });

  it('reuses the formations of saved Battles of the Round with no confirmed Deployment, even when a Player now stands on the other side', async () => {
    deployments = [];
    // Luna was recorded on Side A against another Player, Rover on Side B against another: neither has met the other in this Round
    savedFights = [...[1, 2, 3, 4, 5].map((i) => savedFight(i, '2222', '9999')), ...[1, 2, 3, 4, 5].map((i) => savedFight(i, '8888', '3333', 10 + i))];
    mirrored = true; // Rover is now on Side A and Luna on Side B
    const user = await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/1 of 1 battle ready/)).toBeTruthy());
    await user.click(within(table).getByRole('button', { name: 'Save 1 ready battle' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')).toBe(true));
    const saved = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battle-groups')!;
    // Rover stood at 0 and 1 on Side B; on Side A the board is turned over: 44 and 43. Luna stood at 40 and 41 on Side A; on Side B: 4 and 3.
    expect(saved.body.fights[0].formation.heroes.map((h: any) => [h.hero, h.tile])).toEqual([['B1a', 44], ['B1b', 43]]);
    expect(saved.body.fights[0].opponent.heroes.map((h: any) => [h.hero, h.tile])).toEqual([['A1a', 4], ['A1b', 3]]);
  });

  it('ignores the saved Battles of another Round or Tournament', async () => {
    deployments = [];
    savedFights = [1, 2, 3, 4, 5].map((i) => ({ ...savedFight(i), round: 'Swiss stage' }));
    await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/0 of 1 battle ready/)).toBeTruthy());
    expect(within(table).getByText('Team 1, Side A (Luna): no Round Deployment')).toBeTruthy();
  });

  it('keeps out a Battle the same two Players already have in this Round, even from the other Player’s pictures', async () => {
    savedFights = [1, 2, 3, 4, 5].map((i) => savedFight(i));
    mirrored = true; // the saved Battle has Luna on Side A; these pictures show it from Rover's side
    await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/0 of 1 battle ready/)).toBeTruthy());
    expect(within(table).getByText('Team 1: Rover against Luna is already saved in this Round (battle 1).')).toBeTruthy();
  });

  it('keeps the second group out when one import holds the same Battle from both Players', async () => {
    both = true;
    await openImport();
    const table = await screen.findByRole('region', { name: 'Battles of the Round' });
    await waitFor(() => expect(within(table).getByText(/1 of 2 battles ready/)).toBeTruthy());
    expect(within(table).getByText('the same two Players as battle 1 of this import: save one, then open this one')).toBeTruthy();
  });
});
