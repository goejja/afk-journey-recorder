// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from '../../../web/stats/StatsPage.js';

let requests: string[];

const report = {
  hero: 'Gunnar', games: 12, wins: 8, winRate: 0.667,
  partners: [
    { hero: 'Kulu', games: 9, wins: 7, winRate: 0.778, share: 0.75 },
    { hero: 'Mira', games: 3, wins: 1, winRate: 0.333, share: 0.25 },
  ],
};

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/stats-settings') return Response.json({ modes: [], defaults: [], available: [] });
      if (url === '/api/tags') return Response.json([]);
      if (url.startsWith('/api/stats/players')) return Response.json([]);
      if (url.startsWith('/api/stats/heroes')) return Response.json(['Gunnar', 'Kulu', 'Alna'].map((h) => ({ hero: h, games: 9, wins: 5, winRate: 0.556, pickRate: 0.1 })));
      if (url.startsWith('/api/stats/partner-tags')) return Response.json([{ tag: 'protect', heroes: ['Alna', 'Gunnar'] }, { tag: 'temp-buff', heroes: ['Kulu'] }]);
      if (url.startsWith('/api/stats/partners')) return Response.json(report);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Partners view', () => {
  it('asks for nothing until a hero is picked, then lists who it is fielded with and how often', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Partners' }));
    expect(await screen.findByText(/Pick a hero to see who it is fielded with/)).toBeTruthy();
    expect(requests.some((u) => u.startsWith('/api/stats/partners'))).toBe(false);
    await user.selectOptions(await screen.findByLabelText('Hero'), 'Gunnar');
    const table = within(await screen.findByRole('table', { name: 'Heroes fielded with Gunnar' }));
    expect(requests.some((u) => u.startsWith('/api/stats/partners') && u.includes('hero=Gunnar'))).toBe(true);
    const kulu = table.getByText('Kulu').closest('tr')!;
    expect(kulu.textContent).toContain('75%');
    expect(kulu.textContent).toContain('78%');
    expect(table.getByText('Mira').closest('tr')!.textContent).toContain('few games');
    expect(screen.getByText(/Gunnar: 8–4 of 12 games \(67%\)/)).toBeTruthy();
    expect(screen.getByText(/not who was the target/)).toBeTruthy();
  });

  it('limits the hero list to the heroes of the mechanic tag picked', async () => {
    const user = userEvent.setup();
    render(<StatsPage />);
    await user.click(screen.getByRole('tab', { name: 'Partners' }));
    await user.selectOptions(await screen.findByLabelText('Mechanic tag'), 'protect (2)');
    const options = within(screen.getByLabelText('Hero')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Pick a hero…', 'Alna', 'Gunnar']);
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/stats/partner-tags'))).toBe(true));
  });
});
