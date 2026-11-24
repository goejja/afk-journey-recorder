// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { EventsPage } from '../../../web/events/EventsPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const formation = (name: string, tile: number, artifact: string) => ({ artifact, heroes: [{ tile, name, part: '', rank: 'Mythic+', equipmentLevel: 10 }], phantimal: null, assist: null, formationId: null });
const saved = {
  id: 7,
  createdAt: '2026-11-20 10:00:00',
  season: 8,
  seasonPhase: 2,
  titanPhase: 'Clash',
  level: 850,
  note: 'first try',
  tags: ['Stun'],
  formationId: null,
  total: 2_000_000_000,
  fights: [
    { position: 1, boss: 'Aegis', damage: 1_200_000_000, formation: formation('Evie', 38, 'Bladestorm') },
    { position: 2, boss: 'Basilisk', damage: 800_000_000, formation: formation('Lucca', 39, 'Frostbite') },
  ],
};

let battles: object[];
let phantimals: object[];
let setup: object;
let seasonPhase: number;
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  battles = [saved];
  phantimals = [];
  setup = { bosses: [null, null, null, null, null, null], updatedAt: null };
  seasonPhase = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/bosses') return Response.json(['Aegis', 'Basilisk', 'Cerberus'].map((name) => ({ name, class: null, damageType: null, attempts: 0 })));
      if (url === '/api/maps') return Response.json([{ name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Lucca'), hero('Mira')]);
      if (url === '/api/artifacts') return Response.json([{ name: 'Bladestorm', group: 'Season 8' }, { name: 'Frostbite', group: 'Season 8' }]);
      if (url === '/api/phantimals') return Response.json(phantimals);
      if (url === '/api/titan-reaver/setup') return Response.json(setup);
      if (url === '/api/seasons') return Response.json([{ number: 8, current: true, phase: seasonPhase, stages: 0, phantimals: 0, records: 0, tournaments: 0 }]);
      if (url === '/api/tags') return Response.json([{ tag: 'Stun', count: 1 }]);
      if (url === '/api/formation-ids') return Response.json([]);
      if (url.startsWith('/api/titan-reaver/battles') && method === 'GET') return Response.json(battles);
      if (url === '/api/titan-reaver/battles' && method === 'POST') {
        seasonPhase = Math.max(seasonPhase, JSON.parse(init!.body as string).seasonPhase); // the server raises the stored Season Phase
        return Response.json({ ...saved, id: 8 }, { status: 201 });
      }
      if (url === '/api/titan-reaver/battles/7' && method === 'DELETE') return new Response(null, { status: 204 });
      if (url === '/api/titan-reaver/battles/7' && method === 'PUT') return Response.json(saved);
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
/** The page opens on This event: go to its Records. */
const renderRecords = async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('tab', { name: 'Records' }));
};
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement | HTMLSelectElement;

describe('the Events page', () => {
  it('opens on Titan Reaver and its Records, listing each Battle with its phases, level, total and fights', async () => {
    await renderRecords();
    expect(await screen.findByRole('tab', { name: 'Titan Reaver' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Records' })).toBeTruthy();
    await screen.findByText('first try');
    const list = within(screen.getByRole('list', { name: 'Titan Reaver records' }));
    expect(list.getByText('Clash · Season Phase 2')).toBeTruthy();
    expect(list.getByText('Team level 850')).toBeTruthy();
    expect(list.getByText('2B')).toBeTruthy();
    expect(list.getByText('1.2B')).toBeTruthy();
    expect(list.getAllByTitle('Aegis')).toBeTruthy();
    expect(list.getByText('first try')).toBeTruthy();
  });

  it('filters the list by Season Phase and Titan Reaver Phase', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await screen.findByText('first try');
    await user.selectOptions(field('Season Phase'), '2');
    await user.selectOptions(field('Titan Reaver Phase'), 'Clash');
    await waitFor(() => expect(requests.at(-1)!.url).toContain('seasonPhase=2'));
    expect(requests.at(-1)!.url).toContain('titanPhase=Clash');
  });

  it('starts a new record on the current Season Phase, with the setup’s bosses and the Season Phase’s maximum level', async () => {
    seasonPhase = 2;
    setup = { bosses: ['Aegis', 'Basilisk', 'Cerberus', null, null, null], updatedAt: '2026-11-20 09:00:00' };
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(await screen.findByRole('heading', { name: 'New Titan Reaver record' })).toBeTruthy();
    expect(field('Season Phase').value).toBe('2');
    expect(field('Titan Reaver Phase').value).toBe('Charge');
    expect(field('Team level (up to 900)').value).toBe('900');
    expect(field('Boss').value).toBe('Aegis');
    await user.click(screen.getByRole('tab', { name: /Fight 2/ }));
    expect(field('Boss').value).toBe('Basilisk');
    await user.selectOptions(field('Titan Reaver Phase'), 'Clash');
    expect(field('Boss').value).toBe('Basilisk'); // the setup names no second Clash boss yet, so this fight keeps its own
    await user.click(screen.getByRole('tab', { name: /Fight 1/ }));
    expect(field('Boss').value).toBe('Cerberus');
  });

  it('names the fight tabs by their number only, as Dream Hunt and the PvP modes do', async () => {
    seasonPhase = 2;
    setup = { bosses: ['Aegis', 'Basilisk', 'Cerberus', null, null, null], updatedAt: '2026-11-20 09:00:00' };
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await screen.findByRole('heading', { name: 'New Titan Reaver record' });
    expect(screen.getByRole('tab', { name: 'Fight 1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Fight 2' })).toBeTruthy();
    expect(field('Boss').value).toBe('Aegis'); // the boss is still picked in the tab
  });

  it('says where to set the bosses when none are set', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(await screen.findByText(/No Titan Reaver bosses set for Season Phase 1/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Admin > Weekly default/ }).getAttribute('href')).toBe('#admin');
    expect(field('Team level (up to 600)').value).toBe('600');
  });

  it('records again from a saved Battle: the same teams, bosses and level, no damage and no note, saved with the damage typed', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record from this' }));
    await screen.findByRole('heading', { name: 'New Titan Reaver record' });
    expect(field('Season Phase').value).toBe('2');
    expect(field('Titan Reaver Phase').value).toBe('Clash');
    expect(field('Team level (up to 900)').value).toBe('850');
    expect((field('Damage') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('Note') as HTMLInputElement).value).toBe('');
    expect(field('Boss').value).toBe('Aegis');

    await user.type(field('Damage'), '1.2B');
    await user.click(screen.getByRole('tab', { name: /Fight 2/ }));
    expect(field('Boss').value).toBe('Basilisk');
    await user.type(field('Damage'), '750,000,000');
    expect(screen.getByText(/Total 1,950,000,000/)).toBeTruthy();

    expect(screen.queryByLabelText(/Total the game showed/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/titan-reaver/battles')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST')!.body;
    expect(sent).toMatchObject({ seasonPhase: 2, titanPhase: 'Clash', level: 850, note: '', tags: ['Stun'], formationId: null });
    expect(sent.fights.map((f: any) => [f.boss, f.damage, f.formation.heroes.map((h: any) => h.hero), f.formation.artifact])).toEqual([
      ['Aegis', 1_200_000_000, ['Evie'], 'Bladestorm'],
      ['Basilisk', 750_000_000, ['Lucca'], 'Frostbite'],
    ]);
    expect(JSON.stringify(sent)).not.toContain('gameTotal');
    expect(await screen.findByRole('list', { name: 'Titan Reaver records' })).toBeTruthy();
  });

  it('starts the next new record on the Season Phase a saved record advanced', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record from this' }));
    await screen.findByRole('heading', { name: 'New Titan Reaver record' });
    await user.type(field('Damage'), '1B');
    await user.click(screen.getByRole('tab', { name: /Fight 2/ }));
    await user.type(field('Damage'), '1B');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await screen.findByRole('list', { name: 'Titan Reaver records' });
    await user.click(screen.getByRole('button', { name: 'New record' }));
    await screen.findByRole('heading', { name: 'New Titan Reaver record' });
    expect(field('Season Phase').value).toBe('2');
  });

  it('asks for the damage as a number instead of saving', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record from this' }));
    await user.type(await screen.findByLabelText('Damage'), 'lots');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(await screen.findByText(/Fight 1: enter the damage as a number/)).toBeTruthy();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('edits a saved Battle with its damage written out, and saves it back', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit Titan Reaver record' })).toBeTruthy();
    expect((field('Damage') as HTMLInputElement).value).toBe('1,200,000,000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url === '/api/titan-reaver/battles/7')).toBe(true));
  });

  it('deletes a Battle after asking', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await screen.findByText('first try');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click((await screen.findAllByRole('button', { name: 'Delete' })).at(-1)!);
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/titan-reaver/battles/7')).toBe(true));
  });
});

