// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactsPage } from '../../../web/admin/ArtifactsPage.js';

let requests: { method: string; url: string; body?: any }[];
let artifacts: any[];

beforeEach(() => {
  requests = [];
  artifacts = [
    { name: 'Bladestorm', group: 'Season 8', source: 'import', uses: 2 },
    { name: 'Awakening', group: 'Pre-Season', source: 'import', uses: 0 },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/artifacts' && method === 'GET') return Response.json(artifacts);
      if (url === '/api/artifacts' && method === 'POST') return Response.json({ ...body, source: 'manual', uses: 0 }, { status: 201 });
      if (url.startsWith('/api/artifacts/') && method === 'PUT') return Response.json({ ...body, source: 'manual', uses: 0 });
      if (url.startsWith('/api/artifacts/') && method === 'DELETE') return Response.json({ error: '2 records use Bladestorm' }, { status: 409 });
      if (url === '/api/seasons') return Response.json([{ number: 9, current: true, stages: 0, phantimals: 0 }, { number: 8, current: false, stages: 3, phantimals: 0 }]);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('Artifacts page', () => {
  it('lists artifacts with their group, and narrows them by search', async () => {
    const user = userEvent.setup();
    render(<ArtifactsPage />);
    const list = await screen.findByRole('list', { name: 'Artifacts' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['BladestormSeason 8', 'AwakeningPre-Season']);
    await user.type(screen.getByLabelText('Search artifacts'), 'awak');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
  });

  it('moves an artifact from Pre-Season to one season', async () => {
    const user = userEvent.setup();
    render(<ArtifactsPage />);
    await user.click(await screen.findByRole('button', { name: /^Awakening/ }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.queryByLabelText('Season')).toBeNull(); // only a seasonal artifact has one
    await user.click(screen.getByRole('radio', { name: 'Seasonal' }));
    expect((screen.getByLabelText('Season') as HTMLSelectElement).value).toBe('9'); // starts on the current season
    await user.selectOptions(screen.getByLabelText('Season'), '8');
    await user.click(save);
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    expect(requests.find((r) => r.method === 'PUT')).toMatchObject({ url: '/api/artifacts/Awakening', body: { name: 'Awakening', group: 'Season 8' } });
  });

  it('adds an artifact and shows why a delete was refused', async () => {
    const user = userEvent.setup();
    render(<ArtifactsPage />);
    await user.click(await screen.findByRole('button', { name: 'New artifact' }));
    await user.type(screen.getByLabelText('Name'), 'Moonveil');
    await user.click(screen.getByRole('button', { name: 'Create artifact' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ name: 'Moonveil', group: 'Pre-Season' }));

    await user.click(await screen.findByRole('button', { name: /^Bladestorm/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toBe('2 records use Bladestorm');
  });
});
