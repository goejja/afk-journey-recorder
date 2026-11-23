// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { MapsPage } from '../../../web/admin/MapsPage.js';

const rowLengths = [2, 5, 6, 6, 7, 6, 6, 5, 2];
const cells = Array(TILE_COUNT).fill(TILE.OPEN);
const maps = [
  { name: 'Arena I', tags: ['Arena'], rowLengths, cells, boostTiles: [], source: 'import', handMade: false, canRestore: false },
  { name: 'Open', tags: ['Stage'], rowLengths, cells, boostTiles: [], source: 'manual', handMade: false, canRestore: false },
  { name: 'Supreme Arena XV', tags: ['Arena'], rowLengths, cells, boostTiles: [], source: 'manual', handMade: true, canRestore: false },
];

let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method: init?.method ?? 'GET', url, body });
      if (!init?.method || init.method === 'GET') return Response.json(maps);
      return Response.json({ ...maps[0], ...body });
    }),
  );
});
afterEach(cleanup);

describe('MapsPage', () => {
  it('lists maps, renders all 45 tiles, and filters by tag', async () => {
    const user = userEvent.setup();
    render(<MapsPage />);
    expect(await screen.findByRole('button', { name: /Arena I/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Arena I/ }));
    expect(screen.getAllByRole('button', { name: /^Tile \d+:/ })).toHaveLength(45);

    await user.selectOptions(screen.getByLabelText('Tag'), 'Stage');
    const list = within(screen.getByRole('list', { name: 'Maps' }));
    expect(list.queryByRole('button', { name: /Arena I/ })).toBeNull();
    expect(list.getByRole('button', { name: /Open/ })).toBeTruthy();
  });

  it('says on a map made by hand that the next import takes over its tiles', async () => {
    const user = userEvent.setup();
    render(<MapsPage />);
    await user.click(await screen.findByRole('button', { name: /Supreme Arena XV/ }));
    expect(screen.getByText('Not on Yaphalla yet: the next import takes over its tiles.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Arena I/ }));
    expect(screen.queryByText(/Not on Yaphalla yet/)).toBeNull();
  });

  it('changes a tile in a popover and saves the edited map', async () => {
    const user = userEvent.setup();
    render(<MapsPage />);
    await user.click(await screen.findByRole('button', { name: /Arena I/ }));

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Tile 1: Open' }));
    const type = within(screen.getByRole('group', { name: 'Type of tile 1' }));
    expect(type.getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(type.getByRole('button', { name: 'Enemy deployment' }));
    expect(screen.getByRole('button', { name: 'Tile 1: Enemy deployment' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Type of tile 1' })).toBeTruthy(); // it stays open after a pick

    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('/api/maps/Arena%20I');
    expect(put.body.cells[0]).toBe(TILE.ENEMY);
  });

  it('closes the popover on a second click on the tile and on a press elsewhere, and opens one for one tile at a time', async () => {
    const user = userEvent.setup();
    render(<MapsPage />);
    await user.click(await screen.findByRole('button', { name: /Arena I/ }));
    await user.click(screen.getByRole('button', { name: 'Tile 1: Open' }));
    await user.click(screen.getByRole('button', { name: 'Tile 2: Open' }));
    expect(screen.queryByRole('group', { name: 'Type of tile 1' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Type of tile 2' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tile 2: Open' }));
    expect(screen.queryByRole('group', { name: 'Type of tile 2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tile 3: Open' }));
    await user.click(screen.getByLabelText('Map name'));
    expect(screen.queryByRole('group', { name: 'Type of tile 3' })).toBeNull();
  });

  it('starts a new map from the New map button', async () => {
    const user = userEvent.setup();
    render(<MapsPage />);
    await screen.findByRole('button', { name: /Arena I/ });
    await user.click(screen.getByRole('button', { name: 'New map' }));
    expect(screen.getByRole('heading', { name: 'New map' })).toBeTruthy();
    await user.type(screen.getByLabelText('Map name'), 'Boss field');
    await user.click(screen.getByRole('button', { name: 'Create map' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/maps')).toBe(true));
    expect(within(document.body).getByLabelText('Map name')).toBeTruthy();
  });

  describe('Boost tiles', () => {
    const duel = { name: 'Duel', tags: ['Arena'], rowLengths, cells: [TILE.ENEMY, ...Array(39).fill(TILE.OPEN), ...Array(5).fill(TILE.PLAYER)], boostTiles: [41], source: 'manual', canRestore: false };
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const body = init?.body ? JSON.parse(init.body as string) : undefined;
          requests.push({ method: init?.method ?? 'GET', url, body });
          return !init?.method || init.method === 'GET' ? Response.json([duel]) : Response.json({ ...duel, ...body });
        }),
      );
    });
    const boost = (tile: number) => within(screen.getByRole('group', { name: `Boost of tile ${tile}` }));

    it('draws the Boost tiles of a map, and sets and removes a Boost in the popover, saving the list', async () => {
      const user = userEvent.setup();
      render(<MapsPage />);
      await user.click(await screen.findByRole('button', { name: /Duel/ }));
      expect(screen.getByRole('button', { name: 'Tile 42: Player deployment, Boost' }).textContent).toContain('★');
      await user.click(screen.getByRole('button', { name: 'Tile 44: Player deployment' }));
      await user.click(boost(44).getByRole('button', { name: 'Boost tile' }));
      await user.click(screen.getByRole('button', { name: 'Tile 42: Player deployment, Boost' }));
      expect(boost(42).getByRole('button', { name: 'Boost tile' }).getAttribute('aria-pressed')).toBe('true');
      await user.click(boost(42).getByRole('button', { name: 'No boost' }));
      await user.click(screen.getByRole('button', { name: 'Tile 1: Enemy deployment' }));
      await user.click(boost(1).getByRole('button', { name: 'Boost tile' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
      expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ boostTiles: [0, 43] });
    });

    it('offers no Boost on a tile that is not a deployment tile, and takes the Boost off a tile that changes type', async () => {
      const user = userEvent.setup();
      render(<MapsPage />);
      await user.click(await screen.findByRole('button', { name: /Duel/ }));
      await user.click(screen.getByRole('button', { name: 'Tile 10: Open' }));
      expect(boost(10).queryByRole('button')).toBeNull();
      expect(boost(10).getByText('None on this tile')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Tile 42: Player deployment, Boost' }));
      await user.click(within(screen.getByRole('group', { name: 'Type of tile 42' })).getByRole('button', { name: 'Enemy deployment' })); // another side: no Boost
      expect(screen.getByRole('button', { name: 'Tile 42: Enemy deployment' })).toBeTruthy();
      expect(boost(42).getByRole('button', { name: 'No boost' }).getAttribute('aria-pressed')).toBe('true');
      await user.click(boost(42).getByRole('button', { name: 'Boost tile' }));
      await user.click(within(screen.getByRole('group', { name: 'Type of tile 42' })).getByRole('button', { name: 'Wood wall (destructible)' }));
      expect(boost(42).getByText('None on this tile')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
      expect(requests.find((r) => r.method === 'PUT')!.body.boostTiles).toEqual([]);
    });

    it('explains the Boost tile in the legend', async () => {
      const user = userEvent.setup();
      render(<MapsPage />);
      await user.click(await screen.findByRole('button', { name: /Duel/ }));
      expect(screen.getByText(/Boost tile \(a deployment tile that boosts its unit\)/)).toBeTruthy();
    });
  });
});
