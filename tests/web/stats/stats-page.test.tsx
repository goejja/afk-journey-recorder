// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from '../../../web/stats/StatsPage.js';

let requests: string[];
let defaultModes: string[] | 'fail';

beforeEach(() => {
  requests = [];
  defaultModes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/stats-settings') {
        return defaultModes === 'fail' ? Response.json({ error: 'No' }, { status: 500 }) : Response.json({ modes: defaultModes, defaults: [], available: [] });
      }
      if (url === '/api/tags') return Response.json([{ tag: 'Luna', count: 2 }]);
      if (url === '/api/stats/summary') {
        return Response.json({ records: [{ mode: 'Arena', records: 4, wins: 3, first: '2026-10-01', last: '2026-10-29' }], tags: [{ tag: 'Luna', records: 2 }] });
      }
      if (url.startsWith('/api/stats/heroes/Evie/rows')) return Response.json([{ row: 1, games: 6, wins: 5, winRate: 0.833 }, { row: 2, games: 4, wins: 1, winRate: 0.25 }]);
      if (url.startsWith('/api/stats/artifacts')) return Response.json([{ artifact: 'Bladestorm', games: 12, wins: 9, winRate: 0.75 }, { artifact: 'Awakening', games: 2, wins: 0, winRate: 0 }]);
      if (url.startsWith('/api/stats/maps')) return Response.json([{ map: 'Arena V', games: 9, wins: 6, winRate: 0.667 }]);
      if (url.startsWith('/api/stats/rules')) return Response.json([{ rule: 'Berserk', games: 5, wins: 4, winRate: 0.8 }]);
      if (url.startsWith('/api/stats/heroes/Evie/distribution')) {
        return Response.json({
          hero: 'Evie', players: 7, unknown: 1,
          cells: [{ rank: 'Supreme', equipmentLevel: 15, players: 3 }, { rank: 'Mythic+', equipmentLevel: 10, players: 2 }, { rank: 'Mythic+', equipmentLevel: 5, players: 1 }, { rank: 'Rare', equipmentLevel: null, players: 0 }],
        });
      }
      if (url.startsWith('/api/stats/heroes')) {
        return Response.json([
          { hero: 'Evie', games: 10, wins: 9, winRate: 0.9, pickRate: 0.4 },
          { hero: 'Fay', games: 2, wins: 2, winRate: 1, pickRate: 0.08 },
          { hero: 'Zed', games: 8, wins: 2, winRate: 0.25, pickRate: 0.32 },
        ]);
      }
      if (url.startsWith('/api/stats/players')) {
        return Response.json([
          { playerId: '10000003', name: 'Gwen', games: 8, wins: 6, winRate: 0.75, modes: ['Arena', 'Guild Duel'], first: '2026-10-01', last: '2026-10-29', formations: [{ heroes: ['Evie', 'Zed'], games: 8, wins: 6, winRate: 0.75 }] },
          { playerId: '10000001', name: null, games: 2, wins: 0, winRate: 0, modes: ['Arena'], first: '2026-10-05', last: '2026-10-06', formations: [{ heroes: ['Fay'], games: 2, wins: 0, winRate: 0 }] },
        ]);
      }
      if (url.startsWith('/api/stats/trios')) return Response.json([{ heroA: 'Evie', heroB: 'Fay', heroC: 'Zed', games: 4, wins: 3, winRate: 0.75 }]);
      if (url.startsWith('/api/stats/pairs')) return Response.json([{ heroA: 'Evie', heroB: 'Fay', games: 6, wins: 5, winRate: 0.833 }]);
      if (url.startsWith('/api/stats/stages')) {
        return Response.json([{ season: 8, phase: 0, kind: 'Normal', number: 120, games: 5, wins: 2, winRate: 0.4, last: '2026-10-29' }]);
      }
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('Statistics page', () => {
  it('shows records and win rate per mode, and the tags in use', async () => {
    render(<StatsPage />);
    expect(await screen.findByText('Arena')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText(/Luna \(2\)/)).toBeTruthy();
  });

  it('flags heroes with few games and sorts when a header is clicked', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await screen.findByText('Evie');
    expect(rows()[1]!.textContent).toMatch(/Fay.*few games/); // 2 games is too few
    expect(rows()[0]!.textContent).not.toMatch(/few games/);

    await user.click(screen.getByRole('button', { name: 'Rate' }));
    expect(rows().map((r) => r.textContent!.match(/Evie|Fay|Zed/)![0])).toEqual(['Fay', 'Evie', 'Zed']);
    await user.click(screen.getByRole('button', { name: 'Rate' }));
    expect(rows().map((r) => r.textContent!.match(/Evie|Fay|Zed/)![0])).toEqual(['Zed', 'Evie', 'Fay']);
  });

  it('opens a hero to show how many Players fielded it at each rank and equipment level, collapsed at first', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: /Evie/ }));
    const grid = within(await screen.findByRole('table', { name: 'Rank and equipment of Evie' }));
    expect(screen.getByText(/7 players/)).toBeTruthy();
    expect(screen.getByText(/1 with no rank known/)).toBeTruthy();
    const supreme = grid.getByRole('row', { name: /Supreme/ });
    expect(within(supreme).getByRole('cell', { name: '3' })).toBeTruthy(); // under the +15 column
    expect(grid.getByRole('columnheader', { name: /\+15/ })).toBeTruthy();
    expect(grid.getAllByRole('row').map((r) => r.textContent!.match(/Supreme|Mythic\+|Rare/)?.[0])).toEqual([undefined, 'Supreme', 'Mythic+', 'Rare']);
    expect(requests.some((u) => u.startsWith('/api/stats/heroes/Evie/distribution'))).toBe(true);
    expect(requests.some((u) => u.startsWith('/api/stats/heroes/Fay/distribution'))).toBe(false); // only the opened hero is asked for
  });

  it('shows each hero’s pick rate next to its win rate', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await screen.findByRole('button', { name: /Evie/ });
    expect(screen.getByRole('button', { name: 'Pick rate' })).toBeTruthy();
    expect(rows()[0]!.textContent).toContain('40%');
  });

  it('shows the win rate of an opened hero by row from its back edge', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: /Evie/ }));
    const table = within(await screen.findByRole('table', { name: 'Rows of Evie' }));
    expect(table.getByText('Row 1 (back edge)')).toBeTruthy();
    expect(table.getByText('Row 2')).toBeTruthy();
    expect(screen.getByText(/Side B tile is turned over/)).toBeTruthy();
  });

  it('starts every view that has a Mode filter with the configured modes, without first asking for every mode', async () => {
    defaultModes = ['Arena', 'Guild Duel'];
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    expect(await screen.findByRole('button', { name: 'Mode: Arena, Guild Duel' })).toBeTruthy();
    await screen.findByRole('button', { name: /Evie/ });
    const asked = requests.filter((u) => u.startsWith('/api/stats/heroes?'));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((u) => u.includes('mode=Arena&mode=Guild+Duel'))).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Players' }));
    expect(await screen.findByRole('button', { name: 'Mode: Arena, Guild Duel' })).toBeTruthy();
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/players') && u.includes('mode=Arena&mode=Guild+Duel'))).toBe(true));
  });

  it('can still show every mode: the default is a starting choice, not a restriction', async () => {
    defaultModes = ['Arena'];
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: 'Mode: Arena' }));
    await user.click(screen.getByRole('checkbox', { name: 'Arena' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/stats/heroes?min=1'));
    expect(screen.getByRole('button', { name: 'Mode: All' })).toBeTruthy();
  });

  it('shows every mode when the default modes cannot be read', async () => {
    defaultModes = 'fail';
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    expect(await screen.findByRole('button', { name: 'Mode: All' })).toBeTruthy();
    await screen.findByRole('button', { name: /Evie/ });
  });

  it('shows the win rate of each artifact, filtered by mode', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Artifacts' }));
    expect(await screen.findByText('Bladestorm')).toBeTruthy();
    expect(rows()[1]!.textContent).toMatch(/Awakening.*few games/);
    await user.click(screen.getByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Arena' }));
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/artifacts') && u.includes('mode=Arena'))).toBe(true));
  });

  it('shows the win rate of Side A per map and per rule, and says why only Side A', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Maps & rules' }));
    expect(await screen.findByText('Arena V')).toBeTruthy();
    expect(await screen.findByText('Berserk')).toBeTruthy();
    expect(screen.getByText(/only Side A is counted/)).toBeTruthy();
  });

  it('filters heroes by Player, naming each Player by Profile or bare ID, and has no Player filter on Players or Stages', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: 'Player: All' }));
    expect(screen.getByRole('checkbox', { name: 'Gwen' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'ID 10000001' }));
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/heroes?') && u.includes('player=10000001'))).toBe(true));
    await user.click(screen.getByRole('tab', { name: 'Players' }));
    expect(screen.queryByRole('button', { name: /^Player:/ })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Stages' }));
    expect(screen.queryByRole('button', { name: /^Player:/ })).toBeNull();
  });

  it('asks the distribution with the filters of the page', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Arena' }));
    await user.click(await screen.findByRole('button', { name: /Evie/ }));
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/heroes/Evie/distribution') && u.includes('mode=Arena'))).toBe(true));
  });

  it('shows each Player by name or bare ID, flags few games, and opens the formations they fielded', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Players' }));
    await screen.findByRole('button', { name: /Gwen/ });
    expect(rows()[0]!.textContent).toContain('ID 10000003');
    expect(rows()[1]!.textContent).toMatch(/ID 10000001.*few games/); // no Profile has this ID, and 2 games is too few
    expect(screen.queryByText('Fay')).toBeNull(); // collapsed
    await user.click(screen.getByRole('button', { name: /Gwen/ }));
    const detail = within(screen.getByRole('region', { name: 'Formations of Gwen' }));
    expect(detail.getByText('Evie')).toBeTruthy();
    expect(detail.getByText('Zed')).toBeTruthy();
    expect(detail.getByText(/8 games · 75%/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Gwen/ }));
    expect(screen.queryByRole('region', { name: 'Formations of Gwen' })).toBeNull();
  });

  it('filters Players by mode, with no tag filter', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Players' }));
    await screen.findByRole('button', { name: /Gwen/ });
    expect(screen.queryByRole('button', { name: /^Tag/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Guild Duel' }));
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/players') && u.includes('mode=Guild+Duel'))).toBe(true));
  });

  it('passes the mode, tag and minimum to the server', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Supreme Arena' }));
    await user.clear(screen.getByLabelText('At least (games)'));
    await user.type(screen.getByLabelText('At least (games)'), '3');
    await waitFor(() => expect(requests.at(-1)).toBe('/api/stats/heroes?min=3&mode=Supreme+Arena'));
  });

  it('sends every chosen mode, repeated, and nothing for a filter left empty', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Heroes' }));
    await user.click(await screen.findByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Arena' }));
    await user.click(screen.getByRole('checkbox', { name: 'Guild Duel' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/stats/heroes?min=1&mode=Arena&mode=Guild+Duel'));
    expect(screen.getByRole('button', { name: 'Mode: Arena, Guild Duel' })).toBeTruthy();
  });

  it('switches hero groups between pairs and trios, asking for at least 3 games of a trio', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Hero groups' }));
    expect(await screen.findByText('83%')).toBeTruthy(); // pairs first
    await user.click(screen.getByRole('radio', { name: 'Trios' }));
    expect(await screen.findByText('75%')).toBeTruthy();
    expect(requests.at(-1)).toBe('/api/stats/trios?min=3');
    expect((screen.getByLabelText('At least (games)') as HTMLInputElement).value).toBe('3');
    expect(rows()[0]!.textContent).toMatch(/Evie.*Fay.*Zed/);
    await user.click(screen.getByRole('radio', { name: 'Pairs' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/stats/pairs?min=1'));
    expect((screen.getByLabelText('At least (games)') as HTMLInputElement).value).toBe('1');
  });

  it('keeps a minimum the player typed when the group size changes', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Hero groups' }));
    await user.clear(screen.getByLabelText('At least (games)'));
    await user.type(screen.getByLabelText('At least (games)'), '7');
    await user.click(screen.getByRole('radio', { name: 'Trios' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/stats/trios?min=7'));
  });

  it('shows pairs and stages', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Hero groups' }));
    expect(await screen.findByText('83%')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Stages' }));
    expect(await screen.findByText('S8 · Normal · 120')).toBeTruthy();
  });
});
