// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from '../../../web/admin/AdminPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

let requests: { method: string; url: string; body?: any; headers?: Record<string, string> }[];
const seasons = [
  { number: 8, current: true, stages: 3, phantimals: 2, records: 0, tournaments: 0 },
  { number: 7, current: false, stages: 0, phantimals: 1, records: 0, tournaments: 0 },
  { number: 6, current: false, stages: 0, phantimals: 0, records: 0, tournaments: 0 },
];
const agent = { preset: 'claude', model: 'opus', timeoutMinutes: 10, presets: ['claude', 'opencode'], tools: {} };
let agentTools: Record<string, unknown>;
let statsModes: string[];
let counterRule: { winRate: number; minGames: number };

beforeEach(() => {
  requests = [];
  statsModes = ['Arena', 'Supreme Arena', 'Super League', 'Guild Duel'];
  counterRule = { winRate: 0.65, minGames: 5 };
  agentTools = {
    claude: { installed: true, path: '/opt/bin/claude', version: '2.1.308 (Claude Code)', models: ['opus', 'sonnet', 'haiku'] },
    opencode: { installed: false, path: null, version: null, models: null },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body, headers: init?.headers as Record<string, string> });
      if (url === '/api/seasons' && method === 'GET') return Response.json(seasons);
      if (url === '/api/seasons' && method === 'POST') return Response.json([{ number: 9, current: false, stages: 0, phantimals: 0, records: 0, tournaments: 0 }, ...seasons], { status: 201 });
      if (url === '/api/seasons/current' && method === 'PUT') return Response.json(seasons.map((s) => ({ ...s, current: s.number === 7 })));
      if (url === '/api/tags' && method === 'GET') return Response.json([{ tag: 'Luna', count: 3 }]);
      if (url.startsWith('/api/defaults/') && method === 'PUT') return Response.json({ 'Supreme Arena': { slots: JSON.parse(init!.body as string).slots, updatedAt: '2026-10-30 10:00:00' }, 'Super League': { slots: [], updatedAt: null }, 'Guild Duel': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
      if (url === '/api/defaults' && method === 'GET') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Guild Duel': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
      if (url === '/api/bosses') return Response.json([{ name: 'King Croaker', class: null, damageType: null, attempts: 0 }]);
      if (url === '/api/boss-rules' && method === 'GET') return Response.json([{ name: 'Berserk', description: '' }]);
      if (url === '/api/boss-rules' && method === 'POST') return Response.json({ name: 'Frenzy', description: '' }, { status: 201 });
      if (url === '/api/tags/Luna' && method === 'PUT') return Response.json({ name: 'Moon', records: 3 });
      if (url === '/api/tags/Luna' && method === 'DELETE') return Response.json({ removed: 3 });
      if (url === '/api/stats-settings') {
        const available = ['Stage', 'Dream Hunt', 'Arena', 'Supreme Arena', 'Super League', 'Guild Duel'];
        const defaults = available.slice(2);
        if (method === 'PUT') statsModes = JSON.parse(init!.body as string).modes;
        if (method === 'DELETE') statsModes = defaults;
        return Response.json({ modes: statsModes, defaults, available });
      }
      if (url === '/api/counter-rule') {
        if (method === 'PUT') counterRule = JSON.parse(init!.body as string);
        if (method === 'DELETE') counterRule = { winRate: 0.65, minGames: 5 };
        return Response.json({ ...counterRule, defaults: { winRate: 0.65, minGames: 5 } });
      }
      if (url === '/api/admin/restore') return Response.json({ restoredRows: 42, savedAs: 'data/backups/before-restore-x.db' });
      if (url === '/api/admin/agent' && method === 'GET') return Response.json(agent);
      if (url === '/api/admin/agent/refresh' && method === 'POST') return Response.json({ ...agent, tools: agentTools });
      if (url === '/api/admin/agent' && method === 'PUT') return Response.json({ ...(typeof init?.body === 'string' ? JSON.parse(init.body) : {}), presets: agent.presets, tools: {} });
      if (url === '/api/maps') return Response.json([
        { name: 'Arena I', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 1 : 0)), source: 'import', canRestore: false },
        { name: 'Arena II', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 1 : i === 20 ? -2 : 0)), source: 'import', canRestore: false },
        { name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: Array(45).fill(0), source: 'manual', canRestore: false },
      ]);
      if (url === '/api/phantimals' || url === '/api/images') return Response.json([]);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

/** `toasts` provides the toasts, for a tab that says how an action went in one; they are read from the page's status. */
const open = async (user: ReturnType<typeof userEvent.setup>, name: string, toasts = false) => {
  render(toasts ? <ToastProvider><AdminPage /></ToastProvider> : <AdminPage />);
  await user.click(screen.getByRole('tab', { name }));
};

