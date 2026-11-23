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
  otherFormations: [{ heroes: ['Gunnar', 'Gwyneth', 'Kulu', 'Mira', 'Zed'], games: 1, wins: 0, winRate: 0 }],
  heroImpact: [{ hero: 'Contess', with: { games: 8, wins: 6, winRate: 0.75 }, without: { games: 12, wins: 8, winRate: 0.667 } }],
  strongAgainst: [],
  weakAgainst: [],
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
const matchup = (vs: number, wins: number, losses: number, anecdote = false) => ({ vs, games: wins + losses, wins, losses, winRate: Math.round((wins / (wins + losses)) * 1000) / 1000, anecdote });
const counterGroup = (core: string[], games: number, wins: number, counters: { beats?: unknown[]; losesTo?: unknown[]; matchups: unknown[] }) => ({
  core, flex: [], games, wins, winRate: wins / games, beats: [], losesTo: [], ...counters,
});
const counters = {
  rule: { winRate: 0.65, minGames: 5 },
  groups: [
    counterGroup(['Gunnar', 'Gwyneth', 'Kulu'], 20, 14, { beats: [matchup(1, 5, 1)], matchups: [matchup(1, 5, 1), matchup(2, 2, 0, true)] }),
    counterGroup(['Perseus', 'Orion', 'Rolan'], 6, 1, { losesTo: [matchup(0, 1, 5)], matchups: [matchup(0, 1, 5)] }),
    counterGroup(['Gunnar', 'Gwyneth', 'Dunlingr'], 10, 6, { matchups: [matchup(0, 0, 2, true)] }),
  ],
};
const pair = (heroA: string, heroB: string, games: number, wins: number) => ({ heroA, heroB, games, wins, winRate: wins / games });
const pairs = [pair('Gunnar', 'Kulu', 12, 9), pair('Gunnar', 'Perseus', 20, 5), pair('Contess', 'Gwyneth', 4, 1)];
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
      if (url.startsWith('/api/stats/pairs')) return Response.json(pairs);
      if (url.startsWith('/api/stats/formation-report')) return Response.json(report);
      if (url.startsWith('/api/stats/formation-profile')) return Response.json(profile);
      if (url.startsWith('/api/stats/group-counters')) return Response.json(counters);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The groups list, apart from the matrix that names the same groups. */
const table = () => within(screen.getByRole('list', { name: 'Formation groups' }));
/** The card of a group opens in a dialog. */
const card = async (name: string) => within(await screen.findByRole('region', { name: `Profile of ${name}` }));

/** Archetypes start folded; unfolded, the groups of the first one are listed. */
const open = async (unfold = true) => {
  const user = userEvent.setup();
  render(<StatsPage />);
  await user.click(screen.getByRole('tab', { name: 'Formations' }));
  await screen.findByRole('list', { name: 'Formation groups' });
  if (unfold) await user.click(screen.getByRole('button', { name: /Archetype: Gunnar \+ Gwyneth/ }));
  return user;
};

