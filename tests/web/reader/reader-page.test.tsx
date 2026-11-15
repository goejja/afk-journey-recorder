// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderPage } from '../../../web/reader/ReaderPage.js';

let view: { heroes: any[]; withoutExamples: number };
let learned: any;
let requests: { method: string; url: string; action?: string }[];

beforeEach(() => {
  requests = [];
  view = {
    heroes: [
      { hero: 'Evie', examples: [{ kind: 'example', id: 1, createdAt: '2026-11-04 10:00:00', looksLike: null, source: 'roster' }, { kind: 'look', id: 2, createdAt: '2026-11-05 10:00:00', looksLike: null, source: null }] },
      { hero: 'Lily May', examples: [{ kind: 'example', id: 3, createdAt: '2026-11-06 10:00:00', looksLike: 'Evie', source: 'battle' }] },
    ],
    withoutExamples: 60,
  };
  learned = {
    ranks: [
      { rank: 'Paragon 3', readable: false, looks: [{ id: 7, createdAt: '2026-11-07 10:00:00', source: 'offline', looksLike: null }] },
      { rank: 'Supreme+', readable: true, looks: [{ id: 8, createdAt: '2026-11-07 10:00:00', source: 'roster', looksLike: 'Paragon 4' }, { id: 9, createdAt: '2026-11-07 10:00:00', source: 'roster', looksLike: null }] },
    ],
    units: [{ kind: 'artifact', name: 'Arc Burst', looks: [{ id: 4, createdAt: '2026-11-08 10:00:00', source: 'battle', looksLike: null }] }],
    accuracy: [{ source: 'battle-form', screen: 'report', field: 'rank', readings: 904, agreed: 878, agreedPercent: 97.1 }],
    sources: [{ source: 'offline', count: 1 }, { source: 'battle', count: 2 }],
    choices: { heroes: ['Evie', 'Fay', 'Lily May'], ranks: ['Supreme+', 'Paragon 3', 'Paragon 4'], artifacts: ['Arc Burst', 'Awakening'], phantimals: [] },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, action: (init?.headers as Record<string, string> | undefined)?.['x-afk-action'] });
      if (url === '/api/admin/learned') return Response.json(learned);
      if (url.startsWith('/api/admin/learned/rank/') && method === 'PATCH') return Response.json({ wrongBefore: 3, wrongAfter: 1 });
      if (url.startsWith('/api/admin/learned/')) return method === 'DELETE' ? Response.json({ deleted: 1 }) : new Response(null, { status: 204 });
      if (method === 'PATCH') return new Response(null, { status: 204 });
      if (method === 'DELETE') {
        view = { ...view, heroes: view.heroes.map((h) => ({ ...h, examples: h.examples.filter((e: any) => `/api/admin/reader/${e.kind}/${e.id}` !== url) })).filter((h) => h.examples.length > 0) };
        return new Response(null, { status: 204 });
      }
      return Response.json(view);
    }),
  );
});
afterEach(cleanup);

describe('ReaderPage', () => {
  it('shows the tiles under each hero and marks the one that looks like another hero', async () => {
    render(<ReaderPage />);
    const evie = await screen.findByRole('article', { name: 'Evie' });
    expect(within(evie).getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('3 tiles under 2 heroes')).toBeTruthy();
    expect(screen.getByText(/60 heroes have no tile yet/)).toBeTruthy();
    expect(screen.getByText('Looks like Evie')).toBeTruthy();
  });

  it('filters by hero name and to the tiles that look like another hero', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await screen.findByRole('article', { name: 'Evie' });
    await user.click(screen.getByLabelText('Looks like another hero'));
    expect(screen.queryByRole('article', { name: 'Evie' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Lily May' })).toBeTruthy();
    await user.click(screen.getByLabelText('Looks like another hero'));
    await user.type(screen.getByLabelText('Search'), 'evi');
    expect(screen.queryByRole('article', { name: 'Lily May' })).toBeNull();
  });

  it('deletes a tile from the app and shows the list again', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await screen.findByRole('article', { name: 'Lily May' });
    await user.click(screen.getByRole('button', { name: 'Delete example 3 of Lily May' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Lily May' })).toBeNull());
    expect(requests.find((r) => r.method === 'DELETE')).toEqual({ method: 'DELETE', url: '/api/admin/reader/example/3', action: 'app' });
  });

  it('moves a tile to another hero', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await screen.findByRole('article', { name: 'Lily May' });
    await user.selectOptions(screen.getByLabelText('Move example 3 of Lily May'), 'Evie');
    await waitFor(() => expect(requests.find((r) => r.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/api/admin/reader/example/3', action: 'app' }));
  });

  it('shows how the readings did and where the pictures came from, and deletes a whole source after asking', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    const summary = await screen.findByRole('region', { name: 'Accuracy and sources' });
    expect(within(summary).getByText('97.1%')).toBeTruthy();
    expect(within(summary).getByText(/learn:ranks: 1 pictures/)).toBeTruthy();
    await user.click(within(summary).getByRole('button', { name: 'Delete all from learn:ranks' }));
    expect(requests.some((r) => r.url === '/api/admin/learned/source/offline')).toBe(false);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', url: '/api/admin/learned/source/offline', action: 'app' }));
  });

  it('shows the Rank Looks by rank, says which rank is not readable yet, and moves a look with its effect', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await user.click(await screen.findByRole('tab', { name: 'Ranks' }));
    const p3 = await screen.findByRole('article', { name: 'Paragon 3' });
    expect(within(p3).getByText(/not readable yet/)).toBeTruthy();
    expect(screen.getByText('Looks like Paragon 4')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Move rank look 8 of Supreme+'), 'Paragon 4');
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('3 wrong ranks before and 1 after'));
    expect(requests).toContainEqual({ method: 'PATCH', url: '/api/admin/learned/rank/8', action: 'app' });
    await user.click(screen.getByLabelText('Looks like another rank'));
    expect(screen.queryByRole('article', { name: 'Paragon 3' })).toBeNull();
  });

  it('shows the artifact crops by name and deletes one', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await user.click(await screen.findByRole('tab', { name: 'Artifacts and phantimals' }));
    await screen.findByRole('article', { name: 'Artifact Arc Burst' });
    await user.click(screen.getByRole('button', { name: 'Delete crop 4 of Arc Burst' }));
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE', url: '/api/admin/learned/unit/4', action: 'app' }));
  });
});