describe('Admin page', () => {
  it('groups the upkeep sections', () => {
    render(<AdminPage />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Weekly default', 'Maps', 'Units', 'Artifacts', 'Images', 'Reader', 'Review', 'Database', 'Tags', 'Formation IDs', 'Rules', 'Agent']);
  });

  it('opens on General, lists the seasons, and protects the current one and the ones in use', async () => {
    render(<AdminPage />);
    const list = within(await screen.findByRole('list', { name: 'Seasons' }));
    const items = await list.findAllByRole('listitem');
    expect(items.map((i) => i.querySelector('strong')?.textContent)).toEqual(['Season 8', 'Season 7', 'Season 6']);
    expect(within(items[0]!).getByText('current')).toBeTruthy();
    expect((within(items[0]!).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(items[1]!).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true); // a phantimal names it
    expect((within(items[2]!).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sets the weekly Supreme Arena setup per team', async () => {
    const user = userEvent.setup();
    await open(user, 'Weekly default');
    const slots = within(await screen.findByRole('list', { name: 'Supreme Arena slots' }));
    expect(await slots.findAllByRole('listitem')).toHaveLength(3);
    for (const mode of ['Super League', 'Guild Duel', 'Dream Hunt']) expect(screen.getByRole('list', { name: `${mode} slots` })).toBeTruthy(); // every mode is shown
    await user.selectOptions(slots.getAllByLabelText('Rule')[0]!, 'Berserk');
    await user.click(within(screen.getByRole('region', { name: 'Supreme Arena' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/defaults/Supreme%20Arena')?.body.slots[0]).toEqual({ boss: null, mapName: null, rule: 'Berserk' }));
    expect(await screen.findByText(/Updated 2026-10-30/)).toBeTruthy();
  });

  it('picks the map of a team by its layout, from the maps of the right kind, and can leave it empty', async () => {
    const user = userEvent.setup();
    await open(user, 'Weekly default');
    const slots = within(await screen.findByRole('list', { name: 'Supreme Arena slots' }));
    expect(slots.getAllByRole('button', { name: 'Map: none' })).toHaveLength(3);
    await user.click(slots.getAllByRole('button', { name: 'Map: none' })[1]!);
    const list = within(screen.getByRole('group', { name: 'Map' }));
    expect(list.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? 'None')).toEqual(['None', 'Arena I', 'Arena II']); // a Stage map is not offered
    expect(screen.getByRole('group', { name: 'Map' }).querySelectorAll('svg')).toHaveLength(2); // each map drawn
    await user.click(list.getByRole('button', { name: 'Arena II' }));
    expect(screen.queryByRole('group', { name: 'Map' })).toBeNull();
    expect(slots.getByRole('button', { name: 'Map: Arena II' })).toBeTruthy();
    expect(slots.getAllByRole('listitem')[1]!.querySelector('svg')).toBeTruthy();
    await user.click(within(screen.getByRole('region', { name: 'Supreme Arena' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/defaults/Supreme%20Arena')?.body.slots[1]).toEqual({ boss: null, mapName: 'Arena II', rule: null }));
    await user.click(slots.getByRole('button', { name: 'Map: Arena II' }));
    await user.click(within(screen.getByRole('group', { name: 'Map' })).getByRole('button', { name: 'None' }));
    expect(slots.getAllByRole('button', { name: 'Map: none' })).toHaveLength(3);
  });

  it('adds a season and makes another the current one', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await user.type(await screen.findByLabelText('New season'), '9');
    await user.click(screen.getByRole('button', { name: 'Add season' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST' && r.url === '/api/seasons')?.body).toEqual({ number: 9 }));
    const seven = (await screen.findAllByRole('listitem')).find((i) => i.textContent?.includes('Season 7'))!;
    await user.click(within(seven).getByRole('button', { name: 'Make current' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/seasons/current')?.body).toEqual({ number: 7 }));
  });

  it('manages rules', async () => {
    const user = userEvent.setup();
    await open(user, 'Rules');
    await user.type(await screen.findByLabelText('Rule name'), 'Frenzy');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST' && r.url === '/api/boss-rules')?.body).toEqual({ name: 'Frenzy', description: '' }));
  });

  it('renames a tag and removes one after confirming', async () => {
    const user = userEvent.setup();
    await open(user, 'Tags', true);
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('New tag name');
    await user.clear(field);
    await user.type(field, 'Moon');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({ name: 'Moon' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Renamed Luna on 3 records/);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    let dialog = await screen.findByRole('dialog');
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/tags/Luna')).toBe(true));
  });

  it('chooses the modes the Statistics page starts with, and goes back to the PvP modes', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    const group = within(await screen.findByRole('group', { name: 'Statistics starts with these modes' }));
    expect((group.getByRole('checkbox', { name: 'Arena' }) as HTMLInputElement).checked).toBe(true);
    expect((group.getByRole('checkbox', { name: 'Stage' }) as HTMLInputElement).checked).toBe(false);
    await user.click(group.getByRole('checkbox', { name: 'Arena' }));
    await user.click(group.getByRole('checkbox', { name: 'Stage' }));
    await user.click(screen.getByRole('button', { name: 'Save modes' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/stats-settings')?.body).toEqual({ modes: ['Stage', 'Supreme Arena', 'Super League', 'Guild Duel'] }));
    await user.click(screen.getByRole('button', { name: 'Use the PvP modes' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/stats-settings')).toBe(true));
    await waitFor(() => expect((within(screen.getByRole('group', { name: 'Statistics starts with these modes' })).getByRole('checkbox', { name: 'Arena' }) as HTMLInputElement).checked).toBe(true));
  });

  it('sets when a Formation group counts as a counter, in percent, and goes back to the defaults', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    const rate = (await screen.findByLabelText(/Counter win rate/)) as HTMLInputElement;
    expect(rate.value).toBe('65');
    expect((screen.getByLabelText(/^Minimum games/) as HTMLInputElement).value).toBe('5');
    await user.clear(rate);
    await user.type(rate, '70');
    await user.clear(screen.getByLabelText(/^Minimum games/));
    await user.type(screen.getByLabelText(/^Minimum games/), '8');
    await user.click(screen.getByRole('button', { name: 'Save counter rule' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/counter-rule')?.body).toEqual({ winRate: 0.7, minGames: 8 }));
    await user.click(screen.getByRole('button', { name: 'Use the default rule' }));
    await waitFor(() => expect((screen.getByLabelText(/Counter win rate/) as HTMLInputElement).value).toBe('65'));
    expect((screen.getByLabelText(/^Minimum games/) as HTMLInputElement).value).toBe('5');
  });

  it('offers a backup download and restores a file only after confirming', async () => {
    const user = userEvent.setup();
    await open(user, 'Database');
    expect(screen.getByRole('link', { name: 'Download backup' }).getAttribute('href')).toBe('/api/admin/backup');
    const input = screen.getByLabelText('Backup file');
    const file = new File(['SQLite format 3\0'], 'afk-backup.db');

    fireEvent.change(input, { target: { files: [file] } });
    let dialog = await screen.findByRole('dialog');
    expect(requests.some((r) => r.url === '/api/admin/restore')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(requests.some((r) => r.url === '/api/admin/restore')).toBe(false);

    fireEvent.change(input, { target: { files: [file] } });
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/admin/restore')).toBe(true));
    expect(requests.find((r) => r.url === '/api/admin/restore')!.headers).toMatchObject({ 'x-afk-action': 'app' });
    expect((await screen.findByRole('status')).textContent).toMatch(/Restored 42 rows/);
  });
});

describe('Admin page, Agent tab', () => {
  it('looks for the agents by itself, and shows where the chosen one was found and its version', async () => {
    const user = userEvent.setup();
    await open(user, 'Agent');
    expect(await screen.findByText(/Found at \/opt\/bin\/claude, 2\.1\.308 \(Claude Code\)/)).toBeTruthy();
    const refresh = requests.find((r) => r.url === '/api/admin/agent/refresh')!;
    expect(refresh.method).toBe('POST');
    expect(refresh.headers).toMatchObject({ 'x-afk-action': 'app' });
    expect(screen.getByRole('option', { name: 'opencode (not installed)' })).toBeTruthy();
    expect(screen.queryByLabelText(/path/i)).toBeNull(); // there is no path to type
  });

  it('offers the models the tool lists, and saves the chosen agent, model and time limit', async () => {
    const user = userEvent.setup();
    await open(user, 'Agent', true);
    await screen.findByText(/Found at/);
    expect(Array.from(document.querySelectorAll('#agent-models option')).map((o) => o.getAttribute('value'))).toEqual(['opus', 'sonnet', 'haiku']);

    await user.clear(screen.getByLabelText('Model'));
    await user.type(screen.getByLabelText('Model'), 'sonnet');
    await user.clear(screen.getByLabelText('Time limit (minutes)'));
    await user.type(screen.getByLabelText('Time limit (minutes)'), '15');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/admin/agent')).toBeTruthy());
    expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ preset: 'claude', model: 'sonnet', timeoutMinutes: 15 });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('warns when the chosen agent is not installed', async () => {
    const user = userEvent.setup();
    await open(user, 'Agent');
    await screen.findByText(/Found at/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'opencode');
    expect((await screen.findByRole('alert')).textContent).toMatch(/opencode was not found on this computer's PATH/);
  });

  it('says why models could not be listed, and still lets one be typed', async () => {
    agentTools = { ...agentTools, claude: { installed: true, path: '/opt/bin/claude', version: '1', models: null, modelsError: 'not logged in' } };
    const user = userEvent.setup();
    await open(user, 'Agent');
    expect(await screen.findByText(/could not be listed: not logged in/)).toBeTruthy();
    expect(screen.getByLabelText('Model')).toBeTruthy();
  });
});
