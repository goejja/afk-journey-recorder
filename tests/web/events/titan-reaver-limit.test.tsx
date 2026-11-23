// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsPage } from '../../../web/events/EventsPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

// The views read at most this many Battles; a small limit makes the warning easy to reach.
vi.mock('../../../web/events/titan-reaver/draft.js', async (original) => ({ ...(await original<object>()), ALL_BATTLES: 2 }));

const team = (name: string) => ({ artifact: null, heroes: [{ tile: 38, name, part: '', rank: null, equipmentLevel: null }], phantimal: null, assist: null, formationId: null });
const battle = (id: number) => ({
  id,
  createdAt: '2026-11-20 10:00:00',
  season: 8,
  seasonPhase: 2,
  titanPhase: 'Charge',
  level: 900,
  note: null,
  tags: [],
  formationId: null,
  total: 2000,
  fights: [
    { position: 1, boss: 'Aegis', damage: 1000, formation: team('Evie') },
    { position: 2, boss: 'Basilisk', damage: 1000, formation: team('Lucca') },
  ],
});

let battles: object[];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/reference') return Response.json({ ranks: [], equipmentLevels: [], caps: [] });
      if (url === '/api/seasons') return Response.json([{ number: 8, current: true, phase: 2, stages: 0, phantimals: 0, records: 0, tournaments: 0 }]);
      if (url === '/api/titan-reaver/setup') return Response.json({ bosses: [null, null, null, null, null, null], updatedAt: null });
      if (url === '/api/bosses' || url === '/api/maps' || url === '/api/heroes' || url === '/api/artifacts' || url === '/api/phantimals' || url === '/api/tags') return Response.json([]);
      if (url.startsWith('/api/titan-reaver/battles')) return Response.json(battles);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const open = async (tab: string) => {
  render(
    <ToastProvider>
      <EventsPage />
    </ToastProvider>,
  );
  if (tab !== 'This event') await userEvent.click(await screen.findByRole('tab', { name: tab }));
};

describe('Titan Reaver views that read every Battle', () => {
  it.each(['This event', 'Best teams'])('%s warns when the Battles read reach the limit, so older ones may be missing', async (tab) => {
    battles = [battle(1), battle(2)];
    await open(tab);
    expect(await screen.findByText(/Only the newest 2 Battles are read/)).toBeTruthy();
  });

  it.each(['This event', 'Best teams'])('%s says nothing below the limit', async (tab) => {
    battles = [battle(1)];
    await open(tab);
    await screen.findByLabelText(tab === 'This event' ? 'Season Phase' : 'Boss');
    expect(screen.queryByText(/Only the newest/)).toBeNull();
  });
});
