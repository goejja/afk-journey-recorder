// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { EventsPage } from '../../../web/events/EventsPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const team = (name: string, tile = 38) => ({ artifact: 'Bladestorm', heroes: [{ tile, name, part: '', rank: 'Mythic+', equipmentLevel: 10 }], phantimal: null, assist: null, formationId: null });
const battle = (id: number, level: number, first: string, damage: number, tile = 38) => ({
  id,
  createdAt: `2026-11-${10 + id} 10:00:00`,
  season: 8,
  seasonPhase: 2,
  titanPhase: 'Charge',
  level,
  note: null,
  tags: [],
  formationId: null,
  total: damage + 100,
  fights: [
    { position: 1, boss: 'Aegis', damage, formation: team(first, tile) },
    { position: 2, boss: 'Basilisk', damage: 100, formation: { ...team('Lucca', 39), artifact: 'Frostbite' } },
  ],
});

let battles: object[];
let requests: string[];

beforeEach(() => {
  requests = [];
  battles = [
    battle(1, 900, 'Evie', 1_000_000_000),
    battle(2, 900, 'Evie', 1_200_000_000, 40),
    battle(3, 900, 'Nora', 600_000_000),
    battle(4, 850, 'Nora', 1_400_000_000),
    battle(5, 850, 'Evie', 1_100_000_000),
    battle(6, 700, 'Mira', 2_000_000_000),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/bosses') return Response.json(['Aegis', 'Basilisk'].map((name) => ({ name, class: null, damageType: null, attempts: 0 })));
      if (url === '/api/maps') return Response.json([{ name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Lucca'), hero('Nora'), hero('Mira')]);
      if (url === '/api/artifacts') return Response.json([{ name: 'Bladestorm', group: 'Season 8' }, { name: 'Frostbite', group: 'Season 8' }]);
      if (url === '/api/phantimals') return Response.json([]);
      if (url === '/api/titan-reaver/setup') return Response.json({ bosses: [null, null, null, null, null, null], updatedAt: null });
      if (url === '/api/seasons') return Response.json([{ number: 8, current: true, phase: 2, stages: 0, phantimals: 0, records: 0, tournaments: 0 }]);
      if (url === '/api/tags') return Response.json([]);
      if (url.startsWith('/api/titan-reaver/battles')) return Response.json(battles);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const open = async () => {
  render(
    <ToastProvider>
      <EventsPage />
    </ToastProvider>,
  );
  await userEvent.click(await screen.findByRole('tab', { name: 'Best teams' }));
  return within(await screen.findByRole('table', { name: 'Best teams' }));
};
const rows = (table: ReturnType<typeof within>) => table.getAllByRole('row').slice(1);

describe('Titan Reaver > Best teams', () => {
  it('ranks the teams against the boss with the most fights at the current maximum level, by best damage', async () => {
    const table = await open();
    expect((screen.getByLabelText('Boss') as HTMLSelectElement).value).toBe('Aegis');
    expect((screen.getByLabelText('Team level') as HTMLSelectElement).value).toBe('900');
    const [first, second] = rows(table);
    expect(first!.textContent).toContain('1.2B'); // Evie: best of her 2 fights at 900
    expect(within(first!).getAllByRole('cell')[2]!.textContent).toBe('2');
    expect(within(first!).getAllByRole('cell')[3]!.textContent).toBe('1.1B'); // the median of 1.0B and 1.2B
    expect(second!.textContent).toContain('600M'); // Nora
    expect(first!.textContent).toContain('anecdote'); // 2 fights
  });

  it('puts after them a team with no fight at the level, with its best at its own highest level', async () => {
    const table = await open();
    const last = rows(table).at(-1)!;
    expect(last.textContent).toContain('lower level: best 2B at level 700');
    expect(within(last).getAllByRole('cell')[2]!.textContent).toBe('0');
  });

  it('says when a team with a lower damage beat the top one at a level both were recorded at', async () => {
    const table = await open();
    expect(rows(table)[1]!.textContent).toContain('Beat the top team at level 850: 1.4B vs 1.1B (1 and 1 fight)');
    expect(rows(table)[0]!.textContent).not.toContain('Beat the top team');
  });

  it('ranks again at another level, without scaling any damage', async () => {
    const user = userEvent.setup();
    const table = await open();
    await user.selectOptions(screen.getByLabelText('Team level'), '850');
    const [first, second] = rows(table);
    expect(first!.textContent).toContain('1.4B'); // Nora at 850
    expect(second!.textContent).toContain('1.1B'); // Evie at 850
    expect(rows(table).at(-1)!.textContent).toContain('lower level');
  });

  it('opens a team to the places its heroes stood, best damage first', async () => {
    const user = userEvent.setup();
    const table = await open();
    await user.click(table.getByRole('button', { name: 'Show placements of team 1' }));
    expect(screen.getAllByLabelText('Layout on Open')).toHaveLength(2); // Evie stood on two tiles
    expect(document.body.textContent).toContain("1 fight, best 1.2B");
  });

  it('reads every Battle, whatever the Season, and asks for the tags chosen', async () => {
    await open();
    expect(requests.some((u) => u.startsWith('/api/titan-reaver/battles') && !u.includes('season='))).toBe(true);
  });

  it('says so when nothing is recorded', async () => {
    battles = [];
    render(
      <ToastProvider>
        <EventsPage />
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Best teams' }));
    expect(await screen.findByText(/No Titan Reaver fights recorded/)).toBeTruthy();
  });
});
