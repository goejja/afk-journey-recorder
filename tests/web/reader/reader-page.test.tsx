// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderPage } from '../../../web/reader/ReaderPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

let view: { heroes: any[]; withoutExamples: number };
let learned: any;
let requests: { method: string; url: string; action?: string }[];
let sent: { url: string; body: unknown }[];
let parked: any[];

beforeEach(() => {
  requests = [];
  sent = [];
  parked = [
    { id: 1, kind: 'difference', side: 'A', mode: 'Arena', readHero: 'Zed', keptHero: null, candidates: ['Fay', 'Nara'], createdAt: '2026-11-18 10:00:00' },
    { id: 2, kind: 'difference', side: 'B', mode: 'Arena', readHero: null, keptHero: null, candidates: ['Fay'], createdAt: '2026-11-18 10:01:00' },
    { id: 3, kind: 'unsure', side: 'A', mode: 'Arena', readHero: 'Evie', keptHero: 'Evie', candidates: [], createdAt: '2026-11-18 10:02:00' },
  ];
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
      if (typeof init?.body === 'string') sent.push({ url, body: JSON.parse(init.body) });
      if (url.startsWith('/api/admin/parked-readings') && method === 'GET') {
        const q = new URL(url, 'http://app').searchParams;
        const shown = q.get('kind') ? parked.filter((p) => p.kind === q.get('kind')) : parked;
        const counts = { difference: parked.filter((p) => p.kind === 'difference').length, unsure: parked.filter((p) => p.kind === 'unsure').length };
        const offset = Number(q.get('offset') ?? 0);
        return Response.json({ entries: shown.slice(offset, offset + Number(q.get('limit') ?? 20)), total: shown.length, counts, caps: { difference: 150, unsure: 50 } });
      }
      if (url.startsWith('/api/admin/parked-readings/') && method === 'POST') {
        parked = parked.filter((p) => `/api/admin/parked-readings/${p.id}/confirm` !== url);
        return Response.json({ learnt: true });
      }
      if (url.startsWith('/api/admin/parked-readings/') && method === 'DELETE') {
        parked = parked.filter((p) => `/api/admin/parked-readings/${p.id}` !== url);
        return new Response(null, { status: 204 });
      }
      if (url.startsWith('/api/heroes')) return Response.json(['Evie', 'Fay', 'Lily May', 'Nara', 'Zed'].map((name) => ({ name, faction: 'Lightbearer', class: 'Warrior', tier: 'S', owned: true, rank: null, equipmentLevel: null })));
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
    const user = userEvent.setup();
    render(<ReaderPage />);
    await user.click(await screen.findByRole('tab', { name: 'Heroes' }));
    const evie = await screen.findByRole('article', { name: 'Evie' });
    expect(within(evie).getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('3 tiles under 2 heroes')).toBeTruthy();
    expect(screen.getByText(/60 heroes have no tile yet/)).toBeTruthy();
    expect(screen.getByText('Looks like Evie')).toBeTruthy();
  });

  it('filters by hero name and to the tiles that look like another hero', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await user.click(await screen.findByRole('tab', { name: 'Heroes' }));
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
    await user.click(await screen.findByRole('tab', { name: 'Heroes' }));
    await screen.findByRole('article', { name: 'Lily May' });
    await user.click(screen.getByRole('button', { name: 'Delete example 3 of Lily May' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Lily May' })).toBeNull());
    expect(requests.find((r) => r.method === 'DELETE')).toEqual({ method: 'DELETE', url: '/api/admin/reader/example/3', action: 'app' });
  });

  it('moves a tile to another hero', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    await user.click(await screen.findByRole('tab', { name: 'Heroes' }));
    await screen.findByRole('article', { name: 'Lily May' });
    await user.selectOptions(screen.getByLabelText('Move example 3 of Lily May'), 'Evie');
    await waitFor(() => expect(requests.find((r) => r.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/api/admin/reader/example/3', action: 'app' }));
  });

  it('shows how the readings did and where the pictures came from, and deletes a whole source after asking', async () => {
    const user = userEvent.setup();
    render(<ReaderPage />);
    const summary = await screen.findByRole('region', { name: 'Accuracy and sources' });
    await user.click(within(summary).getByRole('button', { name: /How the readings did/ }));
    expect(within(summary).getByText('97.1%')).toBeTruthy();
    expect(within(summary).getByText('learn:ranks')).toBeTruthy();
    expect(within(summary).getByText('1 pictures')).toBeTruthy();
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

  describe('To confirm', () => {
    const renderPage = () => render(<ToastProvider><ReaderPage /></ToastProvider>);
    const card = (id: number) => screen.getByRole('listitem', { name: `Reading ${id}` });

    it('is the first tab, opens by default, and shows how many readings wait', async () => {
      renderPage();
      const tabs = await screen.findAllByRole('tab');
      expect(tabs[0]!.textContent).toMatch(/^To confirm/);
      await screen.findByRole('listitem', { name: 'Reading 1' });
      expect(screen.getByRole('tab', { name: 'To confirm (3)' }).getAttribute('aria-selected')).toBe('true');
      expect(within(card(1)).getByText('Side A: the Agent read Zed, and you did not keep it.')).toBeTruthy();
      expect(within(card(2)).getByText('Side B: the Agent could not name this hero.')).toBeTruthy();
      expect(within(card(3)).getByText('Side A: the Agent was not sure of Evie, and you kept it.')).toBeTruthy();
      expect(within(card(1)).getByRole('img', { name: 'Tile 1 to confirm' }).getAttribute('loading')).toBe('lazy');
    });

    it('confirms a candidate in one click: the card goes, the count follows and a toast says what was learnt', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('listitem', { name: 'Reading 1' });
      await user.click(within(card(1)).getByRole('button', { name: 'Confirm Fay' }));
      await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Reading 1' })).toBeNull());
      expect(sent).toContainEqual({ url: '/api/admin/parked-readings/1/confirm', body: { hero: 'Fay' } });
      expect(screen.getByRole('tab', { name: 'To confirm (2)' })).toBeTruthy();
      expect(within(screen.getByRole('status')).getByText('Learnt: Fay')).toBeTruthy();
    });

    it('offers the hero the player kept first for an unsure reading', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('listitem', { name: 'Reading 3' });
      await user.click(within(card(3)).getByRole('button', { name: 'Yes, it is Evie' }));
      await waitFor(() => expect(sent).toContainEqual({ url: '/api/admin/parked-readings/3/confirm', body: { hero: 'Evie' } }));
    });

    it('puts a reading aside at once, with no question', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('listitem', { name: 'Reading 2' });
      await user.click(screen.getByRole('button', { name: 'Dismiss reading 2' }));
      await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Reading 2' })).toBeNull());
      expect(requests).toContainEqual({ method: 'DELETE', url: '/api/admin/parked-readings/2', action: 'app' });
      expect(screen.getByRole('tab', { name: 'To confirm (2)' })).toBeTruthy();
    });

    it('shows one kind when asked, with the counts of each', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('listitem', { name: 'Reading 1' });
      expect(screen.getByRole('button', { name: 'Differences (2)' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Unsure (1)' }));
      await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Reading 1' })).toBeNull());
      expect(screen.getByRole('listitem', { name: 'Reading 3' })).toBeTruthy();
      expect(requests.some((r) => r.url.includes('kind=unsure'))).toBe(true);
    });

    it('reads 20 at a time and adds the next page on request', async () => {
      const user = userEvent.setup();
      parked = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, kind: 'difference', side: 'A', mode: 'Arena', readHero: 'Zed', keptHero: null, candidates: ['Fay'], createdAt: '2026-11-18 10:00:00' }));
      renderPage();
      await screen.findByRole('listitem', { name: 'Reading 1' });
      expect(screen.getAllByRole('listitem', { name: /^Reading / })).toHaveLength(20);
      await user.click(screen.getByRole('button', { name: 'Show more (5 left)' }));
      await waitFor(() => expect(screen.getAllByRole('listitem', { name: /^Reading / })).toHaveLength(25));
      expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    });

    it('chooses another hero in a dialog with the hero grid, reading the heroes only when it is first opened', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('listitem', { name: 'Reading 1' });
      expect(requests.some((r) => r.url.startsWith('/api/heroes'))).toBe(false);
      await user.click(within(card(1)).getByRole('button', { name: 'Other hero…' }));
      const dialog = await screen.findByRole('dialog', { name: 'Which hero is this?' });
      await user.click(await within(dialog).findByRole('button', { name: 'Lily May' }));
      await waitFor(() => expect(sent).toContainEqual({ url: '/api/admin/parked-readings/1/confirm', body: { hero: 'Lily May' } }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('says so when nothing waits, and when a kind is full', async () => {
      parked = [];
      const { unmount } = renderPage();
      expect(await screen.findByText('Nothing to confirm in Admin > Reader.')).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'To confirm (0)' })).toBeTruthy();
      unmount();
      parked = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, kind: 'difference', side: 'A', mode: 'Arena', readHero: 'Zed', keptHero: null, candidates: [], createdAt: '2026-11-18 10:00:00' }));
      renderPage();
      expect(await screen.findByText(/The list of differences is full \(150\)/)).toBeTruthy();
    });
  });
});
