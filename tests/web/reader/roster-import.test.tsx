// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterImport } from '../../../web/reader/RosterImport.js';

const rules = { ranks: ['Epic', 'Supreme', 'Supreme+', 'Paragon 1'], equipmentLevels: [0, 5, 10, 15], caps: ['Supreme', 'Supreme+', 'Paragon 1'].map((rank) => ({ rank, minLevel: null, maxLevel: 15 })) };
const hero = (name: string) => ({ name, tier: 'S' as const, class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: false, rank: null, equipmentLevel: null });
const heroes = ['Evie', 'Thador', 'Valka', 'Nara'].map(hero);
const profiles = [
  { id: 1, name: 'Brin', playerId: null, isDefault: true, heroCount: 1 },
  { id: 2, name: 'Mokka', playerId: null, isDefault: false, heroCount: 0 },
];
const row = (tile: string, name: string, direction: 'new' | 'upgrade' | 'downgrade', to: { rank: string; equipmentLevel: number | null }, extra: object = {}) => ({
  tile, hero: name, direction, from: direction === 'new' ? { rank: null, equipmentLevel: null } : { rank: 'Supreme+', equipmentLevel: 5 }, to, selected: direction !== 'downgrade', check: [], reader: null, ...extra,
});
const section = (extra: object = {}) => ({
  index: 0,
  playerName: 'Мокка',
  profile: { id: 2, name: 'Mokka' },
  rename: 'Мокка',
  create: null,
  rows: [row('0.team1.0', 'Evie', 'new', { rank: 'Paragon 1', equipmentLevel: 10 }), row('0.team1.1', 'Thador', 'downgrade', { rank: 'Supreme', equipmentLevel: 5 }, { check: ['stars'] })],
  unknown: [{ tile: '0.team1.2', candidates: ['Valka', 'Nara'], rank: 'Supreme+' }],
  withoutRank: [],
  ...extra,
});

let state: any;
let requests: { method: string; url: string; body?: any; headers?: any }[];

