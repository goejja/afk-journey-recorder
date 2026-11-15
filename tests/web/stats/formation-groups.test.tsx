// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from '../../../web/stats/StatsPage.js';

let requests: string[];

const hero = (name: string, share: number) => ({ hero: name, share });
const group = (core: string[], flex: [string, number][], games: number, wins: number, extra: Record<string, unknown> = {}) => ({
  core: core.map((c) => hero(c, 1)),
  flex: flex.map(([n, s]) => hero(n, s)),
  games,
  wins,
  winRate: Math.round((wins / games) * 1000) / 1000,
  players: 3,
  playerIds: [],
  variants: [],
  vsAverage: Math.round((wins / games - 0.5) * 1000) / 1000,
  artifact: { artifact: 'Bladesummon', share: 0.4 },
  labels: [{ name: 'Limited evidence' }],
  ...extra,
});
const report = {
  baseline: 0.5,
  rows: [
    {
      core: [hero('Gunnar', 1), hero('Gwyneth', 1)],
      flex: [hero('Contess', 0.5)],
      games: 30,
      wins: 20,
      winRate: 0.667,
      players: 5,
      groups: [group(['Gunnar', 'Gwyneth', 'Kulu'], [['Contess', 0.38]], 20, 14), group(['Gunnar', 'Gwyneth', 'Dunlingr'], [], 10, 6)],
    },
    {
      core: [hero('Perseus', 1)],
      flex: [],
      games: 4,
      wins: 1,
      winRate: 0.25,
      players: 1,
      groups: [group(['Perseus', 'Orion', 'Rolan'], [['Frieren', 0.18]], 4, 1, { labels: [{ name: 'Narrow use', detail: 'Aliceth + Kulu' }] })],
    },
  ],
};
const profile = {
  ...report.rows[0]!.groups[0]!,
  artifacts: [{ artifact: 'Bladesummon', games: 8, wins: 6, winRate: 0.75, share: 0.4 }],
  variations: [{ flex: ['Contess'], games: 8, wins: 6, winRate: 0.75 }],
  otherLineups: [{ heroes: ['Gunnar', 'Gwyneth', 'Kulu', 'Mira', 'Zed'], games: 1, wins: 0, winRate: 0 }],
  heroImpact: [{ hero: 'Contess', with: { games: 8, wins: 6, winRate: 0.75 }, without: { games: 12, wins: 8, winRate: 0.667 } }],
  strongAgainst: [{ enemy: ['Orion', 'Rolan'], games: 6, wins: 5, winRate: 0.833 }],
  weakAgainst: [{ enemy: ['Evie', 'Zed'], games: 5, wins: 1, winRate: 0.2 }],
  gapRecords: { ahead: { games: 4, wins: 3 }, near: { games: 6, wins: 4 }, behind: { games: 2, wins: 1 }, unknown: { games: 8, wins: 6 } },
  gapAdjustment: null,
  placement: [
    {
      map: 'Arena I', games: 12, wins: 9, winRate: 0.75,
      heroes: [
        { hero: 'Gunnar', tile: 38, share: 0.78, games: 12, secondChoice: false },
        { hero: 'Kulu', tile: 39, share: 0.4, games: 10, secondChoice: true },
      ],
    },
    { map: 'Arena II', games: 3, wins: 1, winRate: 0.333, heroes: [{ hero: 'Gunnar', tile: 40, share: 1, games: 3, secondChoice: false }] },
  ],
};
const maps = ['Arena I', 'Arena II'].map((name) => ({ name, tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: Array.from({ length: 45 }, (_, i) => (i < 5 ? 2 : i >= 38 ? 1 : 0)), source: 'manual' }));

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/stats-settings') return Response.json({ modes: [], defaults: [], available: [] });
      if (url === '/api/tags') return Response.json([]);
      if (url.startsWith('/api/stats/players')) return Response.json([]);
      if (url.startsWith('/api/stats/heroes')) return Response.json(['Gunnar', 'Kulu', 'Perseus'].map((h) => ({ hero: h, games: 9, wins: 5, winRate: 0.556, pickRate: 0.1 })));
      if (url === '/api/maps') return Response.json(maps);
      if (url.startsWith('/api/stats/formation-report')) return Response.json(report);
      if (url.startsWith('/api/stats/formation-profile')) return Response.json(profile);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async () => {
  const user = userEvent.setup();
  render(<StatsPage />);
  await user.click(screen.getByRole('tab', { name: 'Formations' }));
  await screen.findByText(/Gunnar \+ Gwyneth \+ Kulu/);
  return user;
};

