// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UNIT_RULES } from '../../../src/domain/units.js';
import { PhantimalsPage } from '../../../web/admin/PhantimalsPage.js';

const items = [
  { name: 'Gervan', part: null, faction: 'Lightbearer', class: 'Mage', seasons: [8], source: 'import' },
  { name: 'Aurelian', part: null, faction: 'Lightbearer', class: 'Support', seasons: [7], source: 'import' },
];
let usage = { records: 0, deployments: 0, placements: 0 };
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  usage = { records: 0, deployments: 0, placements: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method: init?.method ?? 'GET', url, body });
      if (url === '/api/unit-rules') return Response.json(DEFAULT_UNIT_RULES);
      if (url.endsWith('/usage')) return Response.json(usage);
      return !init?.method || init.method === 'GET' ? Response.json(items) : Response.json({ ...items[0], ...body });
    }),
  );
});
afterEach(cleanup);

describe('PhantimalsPage', () => {
  it('lists phantimals and filters by season', async () => {
    const user = userEvent.setup();
    render(<PhantimalsPage />);
    const list = within(await screen.findByRole('list', { name: 'Phantimals' }));
    expect(await list.findByRole('button', { name: /Gervan/ })).toBeTruthy();
    expect(list.getByRole('button', { name: /Aurelian/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Season: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Season 7' }));
    expect(list.queryByRole('button', { name: /Gervan/ })).toBeNull();
    expect(list.getByRole('button', { name: /Aurelian/ })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Season 8' })); // several seasons: a phantimal of any of them
    expect(list.getByRole('button', { name: /Gervan/ })).toBeTruthy();
    expect(list.getByRole('button', { name: /Aurelian/ })).toBeTruthy();
  });

  it('tags a phantimal with another season and saves', async () => {
    const user = userEvent.setup();
    render(<PhantimalsPage />);
    await user.click(await screen.findByRole('button', { name: /Gervan/ }));
    await user.type(screen.getByLabelText('Season number'), '9');
    await user.click(screen.getByRole('button', { name: 'Add season' }));
    expect(screen.getByText('Season 9')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('/api/phantimals/Gervan');
    expect(put.body.seasons).toEqual([8, 9]);
  });

  it('removes a season tag', async () => {
    const user = userEvent.setup();
    render(<PhantimalsPage />);
    await user.click(await screen.findByRole('button', { name: /Gervan/ }));
    await user.click(screen.getByRole('button', { name: 'Remove season 8' }));
    expect(screen.queryByRole('button', { name: 'Remove season 8' })).toBeNull();
    expect(screen.getByText('Not available in any season yet')).toBeTruthy();
  });

  it('declares a second part, which locks once a record uses the phantimal', async () => {
    const user = userEvent.setup();
    render(<PhantimalsPage />);
    await user.click(await screen.findByRole('button', { name: /Gervan/ }));
    await user.type(screen.getByLabelText('Second part'), 'Gervan shade');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')?.body.part).toBe('Gervan shade'));
    cleanup();

    usage = { records: 3, deployments: 1, placements: 4 };
    render(<PhantimalsPage />);
    await user.click(await screen.findByRole('button', { name: /Gervan/ }));
    await waitFor(() => expect((screen.getByLabelText('Second part') as HTMLInputElement).disabled).toBe(true));
    expect(screen.getByText(/3 records and 1 Formation IDs and Round Deployments/)).toBeTruthy();
  });
});
