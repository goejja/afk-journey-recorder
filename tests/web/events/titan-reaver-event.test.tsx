// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { EventsPage } from '../../../web/events/EventsPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const team = (name: string, tile: number, artifact: string) => ({ artifact, heroes: [{ tile, name, part: '', rank: 'Mythic+', equipmentLevel: 10 }], phantimal: null, assist: null, formationId: null });
const battle = (id: number, titanPhase: string, total: number, level: number, first = 'Evie', seasonPhase = 2) => ({
  id,
  createdAt: `2026-11-2${id} 10:00:00`,
  season: 8,
  seasonPhase,
  titanPhase,
  level,
  note: null,
  tags: [],
  formationId: null,
  total,
  fights: [
    { position: 1, boss: 'Aegis', damage: total / 2, formation: team(first, 38, 'Bladestorm') },
    { position: 2, boss: 'Basilisk', damage: total / 2, formation: team('Lucca', 39, 'Frostbite') },
  ],
});

let battles: object[];
let setup: object;
let requests: string[];

beforeEach(() => {
  requests = [];
  setup = { bosses: [null, null, null, null, null, null], updatedAt: null };
  battles = [battle(1, 'Charge', 2_000_000_000, 900), battle(2, 'Charge', 1_200_000_000, 800), battle(3, 'Charge', 1_500_000_000, 900, 'Nora')];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/bosses') return Response.json(['Aegis', 'Basilisk', 'Cerberus'].map((name) => ({ name, class: null, damageType: null, attempts: 0 })));
      if (url === '/api/maps') return Response.json([{ name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Lucca'), hero('Nora')]);
      if (url === '/api/artifacts') return Response.json([{ name: 'Bladestorm', group: 'Season 8' }, { name: 'Frostbite', group: 'Season 8' }]);
      if (url === '/api/phantimals') return Response.json([]);
      if (url === '/api/titan-reaver/setup') return Response.json(setup);
      if (url === '/api/seasons') return Response.json([{ number: 8, current: true, phase: 2, stages: 0, phantimals: 0, records: 0, tournaments: 0 }]);
      if (url === '/api/tags') return Response.json([]);
      if (url === '/api/formation-ids') return Response.json([]);
      if (url.startsWith('/api/titan-reaver/battles')) return Response.json(battles);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const renderPage = () =>
  render(
    <ToastProvider>
      <EventsPage />
    </ToastProvider>,
  );

describe('Titan Reaver > This event', () => {
  it('opens first, with a section for each Titan Reaver Phase and its score so far', async () => {
    renderPage();
    const charge = within(await screen.findByRole('region', { name: 'Charge' }));
    expect(screen.getByRole('tab', { name: 'This event', selected: true })).toBeTruthy();
    expect(charge.getByText(/Score so far/).textContent).toContain('2B'); // the best total
    expect(charge.getByText(/3 Battles/)).toBeTruthy();
    expect(charge.getByText(/team level 900/)).toBeTruthy();
    expect(charge.queryByText(/below the maximum/)).toBeNull(); // 900 is the maximum of Season Phase 2
    expect(within(screen.getByRole('region', { name: 'Clash' })).getByText('No Battle recorded for Clash yet.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Conquer' })).getByText('No Battle recorded for Conquer yet.')).toBeTruthy();
  });

  it('reads the Battles of the current Season and the Season Phase', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Charge' });
    await waitFor(() => expect(requests.some((u) => u.startsWith('/api/titan-reaver/battles') && u.includes('season=8') && u.includes('seasonPhase=2'))).toBe(true));
  });

  it('groups the Battles of the same two teams whatever their level, best total first', async () => {
    renderPage();
    const charge = within(await screen.findByRole('region', { name: 'Charge' }));
    const rows = charge.getAllByRole('row').filter((r) => r.getAttribute('aria-label')?.startsWith('Charge group'));
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Charge group 1', 'Charge group 2']);
    expect(within(rows[0]!).getByText(/level 900 \(800–900\)/)).toBeTruthy();
    expect(rows[0]!.textContent).toMatch(/avg.*· ×2/);
    expect(within(rows[1]!).getByText(/^level 900$/)).toBeTruthy();
    expect(within(rows[0]!).getByText('2B')).toBeTruthy();
  });

  it('opens a group to show where the heroes stood and every Battle of it', async () => {
    const user = userEvent.setup();
    renderPage();
    const charge = within(await screen.findByRole('region', { name: 'Charge' }));
    await user.click(charge.getByRole('button', { name: /Show the Battles of charge group 1/ }));
    expect(charge.getByRole('row', { name: 'Placements of charge group 1' })).toBeTruthy();
    expect(within(charge.getByRole('row', { name: 'Battles of charge group 1' })).getByText(/2B at level 900.*1.2B at level 800/)).toBeTruthy();
  });

  it('says when a score was set below the maximum level', async () => {
    battles = [battle(4, 'Clash', 1_000_000_000, 850)];
    renderPage();
    const clash = within(await screen.findByRole('region', { name: 'Clash' }));
    expect(await clash.findByText(/below the maximum, 900/)).toBeTruthy();
  });

  it('heads the columns with the setup’s bosses, else with the bosses of the best Battle, and says when there are none', async () => {
    setup = { bosses: ['Cerberus', null, null, null, null, null], updatedAt: '2026-11-20 09:00:00' };
    renderPage();
    const charge = within(await screen.findByRole('region', { name: 'Charge' }));
    const head = within(charge.getByRole('table', { name: 'Charge best groups' }));
    expect(head.getByText('Cerberus')).toBeTruthy(); // declared
    expect(head.getByText('Basilisk')).toBeTruthy(); // the best Battle's second boss
    expect(charge.queryByText(/No bosses set/)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Conquer' })).getByText(/No bosses set for Conquer/)).toBeTruthy();
  });

  it('opens another Season Phase of the event, whose setup does not apply', async () => {
    const user = userEvent.setup();
    setup = { bosses: ['Cerberus', null, null, null, null, null], updatedAt: '2026-11-20 09:00:00' };
    battles = [battle(5, 'Charge', 600_000_000, 500, 'Evie', 1)];
    renderPage();
    await screen.findByRole('region', { name: 'Charge' });
    await user.selectOptions(screen.getByLabelText('Season Phase'), '1');
    await waitFor(() => expect(requests.some((u) => u.includes('seasonPhase=1'))).toBe(true));
    const head = within((await screen.findAllByRole('table', { name: 'Charge best groups' }))[0]!);
    expect(await head.findByText('Aegis')).toBeTruthy();
    expect(head.queryByText('Cerberus')).toBeNull();
  });

  it('opens the Records filtered to the Season Phase and Titan Reaver Phase of a section', async () => {
    const user = userEvent.setup();
    renderPage();
    const charge = within(await screen.findByRole('region', { name: 'Charge' }));
    await user.click(charge.getByRole('button', { name: 'Show records' }));
    expect((await screen.findByLabelText('Season Phase') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Titan Reaver Phase') as HTMLSelectElement).value).toBe('Charge');
    expect(screen.getByRole('tab', { name: 'Records', selected: true })).toBeTruthy();
  });
});