describe('the Formations view', () => {
  it('lists groups under an archetype row that adds up their games, and a lone group on its own', async () => {
    await open();
    expect(screen.getByText(/Archetype: Gunnar \+ Gwyneth/).textContent).toMatch(/2 groups · 30 games/);
    expect(screen.queryByText(/Archetype: Perseus/)).toBeNull();
    expect(screen.getByText(/Perseus \+ Orion \+ Rolan/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Exact formations' })).toBeNull();
  });

  it('shows a group with its flex heroes, artifact, record, win rate against the average, players and labels', async () => {
    await open();
    const row = screen.getByText(/Gunnar \+ Gwyneth \+ Kulu/).closest('tr')!;
    const text = row.textContent!;
    expect(text).toContain('Contess 38%');
    expect(text).toContain('Bladesummon 40%');
    expect(text).toContain('14–6');
    expect(text).toContain('70%');
    expect(text).toContain('+20 pts');
    expect(text).toContain('Limited evidence');
    expect(screen.getByText(/Narrow use/).textContent).toContain('Aliceth + Kulu');
  });

  it('asks for the groups that hold the heroes picked', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Hero: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Kulu' }));
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/formation-report') && u.includes('hero=Kulu'))).toBe(true));
  });

  it('opens the profile of a group, asked for by its core heroes', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Gunnar \+ Gwyneth \+ Kulu/ }));
    const region = within(await screen.findByRole('region', { name: 'Profile of Gunnar + Gwyneth + Kulu' }));
    expect(requests.some((u) => u.startsWith('/api/stats/formation-profile') && u.includes('core=Gunnar') && u.includes('core=Kulu'))).toBe(true);
    expect(region.getByText('Strong against')).toBeTruthy();
    expect(region.getByText(/Orion \+ Rolan/).textContent).toContain('5–1');
    expect(region.getByText('Weak against')).toBeTruthy();
    expect(region.getByText(/Evie \+ Zed/)).toBeTruthy();
    expect(region.getByText('Hero impact')).toBeTruthy();
    expect(region.getByText(/Ahead/).textContent).toContain('3–1');
    expect(region.getByText(/Unknown gap/).textContent).toContain('6–2');
  });

  it('draws the example board of the map played most, with the record there, and offers the other maps', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Gunnar \+ Gwyneth \+ Kulu/ }));
    const region = within(await screen.findByRole('region', { name: 'Profile of Gunnar + Gwyneth + Kulu' }));
    expect(await region.findByText('Placement')).toBeTruthy();
    expect(region.getByLabelText('Map')).toHaveProperty('value', 'Arena I');
    expect(region.getByText(/9–3 on Arena I/)).toBeTruthy();
    expect(region.getByTitle('Gunnar')).toBeTruthy(); // on the board
    expect(region.getByText(/Gunnar — placed here 78% of 12 games/)).toBeTruthy();
    expect(region.getByText(/Kulu — placed here 40% of 10 games/).textContent).toContain('second choice');
    await user.selectOptions(region.getByLabelText('Map'), 'Arena II');
    expect(await region.findByText(/Gunnar — placed here 100% of 3 games/)).toBeTruthy();
    expect(region.queryByText(/Kulu — placed here/)).toBeNull();
  });
});
