// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormationIdsAdmin } from '../../../web/admin/FormationIdsAdmin.js';

const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: false, rank: null, equipmentLevel: null });
const board = { name: 'Arena I', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: Array.from({ length: 45 }, (_, i) => (i >= 38 ? 1 : 0)), source: 'import', canRestore: false };
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url === '/api/formation-ids' && method === 'GET') return Response.json([]);
      if (url === '/api/formation-ids' && method === 'POST') return Response.json({}, { status: 201 });
      if (url === '/api/maps') return Response.json([board]);
      if (url === '/api/heroes') return Response.json([hero('Alna'), hero('Phraesto')]);
      if (url === '/api/phantimals') return Response.json([]);
      if (url === '/api/artifacts') return Response.json([]);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('adding a Formation ID by hand', () => {
  it('needs a code and units, places a hero with its summon at once, and stores the deployment that was placed', async () => {
    const user = userEvent.setup();
    render(<FormationIdsAdmin />);
    await user.click(await screen.findByRole('button', { name: 'Add by hand' }));
    const add = (await screen.findByRole('button', { name: 'Add Formation ID' })) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    await user.type(screen.getByLabelText('Formation ID'), 'a1b2c3d4');
    expect((screen.getByLabelText('Formation ID') as HTMLInputElement).value).toBe('A1B2C3D4');
    const heroes = await screen.findByRole('list', { name: 'Heroes' });
    await user.click(within(heroes).getByRole('button', { name: /^Phraesto$/ })); // the clone comes with it
    expect(add.disabled).toBe(false);

    await user.click(within(heroes).getByRole('button', { name: /^Alna$/ }));
    await user.click(add);

    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/formation-ids')).toBe(true));
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.body.code).toBe('A1B2C3D4');
    expect(post.body.deployment.teams).toHaveLength(1);
    const [team] = post.body.deployment.teams;
    expect(team.units.map((u: any) => [u.hero, u.part])).toEqual([['Phraesto', ''], ['Phraesto', 'Phraesto clone'], ['Alna', '']]);
    expect(team.phantimal).toBeUndefined();
    expect(team.artifact).toBeNull();
  });

  it('stores several teams, in the order of their numbers, skipping a team left empty', async () => {
    const user = userEvent.setup();
    render(<FormationIdsAdmin />);
    await user.click(await screen.findByRole('button', { name: 'Add by hand' }));
    await user.type(await screen.findByLabelText('Formation ID'), 'zzzz9999');
    const heroes = await screen.findByRole('list', { name: 'Heroes' });
    await user.click(within(heroes).getByRole('button', { name: /^Alna$/ }));
    await user.click(screen.getByRole('button', { name: 'Add a team' }));
    await user.click(screen.getByRole('button', { name: 'Add a team' }));
    expect(screen.getByRole('button', { name: /^Team 3/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /^Phraesto$/ })); // with its clone
    await user.click(screen.getByRole('button', { name: 'Add Formation ID' }));

    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    const { teams } = requests.find((r) => r.method === 'POST')!.body.deployment;
    expect(teams.map((t: any) => t && t.units.map((u: any) => u.hero))).toEqual([['Alna'], null, ['Phraesto', 'Phraesto']]);
  });
});