beforeEach(() => {
  requests = [];
  state = { canRead: true, reason: null, busy: false, job: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const isJson = typeof init?.body === 'string';
      requests.push({ method, url, body: isJson ? JSON.parse(init!.body as string) : init?.body, headers: init?.headers });
      if (url === '/api/roster-import' && method === 'GET') return Response.json({ queue: state.job ? [{ id: state.job.id, label: null, state: state.job.state, screen: 'info' }] : [], ...state });
      if (url.startsWith('/api/roster-import?screen=') && method === 'POST') {
        state.job = { id: 1, state: 'done', screen: 'info', sections: [section()], chosen: {} };
        return Response.json({ id: 1, state: 'running', screen: 'info' }, { status: 202 });
      }
      if (url.endsWith('/choose')) {
        const body = JSON.parse(init!.body as string);
        return Response.json({
          sections: [section({ rows: [...section().rows, row('0.team1.2', 'Valka', 'new', { rank: 'Supreme+', equipmentLevel: null })], unknown: [] })],
          chosen: body.hero ? { '0.team1.2': body.hero } : {},
        });
      }
      if (url.endsWith('/target')) return Response.json(section({ profile: null, rename: null, create: 'Мокка' }));
      if (url.endsWith('/apply')) {
        state.job = null;
        return Response.json({ applied: [{ profileId: 2, created: false, changed: 1, looks: 0 }] });
      }
      if (method === 'DELETE') {
        state.job = null;
        return new Response(null, { status: 204 });
      }
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const open = (props: Partial<Parameters<typeof RosterImport>[0]> = {}) =>
  render(<RosterImport profile={profiles[0]!} profiles={profiles} heroes={heroes} rules={rules} onClose={() => {}} onApplied={() => {}} {...props} />);
const picture = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });

describe('Roster import', () => {
  it('cannot read a picture with an agent that has not been checked, and says why', async () => {
    state = { canRead: false, reason: 'The opencode agent has not been checked for reading pictures: choose another in Admin', busy: false, job: null };
    open();
    expect(await screen.findByText(/opencode agent has not been checked/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Read picture' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the picture with the chosen screen, from this app, and for the Hall names the profile on show', async () => {
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText(/Screenshots/), picture());
    await user.click(screen.getByLabelText('Resonating Hall'));
    await user.click(screen.getByRole('button', { name: 'Read picture' }));
    await screen.findByRole('group', { name: 'Heroes of Мокка' });
    const start = requests.find((r) => r.method === 'POST')!;
    expect(start.url).toMatch(/^\/api\/roster-import\?screen=hall&profile=1&name=/);
    expect(start.headers).toMatchObject({ 'x-afk-action': 'app', 'content-type': 'image/png' });
  });

  it('ticks new and upgraded heroes, not downgrades, and applies only the ticked rows with the rename', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'done', screen: 'info', sections: [section()], chosen: {} };
    open();
    const group = within(await screen.findByRole('group', { name: 'Heroes of Мокка' }));
    expect((group.getByLabelText('Apply Evie') as HTMLInputElement).checked).toBe(true);
    expect((group.getByLabelText('Apply Thador') as HTMLInputElement).checked).toBe(false);
    expect(group.getByText('check the stars')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    const apply = requests.find((r) => r.url.endsWith('/apply'))!;
    expect(apply.headers).toMatchObject({ 'x-afk-action': 'app' });
    expect(apply.body).toEqual({ sections: [{ profileId: 2, create: null, rename: 'Мокка', changes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 10, tile: '0.team1.0' }], looks: [] }] });
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved 1 hero.');
  });

  it('applies what the player corrected: the rank and the equipment of a row', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'done', screen: 'info', sections: [section()], chosen: {} };
    open();
    await user.selectOptions(await screen.findByLabelText('Rank of Evie'), 'Supreme');
    await user.selectOptions(screen.getByLabelText('Equipment of Evie'), '5');
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    expect(requests.find((r) => r.url.endsWith('/apply'))!.body.sections[0].changes).toEqual([{ hero: 'Evie', rank: 'Supreme', equipmentLevel: 5, tile: '0.team1.0' }]);
  });

  it('asks for a name before applying heroes to a new profile, and creates it without a Player ID', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'done', screen: 'info', sections: [section({ profile: null, rename: null, create: null, playerName: null })], chosen: {} };
    open();
    const apply = await screen.findByRole('button', { name: 'Apply 1 change' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('New profile name'), 'Nini');
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await user.click(apply);
    expect(requests.find((r) => r.url.endsWith('/apply'))!.body.sections[0]).toMatchObject({ profileId: null, create: 'Nini' });
  });

  it('lets the player name a tile the agent could not, and remember its look', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'done', screen: 'info', sections: [section()], chosen: {} };
    open();
    await user.selectOptions(await screen.findByLabelText('Which hero is this?'), 'Valka');
    expect(requests.find((r) => r.url.endsWith('/choose'))!.body).toEqual({ tile: '0.team1.2', hero: 'Valka' });
    expect(await screen.findByText('Heroes you named')).toBeTruthy();
    expect((screen.getByLabelText('Remember this look') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: /Apply 2 changes/ }));
    expect(requests.find((r) => r.url.endsWith('/apply'))!.body.sections[0].looks).toEqual(['0.team1.2']);
  });

  it('lets the player change the hero of a named row', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'done', screen: 'info', sections: [section()], chosen: {} };
    open();
    const row = (await screen.findAllByLabelText(/^Hero of tile /))[0]!;
    await user.selectOptions(row, 'Valka');
    expect(requests.find((r) => r.url.endsWith('/choose'))!.body).toEqual({ tile: (row as HTMLSelectElement).getAttribute('aria-label')!.replace('Hero of tile ', ''), hero: 'Valka' });
  });

  it('gives several pictures to the queue and shows the ones waiting', async () => {
    const user = userEvent.setup();
    state.job = null;
    open();
    const input = (await screen.findByLabelText(/Screenshots/)) as HTMLInputElement;
    await user.upload(input, [new File(['a'], 'IMG_1.png', { type: 'image/png' }), new File(['b'], 'IMG_2.png', { type: 'image/png' })]);
    await user.click(screen.getByRole('button', { name: 'Read 2 pictures' }));
    await waitFor(() => expect(requests.filter((r) => r.url.startsWith('/api/roster-import?screen=')).map((r) => decodeURIComponent(r.url.split('name=')[1]!))).toEqual(['IMG_1.png', 'IMG_2.png']));
  });

  it('lets the player go on to the next picture when nothing in it is ticked', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'done', screen: 'info', sections: [section({ rows: [], unknown: [] })], chosen: {} };
    open();
    const next = await screen.findByRole('button', { name: 'Nothing to change: next picture' });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    await user.click(next);
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/roster-import?keep=1')).toBe(true);
  });

  it('lists the other pictures of the queue beside the one under review', async () => {
    state.job = { id: 1, state: 'done', screen: 'info', label: 'IMG_1.png', sections: [section()], chosen: {} };
    (state as any).queue = [
      { id: 1, label: 'IMG_1.png', state: 'done', screen: 'info' },
      { id: 2, label: 'IMG_2.png', state: 'running', screen: 'info' },
      { id: 3, label: 'IMG_3.png', state: 'queued', screen: 'info' },
    ];
    open();
    expect(await screen.findByText('IMG_2.png: being read')).toBeTruthy();
    expect(screen.getByText('IMG_3.png: waiting')).toBeTruthy();
    expect(screen.getByText(/IMG_1.png \(1 of 3 pictures\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel the pictures not read yet' })).toBeTruthy();
  });

  it('shows a failed read and lets the player try another picture', async () => {
    const user = userEvent.setup();
    state.job = { id: 1, state: 'failed', screen: 'info', error: 'The agent did not reply with the players it read' };
    open();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The agent did not reply with the players it read');
    await user.click(screen.getByRole('button', { name: 'Try another picture' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Read picture' })).toBeTruthy());
  });
});
