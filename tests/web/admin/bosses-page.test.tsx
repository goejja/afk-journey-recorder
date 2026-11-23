// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BossesPage } from '../../../web/admin/BossesPage.js';

const boss = (name: string, cls: string | null, damageType: string | null, extra = {}) => ({ name, class: cls, damageType, source: 'import', handMade: false, attempts: 0, usedBy: '', uses: 0, ...extra });
let bosses: object[];
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  bosses = [
    boss('King Croaker', 'Mage', 'Magic', { usedBy: '3 Dream Hunt records, 1 Weekly default slot', uses: 4, attempts: 3 }),
    boss('Doomscourge', 'Warrior', 'Magic'),
    boss('Bare', null, null, { source: 'manual', handMade: true }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/bosses' && method === 'GET') return Response.json(bosses);
      if (url === '/api/bosses' && method === 'POST') return Response.json(boss(body.name, body.class, body.damageType, { source: 'manual' }), { status: 201 });
      if (url.startsWith('/api/bosses/') && method === 'PUT') return Response.json(boss(decodeURIComponent(url.slice(12)), body.class, body.damageType, { source: 'manual' }));
      if (url.startsWith('/api/bosses/') && method === 'DELETE') return Response.json({ error: 'King Croaker is used by 3 Dream Hunt records, so it cannot be deleted' }, { status: 409 });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('Bosses page', () => {
  it('lists the bosses and narrows them by search', async () => {
    const user = userEvent.setup();
    render(<BossesPage />);
    const list = await screen.findByRole('list', { name: 'Bosses' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['King CroakerMagic', 'DoomscourgeMagic', 'Bare']);
    await user.type(screen.getByLabelText('Search bosses'), 'doom');
    expect(within(list).getAllByRole('button')).toHaveLength(1);
  });

  it('shows what uses a boss and keeps its name, then saves a new class and damage type', async () => {
    const user = userEvent.setup();
    render(<BossesPage />);
    await user.click(await screen.findByRole('button', { name: /^King Croaker/ }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('3 Dream Hunt records, 1 Weekly default slot')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Class'), 'Rogue');
    await user.selectOptions(screen.getByLabelText('Damage type'), 'Physical');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    expect(requests.find((r) => r.method === 'PUT')).toMatchObject({ url: '/api/bosses/King%20Croaker', body: { name: 'King Croaker', class: 'Rogue', damageType: 'Physical' } });
  });

  it('says on an open boss whether the next import takes it over', async () => {
    const user = userEvent.setup();
    render(<BossesPage />);
    await user.click(await screen.findByRole('button', { name: /^Bare/ }));
    expect(screen.getByText(/Not on Yaphalla yet: the next import takes over its class and damage type/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Doomscourge/ }));
    expect(screen.getByText(/A change you save is kept: an import then leaves it alone/)).toBeTruthy();
  });

  it('adds a boss with no class, and says a picture comes from the Images tab', async () => {
    const user = userEvent.setup();
    render(<BossesPage />);
    await user.click(await screen.findByRole('button', { name: 'New boss' }));
    expect(screen.getByText(/no picture until you add one on the Images tab/)).toBeTruthy();
    await user.type(screen.getByLabelText('Name'), 'Gloomwing');
    await user.click(screen.getByRole('button', { name: 'Create boss' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ name: 'Gloomwing', class: null, damageType: null }));
  });

  it('shows why a delete was refused', async () => {
    const user = userEvent.setup();
    render(<BossesPage />);
    await user.click(await screen.findByRole('button', { name: /^King Croaker/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toBe('King Croaker is used by 3 Dream Hunt records, so it cannot be deleted');
  });
});
