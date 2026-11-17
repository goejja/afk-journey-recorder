// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterPage } from '../../../web/reader/RosterPage.js';

const hero = (name: string, owned: boolean, rank: string | null = null) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned, rank, equipmentLevel: null });
let profiles: any[];
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  profiles = [
    { id: 1, name: 'Me', playerId: null, isDefault: true, heroCount: 1 },
    { id: 2, name: 'Friend', playerId: '12345678', isDefault: false, heroCount: 1 },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === '/api/reference') return Response.json({ ranks: ['Epic', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/profiles' && method === 'GET') return Response.json(profiles);
      if (url === '/api/profiles' && method === 'POST') {
        const created = { id: 3, name: 'Twin', playerId: null, isDefault: false, heroCount: 1 };
        profiles = [...profiles, created];
        return Response.json(created, { status: 201 });
      }
      if (url.startsWith('/api/profiles/') && method === 'PUT') return Response.json(profiles[1]);
      if (url.endsWith('/default') && method === 'POST') return Response.json(profiles);
      if (url.startsWith('/api/profiles/') && method === 'DELETE') return new Response(null, { status: 204 });
      if (url === '/api/heroes?profile=1') return Response.json([hero('Evie', true, 'Mythic+'), hero('Fay', false)]);
      if (url === '/api/heroes?profile=3') return Response.json([hero('Evie', true, 'Mythic+'), hero('Fay', false)]);
      if (url === '/api/heroes?profile=2') return Response.json([hero('Evie', false), hero('Fay', true, 'Epic')]);
      if (url.startsWith('/api/roster/')) return new Response(null, { status: 204 });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const owned = () => screen.getAllByRole('article').filter((a) => a.classList.contains('owned')).map((a) => a.querySelector('.name')?.textContent);

describe('Roster page', () => {
  it('lists the profiles with the default starred and shows the default profile’s heroes first', async () => {
    render(<RosterPage />);
    const list = within(await screen.findByRole('list', { name: 'Profiles' }));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(2));
    const [me, friend] = list.getAllByRole('listitem');
    expect(within(me!).getByLabelText('Default')).toBeTruthy();
    expect(me!.textContent).toContain('1 heroes');
    expect(friend!.textContent).toContain('Friend');
    expect(friend!.textContent).toContain('ID 12345678');
    await waitFor(() => expect(owned()).toEqual(['Evie']));
    expect(screen.getByRole('heading', { name: /Me/ })).toBeTruthy();
  });

  it('shows another profile’s heroes when it is picked, and edits that profile’s roster', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await user.click(await screen.findByRole('button', { name: /Friend/ }));
    await waitFor(() => expect(owned()).toEqual(['Fay']));
    expect(requests.some((r) => r.url === '/api/heroes?profile=2')).toBe(true);
    await user.click(screen.getByTitle('Add to roster')); // Evie
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/roster/Evie?profile=2')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Reset roster' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST' && r.url === '/api/roster/reset?profile=2')).toBeTruthy());
  });

  it('patches the one hero and the count of its profile instead of reading the page again', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await user.click(await screen.findByRole('button', { name: /Friend/ }));
    await waitFor(() => expect(owned()).toEqual(['Fay']));
    const reads = () => requests.filter((r) => r.method === 'GET' && (r.url === '/api/profiles' || r.url.startsWith('/api/heroes'))).length;
    const before = reads();
    await user.click(screen.getByTitle('Add to roster')); // Evie
    await waitFor(() => expect(owned()).toEqual(['Evie', 'Fay']));
    expect(reads()).toBe(before);
    expect(within(screen.getByRole('list', { name: 'Profiles' })).getByRole('button', { name: /Friend/ }).textContent).toContain('2 heroes');
    await user.click(screen.getAllByTitle('Remove from roster')[0]!);
    await waitFor(() => expect(owned()).toEqual(['Fay']));
    expect(reads()).toBe(before);
    expect(within(screen.getByRole('list', { name: 'Profiles' })).getByRole('button', { name: /Friend/ }).textContent).toContain('1 heroes');
  });

  it('sets the equipment to the lowest level the new rank allows when a hero had none', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await waitFor(() => expect(owned()).toEqual(['Evie']));
    await user.click(screen.getByRole('button', { name: /Friend/ }));
    await waitFor(() => expect(owned()).toEqual(['Fay']));
    await user.click(screen.getByRole('button', { name: /Edit the rank and equipment/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mythic+' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/roster/Fay?profile=2')?.body).toMatchObject({ rank: 'Mythic+', equipmentLevel: 0 }));
  });

  it('offers in the editor only the ranks the tier allows and the equipment the rank allows, and saves a pick', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await waitFor(() => expect(owned()).toEqual(['Evie']));
    await user.click(screen.getByRole('button', { name: /Edit the rank and equipment/ })); // Evie's rank and equipment
    const editor = within(await screen.findByRole('dialog'));
    expect(editor.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mythic+', 'Epic', 'None', '+10 ★★★', '+0 ★', 'Close']);
    await user.click(editor.getByRole('button', { name: '+10 ★★★' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/roster/Evie?profile=1')?.body).toMatchObject({ rank: 'Mythic+', equipmentLevel: 10 }));
    expect(screen.getByRole('dialog')).toBeTruthy(); // stays open to change the other value
    await user.click(editor.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before removing a hero whose rank would be lost, and keeps it when the answer is no', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await waitFor(() => expect(owned()).toEqual(['Evie'])); // Evie is Mythic+
    await user.click(screen.getByTitle('Remove from roster'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Its rank will be lost.')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(requests.some((r) => r.method === 'DELETE' && r.url.startsWith('/api/roster/'))).toBe(false);
    expect(owned()).toEqual(['Evie']);
    await user.click(screen.getByTitle('Remove from roster'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'DELETE' && r.url === '/api/roster/Evie?profile=1')).toBeTruthy());
  });

  it('shows no rank or equipment on a hero that is not owned', async () => {
    render(<RosterPage />);
    await waitFor(() => expect(owned()).toEqual(['Evie']));
    const fay = screen.getAllByRole('article').find((a) => a.querySelector('.name')?.textContent === 'Fay')!;
    expect(within(fay).queryByRole('button', { name: /Edit the rank and equipment/ })).toBeNull();
  });

  it('creates a profile, optionally copying the heroes of another, and shows it', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await user.click(await screen.findByRole('button', { name: 'New profile' }));
    const form = within(screen.getByRole('form', { name: 'New profile' }));
    await user.type(form.getByLabelText('Name'), 'Twin');
    await user.selectOptions(form.getByLabelText('Copy heroes from'), 'Me');
    await user.click(form.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST' && r.url === '/api/profiles')?.body).toEqual({ name: 'Twin', playerId: null, copyFrom: 1 }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=3')).toBe(true)); // the new profile is selected
  });

  it('renames a profile, which has no tag field', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    await user.click(await screen.findByRole('button', { name: /Friend/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const form = within(screen.getByRole('form', { name: 'Edit profile' }));
    await user.clear(form.getByLabelText('Name'));
    await user.type(form.getByLabelText('Name'), 'Buddy');
    expect(form.queryByLabelText('Player tag')).toBeNull();
    await user.click(form.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/profiles/2')?.body).toEqual({ name: 'Buddy', playerId: '12345678' }));
  });

  it('shows the player ID of a profile and lets it be changed or cleared', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    expect(await screen.findByRole('button', { name: /Friend.*ID 12345678/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Friend/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const form = within(screen.getByRole('form', { name: 'Edit profile' }));
    expect((form.getByLabelText('Player ID') as HTMLInputElement).value).toBe('12345678');
    await user.clear(form.getByLabelText('Player ID'));
    await user.click(form.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/profiles/2')?.body).toEqual({ name: 'Friend', playerId: null }));
  });

  it('makes another profile the default and deletes a profile that is not, but never the default', async () => {
    const user = userEvent.setup();
    render(<RosterPage />);
    expect((await screen.findByRole('button', { name: 'Delete profile' }) as HTMLButtonElement).disabled).toBe(true); // Me is the default
    expect((screen.getByRole('button', { name: 'Set as default' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Friend/ }));
    await user.click(screen.getByRole('button', { name: 'Set as default' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/profiles/2/default')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Delete profile' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/profiles/2')).toBe(true));
  });
});
