// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { MapsPage } from '../../../web/admin/MapsPage.js';

const rowLengths = [2, 5, 6, 6, 7, 6, 6, 5, 2];
const cells = Array(TILE_COUNT).fill(TILE.OPEN);
const maps = [
  { name: 'Arena I', tags: ['Arena'], rowLengths, cells, source: 'import', canRestore: false },
  { name: 'Open', tags: ['Stage'], rowLengths, cells, source: 'manual', canRestore: false },
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

  it('changes a tile on click and saves the edited map', async () => {
    const user = userEvent.setup();
    render(<MapsPage />);
    await user.click(await screen.findByRole('button', { name: /Arena I/ }));

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Tile 1: Open' }));
    expect(screen.getByRole('button', { name: 'Tile 1: Player deployment' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tile 1: Player deployment' }));
    expect(screen.getByRole('button', { name: 'Tile 1: Enemy deployment' })).toBeTruthy();

    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('/api/maps/Arena%20I');
    expect(put.body.cells[0]).toBe(TILE.ENEMY);
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
});
