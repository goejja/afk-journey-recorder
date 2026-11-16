// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UNIT_RULES } from '../../../src/domain/units.js';
import { HeroAdminPage } from '../../../web/admin/HeroAdminPage.js';

const items = [
  { name: 'Alna', tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', source: 'import', pair: null, summon: null },
  { name: 'Zanie', tier: 'S', class: 'Marksman', faction: 'Mauler', damageType: 'Physical', source: 'manual', pair: null, summon: { part: 'Laser Turret', count: 2 } },
  { name: 'Elijah & Lailah', tier: 'S', class: 'Tank', faction: 'Celestial', damageType: 'Physical', source: 'import', pair: { part1: 'Elijah', part2: 'Lailah' }, summon: null },
];
const free = { roster: 0, records: 0, assists: 0, scenarios: 0, deployments: 0, stageEnemies: 0, pictures: 0, onBoard: 0 };
let usage = free;
let tierChecks: unknown[] = [];
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  usage = free;
  tierChecks = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method: init?.method ?? 'GET', url, body });
      if (url === '/api/unit-rules') return Response.json(DEFAULT_UNIT_RULES);
      if (url === '/api/admin/tier-check') return Response.json(tierChecks);
      if (url.endsWith('/usage')) return Response.json(usage);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return !init?.method || init.method === 'GET' ? Response.json(items) : Response.json({ ...items[0], ...body });
    }),
  );
});
afterEach(cleanup);

describe('HeroAdminPage', () => {
  it('lists heroes with their units, filters and searches, and badges the player\'s own', async () => {
    const user = userEvent.setup();
    render(<HeroAdminPage />);
    const list = within(await screen.findByRole('list', { name: 'Heroes' }));
    expect(await list.findByRole('button', { name: /Zanie.*own.*2 × Laser Turret/ })).toBeTruthy();
    expect(list.getByRole('button', { name: /Elijah & Lailah.*Elijah & Lailah/ })).toBeTruthy();

    await user.type(screen.getByLabelText('Search heroes'), 'zan');
    expect(list.queryByRole('button', { name: /Alna/ })).toBeNull();
    expect(list.getByRole('button', { name: /Zanie/ })).toBeTruthy();
  });

  it('filters to the heroes whose own record departs from their tier, and says so beside the hint', async () => {
    tierChecks = [
      { hero: 'Zanie', pvpTier: 'C', games: 8, wins: 7, winRate: 0.875, ownAverage: 0.5, vsAverage: 0.375, flag: 'outperforms', anecdote: false, text: 'Your records: Zanie won 7 of 8 (88%) against 50% for all your PvP games, so it wins more than your average for a Prydwen C.' },
      { hero: 'Alna', pvpTier: 'S', games: 3, wins: 0, winRate: 0, ownAverage: 0.5, vsAverage: -0.5, flag: 'underperforms', anecdote: true, text: 'anecdote' },
    ];
    const user = userEvent.setup();
    render(<HeroAdminPage />);
    const list = within(await screen.findByRole('list', { name: 'Heroes' }));
    await list.findByRole('button', { name: /Zanie/ });
    await user.click(screen.getByLabelText('Departs from tier'));
    expect(list.queryByRole('button', { name: /Alna/ })).toBeNull(); // 3 games: anecdote, not listed
    expect(list.queryByRole('button', { name: /Elijah/ })).toBeNull();
    await user.click(list.getByRole('button', { name: /Zanie/ }));
    expect(await screen.findByText(/Zanie won 7 of 8.*Prydwen C/)).toBeTruthy();
  });

  it('shows a hero\'s range, energy and mechanic tags with where they came from, and saves an edit as the player\'s', async () => {
    items[0] = { ...items[0], attributes: { range: 1, energy: [0, 200], mechanics: ['cheat-death', 'dot'], releasedInSeason: 5, setOn: '2026-11-14', source: 'external' } } as any;
    const user = userEvent.setup();
    render(<HeroAdminPage />);
    await user.click(await screen.findByRole('button', { name: /Alna/ }));
    expect((screen.getByLabelText('Range') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Energy') as HTMLInputElement).value).toBe('0, 200');
    expect((screen.getByLabelText('Mechanic tags') as HTMLInputElement).value).toBe('cheat-death, dot');
    expect(screen.getByText(/Copied from an outside source on 2026-11-14/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save attributes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.clear(screen.getByLabelText('Range'));
    await user.type(screen.getByLabelText('Range'), '5');
    await user.click(save);
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/admin/heroes/Alna/attributes')?.body).toEqual({ range: 5, energy: [0, 200], mechanics: ['cheat-death', 'dot'], releasedInSeason: 5 }));
    delete (items[0] as { attributes?: unknown }).attributes;
  });

  it('creates a hero with its four pieces of information and a summon', async () => {
    const user = userEvent.setup();
    render(<HeroAdminPage />);
    await user.click(await screen.findByRole('button', { name: 'New hero' }));
    await user.type(screen.getByLabelText('Name'), 'Thane');
    await user.selectOptions(screen.getByLabelText('Tier'), 'S');
    await user.selectOptions(screen.getByLabelText('Class'), 'Warrior');
    await user.selectOptions(screen.getByLabelText('Faction'), 'Lightbearer');
    await user.selectOptions(screen.getByLabelText('Damage type'), 'Physical');
    await user.selectOptions(screen.getByLabelText('Stands'), 'summoner');
    await user.type(screen.getByLabelText('Summon name'), 'Drone');
    await user.click(screen.getByRole('button', { name: 'Create hero' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.method === 'POST')).toMatchObject({
      url: '/api/admin/heroes',
      body: { name: 'Thane', tier: 'S', class: 'Warrior', faction: 'Lightbearer', damageType: 'Physical', pair: null, summon: { part: 'Drone', count: 1 } },
    });
  });

  it('keeps the name of an existing hero and locks its units once a board has it', async () => {
    const user = userEvent.setup();
    usage = { ...free, records: 4, onBoard: 4 };
    render(<HeroAdminPage />);
    await user.click(await screen.findByRole('button', { name: /Zanie/ }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByLabelText('Stands') as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByText(/placed on a board in 4 records/)).toBeTruthy();
    expect(screen.getByText('4 records')).toBeTruthy();
  });

  it('says what blocks a delete, and deletes a hero nothing uses', async () => {
    const user = userEvent.setup();
    render(<HeroAdminPage />);
    await user.click(await screen.findByRole('button', { name: /Alna/ }));
    expect(await screen.findByText('Nothing: it can be deleted.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/admin/heroes/Alna')).toBe(true));
  });
});