describe('the Formations view', () => {
  it('lists groups under an archetype row that adds up their games, and a lone group on its own', async () => {
    const user = await open(false);
    const head = screen.getByRole('button', { name: /Archetype: Gunnar \+ Gwyneth/ });
    expect(head.title).toBe('2 groups');
    expect(head.textContent).toContain('67%20–10305');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(table().queryByRole('button', { name: 'Gunnar + Gwyneth + Kulu' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Archetype: Perseus/ })).toBeNull();
    expect(table().getByRole('button', { name: 'Perseus + Orion + Rolan' })).toBeTruthy();
    await user.click(head);
    expect(table().getByRole('button', { name: 'Gunnar + Gwyneth + Kulu' })).toBeTruthy();
    await user.click(head);
    expect(table().queryByRole('button', { name: 'Gunnar + Gwyneth + Kulu' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Exact formations' })).toBeNull();
  });

  it('shows a group with its core and flex portraits and their shares, record, win rate and games', async () => {
    await open();
    const row = table().getByRole('button', { name: 'Gunnar + Gwyneth + Kulu' });
    expect(row.textContent).toContain('70%14–620');
    expect(within(row).getByTitle('Contess 38%')).toBeTruthy();
    expect(within(row).getByTitle('Gunnar 100%')).toBeTruthy();
    expect(within(table().getByRole('button', { name: 'Perseus + Orion + Rolan' })).getByText('few games')).toBeTruthy();
  });

  it('keeps the artifact, players, win rate against the average and labels in the card of the group', async () => {
    const user = await open();
    await user.click(table().getByRole('button', { name: 'Perseus + Orion + Rolan' }));
    const text = (await card('Perseus + Orion + Rolan')).getByText(/1–3 of 4 games/).parentElement!.textContent!;
    expect(text).toContain('Bladesummon 40%');
    expect(text).toContain('3 players');
    expect(text).toMatch(/[−-]25 pts/);
    expect(text).toContain('Narrow use: Aliceth + Kulu');
  });

  it('asks for the groups that hold the heroes picked', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Hero: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Kulu' }));
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/formation-report') && u.includes('hero=Kulu'))).toBe(true));
  });

  it('opens the profile of a group, asked for by its core heroes', async () => {
    const user = await open();
    await user.click(table().getByRole('button', { name: 'Gunnar + Gwyneth + Kulu' }));
    const region = within(await screen.findByRole('region', { name: 'Profile of Gunnar + Gwyneth + Kulu' }));
    expect(requests.some((u) => u.startsWith('/api/stats/formation-profile') && u.includes('core=Gunnar') && u.includes('core=Kulu'))).toBe(true);
    expect(region.getByText('Hero impact')).toBeTruthy();
    expect(region.getByText(/Ahead/).textContent).toContain('3–1');
    expect(region.getByText(/Unknown gap/).textContent).toContain('6–2');
  });

  it('draws the example layout of the map played most, with the record there, and offers the other maps', async () => {
    const user = await open();
    await user.click(table().getByRole('button', { name: 'Gunnar + Gwyneth + Kulu' }));
    const region = within(await screen.findByRole('region', { name: 'Profile of Gunnar + Gwyneth + Kulu' }));
    expect(await region.findByText('Placement')).toBeTruthy();
    expect(region.getByLabelText('Map')).toHaveProperty('value', 'Arena I');
    expect(region.getByText(/9–3 on Arena I/)).toBeTruthy();
    expect(within(region.getByLabelText('Example Layout on Arena I')).getByTitle('Gunnar')).toBeTruthy(); // on the layout
    expect(region.getByText(/Gunnar — placed here 78% of 12 games/)).toBeTruthy();
    expect(region.getByText(/Kulu — placed here 40% of 10 games/).textContent).toContain('second choice');
    await user.selectOptions(region.getByLabelText('Map'), 'Arena II');
    expect(await region.findByText(/Gunnar — placed here 100% of 3 games/)).toBeTruthy();
    expect(region.queryByText(/Kulu — placed here/)).toBeNull();
  });
});

describe('the pairs of a group', () => {
  it('lists, in the card of a group, only the pairs of its own heroes, the most played first', async () => {
    const user = await open();
    await user.click(table().getByRole('button', { name: 'Gunnar + Gwyneth + Kulu' }));
    const region = await card('Gunnar + Gwyneth + Kulu');
    expect(await region.findByText('Gunnar + Kulu — 9–3 of 12 (75%)')).toBeTruthy();
    expect(region.getByText('Contess + Gwyneth — 1–3 of 4 (25%)')).toBeTruthy();
    expect(region.queryByText(/Gunnar \+ Perseus/)).toBeNull();
  });
});

describe('the counters between groups', () => {
  it('lists, in the profile of a group, the groups it beats and loses to, and the groups met in too few games as anecdote', async () => {
    const user = await open();
    await user.click(table().getByRole('button', { name: 'Gunnar + Gwyneth + Kulu' }));
    const region = within(await screen.findByRole('region', { name: 'Profile of Gunnar + Gwyneth + Kulu' }));
    expect(await region.findByText('Beats')).toBeTruthy();
    expect(region.getByText(/Perseus \+ Orion \+ Rolan — 5–1 of 6 \(83%\)/)).toBeTruthy();
    expect(region.getByText(/No group met in at least 5 games with a win rate of 65% or more/)).toBeTruthy();
    const anecdote = region.getByText(/Gunnar \+ Gwyneth \+ Dunlingr — 2–0 of 2/);
    expect(anecdote.textContent).toContain('anecdote');
  });

  it('reads the loss side of a group from the other group’s record', async () => {
    const user = await open();
    await user.click(table().getByRole('button', { name: 'Perseus + Orion + Rolan' }));
    const region = within(await screen.findByRole('region', { name: 'Profile of Perseus + Orion + Rolan' }));
    expect(await region.findByText(/Gunnar \+ Gwyneth \+ Kulu — 5–1 of 6 \(83%\)/)).toBeTruthy();
  });

  it('draws a matrix of the groups against each other with the win rate and games in each cell', async () => {
    await open();
    const matrix = within(await screen.findByRole('table', { name: 'Win rate of each group against each other' }));
    const row = matrix.getByRole('rowheader', { name: /^1\. Gunnar \+ Gwyneth \+ Kulu/ }).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('83%6');
    expect(cells[1]!.className).toContain('win');
    expect(cells[2]!.textContent).toBe('100%2');
    expect(cells[2]!.className).toContain('faded');
    expect(cells[0]!.textContent).toBe(''); // a group against itself
  });

  it('asks for the counters under the same filters as the table', async () => {
    await open();
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/group-counters'))).toBe(true));
  });
});