describe('the Phantimal of a Titan Reaver team', () => {
  it('stands with the third hero of its faction and goes when the team drops below three, with no picker', async () => {
    phantimals = [{ name: 'Gervan', faction: 'Wilder', class: 'Mage', seasons: [8], source: 'import' }];
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await screen.findByRole('heading', { name: 'New Titan Reaver record' });
    expect(screen.queryByRole('heading', { name: 'Phantimal' })).toBeNull();
    for (const name of ['Evie', 'Lucca']) await user.click(await screen.findByRole('button', { name }));
    expect(screen.queryAllByTitle('Gervan')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Mira' }));
    await waitFor(() => expect(screen.queryAllByTitle('Gervan').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Remove Gervan' })).toBeNull(); // the heroes bring it: nothing to remove by hand
    await user.click(screen.getByRole('button', { name: 'Remove Mira' }));
    await waitFor(() => expect(screen.queryAllByTitle('Gervan')).toHaveLength(0));
  });
});

describe('a Titan Reaver form with no Phantimal tagged for the season', () => {
  it('says so, since the heroes cannot bring one', async () => {
    const user = userEvent.setup();
    await renderRecords();
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(await screen.findByText(/No Phantimal is tagged for Season 8/)).toBeTruthy();
  });
});

describe('a Titan Reaver fight row', () => {
  it('shows the boss as its icon with the name as tooltip, and the damage short with the exact number as tooltip', async () => {
    await renderRecords();
    await screen.findByText('first try');
    const list = within(screen.getByRole('list', { name: 'Titan Reaver records' }));
    expect(list.queryByText('Fight 1')).toBeNull();
    expect(list.getByRole('group', { name: 'Fight 1' })).toBeTruthy();
    expect(list.getAllByRole('img', { name: 'Aegis' }).length).toBeGreaterThan(0);
    expect(list.getAllByTitle('Aegis').length).toBeGreaterThan(0);
    expect(list.getByTitle('1,200,000,000').textContent).toBe('1.2B');
  });
});
