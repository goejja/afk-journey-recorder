// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { ArenaPage } from '../../../web/arena/ArenaPage.js';
import { Battles } from '../../../web/arena/FightList.js';
import { api } from '../../../web/backend.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const formation = (names: string[]) => ({
  artifact: null, phantimal: null, assist: null,
  heroes: names.map((name, i) => ({ tile: 38 + i, name, rank: 'Mythic+', equipmentLevel: 10 })),
});
const opponent = { heroes: [{ tile: 0, name: 'Zed', rank: null, equipmentLevel: null }], assist: null, phantimal: null, artifact: null};
const battle: any = { id: 5, mode: 'Supreme Arena', createdAt: '2026-10-29', outcome: 'Win', note: null, mapName: 'Duel', rule: 'Berserk', tags: ['Luna'], playerIdA: null, playerIdB: null, battleId: null, battlePosition: null, formation: formation(['Evie']), opponent };

let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === '/api/maps') return Response.json([{ name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Fay'), hero('Zed'), hero('Zanie'), hero('Elijah & Lailah'), { ...hero('Lucca'), owned: false, rank: null, equipmentLevel: null }]);
      if (url === '/api/profiles') return Response.json([{ id: 1, name: 'Me', playerId: '1111', isDefault: true, heroCount: 3 }, { id: 2, name: 'Luna', playerId: '2222', isDefault: false, heroCount: 2 }, { id: 3, name: 'Kai', playerId: '3333', isDefault: false, heroCount: 1 }, { id: 4, name: 'Empty', playerId: null, isDefault: false, heroCount: 0 }]);
      if (url === '/api/heroes?profile=4') return Response.json([{ ...hero('Evie'), owned: false, rank: null, equipmentLevel: null }]);
      if (url === '/api/heroes?profile=2') return Response.json([{ ...hero('Evie'), rank: 'Elite', equipmentLevel: 0 }, { ...hero('Fay'), rank: 'Elite', equipmentLevel: 0 }, { ...hero('Zed'), owned: false, rank: null, equipmentLevel: null }]);
      if (url === '/api/heroes?profile=3') return Response.json([hero('Evie'), hero('Fay'), hero('Zed')]);
      if (url === '/api/profiles/4' && method === 'PUT') return Response.json({ id: 4, name: 'Empty', playerId: '4444', isDefault: false, heroCount: 0 });
      if (url.startsWith('/api/roster/') && method === 'PUT') return new Response(null, { status: 204 });
      if (url === '/api/artifacts') return Response.json([{ name: 'Bladestorm', group: 'Season 8' }, { name: 'Arc Burst', group: 'Season 7' }]);
      if (url === '/api/phantimals') {
        return Response.json([
          { name: 'Gervan', faction: 'Lightbearer', class: 'Mage', seasons: [8], source: 'import' },
          { name: 'Wedge of Matter', faction: 'Celestial-Hypogean', class: 'Support', seasons: [8], source: 'import' },
          { name: 'Wedge of Power', faction: 'Celestial-Hypogean', class: 'Support', seasons: [8], source: 'import' },
          { name: 'Olden', faction: 'Wilder', class: 'Tank', seasons: [7], source: 'import' },
        ]);
      }
      if (url === '/api/defaults') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Guild Duel': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
      if (url === '/api/boss-rules') return Response.json([{ name: 'Berserk', description: '' }]);
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/pvp/fights/5' && method === 'GET') return Response.json(battle);
      if (url === '/api/pvp/fights/99' && method === 'GET') return Response.json({ error: 'Record 99 no longer exists' }, { status: 404 });
      if (url.startsWith('/api/pvp/fights') && method === 'GET') return Response.json([battle]);
      if (url === '/api/pvp/battles' && method === 'POST') return Response.json({ id: 9, fights: [battle] }, { status: 201 });
      if (url.startsWith('/api/pvp/battles/') && method === 'PUT') return Response.json({ id: 4, fights: [battle] });
      if (url === '/api/pvp/fights' && method === 'POST') return Response.json(battle, { status: 201 });
      if (url.startsWith('/api/pvp/fights/') && method === 'PUT') return Response.json(battle);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const placeFirstHero = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  const list = within(screen.getByRole('list', { name: 'Side A heroes' }));
  await user.click(list.getByRole('button', { name: name })); // a click places it on the first free tile
};

/** The Phantimal of the visible side is picked from a grid of portraits; the ones the team cannot field are disabled. */
const phantimalPicker = () => within(screen.getByRole('list', { name: 'Phantimal' }));
const phantimalButtons = () =>
  phantimalPicker()
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-label') !== 'No Phantimal');
const fieldablePhantimals = () => phantimalButtons().filter((button) => !(button as HTMLButtonElement).disabled).map((button) => button.getAttribute('aria-label'));

describe('Arena page', () => {
  it('says Loading… until the first answer, then the empty sentence, and another one when a filter matches nothing', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    let answer!: (battles: unknown[]) => void;
    const held = new Promise<unknown[]>((resolve) => (answer = resolve));
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.startsWith('/api/pvp/fights') || (init?.method ?? 'GET') !== 'GET') return base(url, init);
        if (!first) return Response.json([]);
        first = false;
        return Response.json(await held);
      }),
    );
    const user = userEvent.setup();
    render(<ArenaPage />);
    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No records yet.')).toBeNull(); // not before the answer
    answer([]);
    expect(await screen.findByText('No records yet.')).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: 'Player' }), 'Luna');
    expect(await screen.findByText('No records match these filters.')).toBeTruthy();
    expect(screen.queryByText('No records yet.')).toBeNull();
  });

  it('says only why when the first load failed, not that nothing is recorded', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/pvp/fights') && (init?.method ?? 'GET') === 'GET' ? Response.json({ error: 'Network down' }, { status: 500 }) : base(url, init))));
    render(<ArenaPage />);
    expect((await screen.findByRole('alert')).textContent).toBe('Network down');
    expect(screen.queryByText('No records yet.')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('searches the battles by Player name or ID', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.type(await screen.findByRole('searchbox', { name: 'Player' }), 'Luna');
    await waitFor(() => expect(requests.some((r) => r.method === 'GET' && r.url.includes('/api/pvp/fights') && r.url.includes('player=Luna'))).toBe(true));
  });

  it('asks for the battles of a Player once after the typing stops, not on every keystroke', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    const search = await screen.findByRole('searchbox', { name: 'Player' });
    const asked = () => requests.filter((r) => r.method === 'GET' && r.url.startsWith('/api/pvp/fights') && r.url.includes('player='));
    await user.type(search, 'Lunaperez1'); // 10 keystrokes, each well inside the wait
    expect((search as HTMLInputElement).value).toBe('Lunaperez1'); // the input itself is not held back
    await waitFor(() => expect(asked().some((r) => r.url.includes('player=Lunaperez1'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 400)); // nothing more is coming
    expect(asked().map((r) => r.url)).toHaveLength(1);
  });

  it('does not ask again when the Player text only gains a space', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    const search = await screen.findByRole('searchbox', { name: 'Player' });
    const asked = () => requests.filter((r) => r.method === 'GET' && r.url.startsWith('/api/pvp/fights') && r.url.includes('player=Luna'));
    await user.type(search, 'Luna');
    await waitFor(() => expect(asked()).toHaveLength(1));
    await user.type(search, ' ');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(asked()).toHaveLength(1);
  });

  it('offers every hero for a battle, not only the ones in the roster', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    const yours = within(screen.getByRole('list', { name: 'Side A heroes' }));
    expect(yours.getByRole('button', { name: /^Lucca/ })).toBeTruthy();
  });

  it('names a placed hero in the tile tooltip', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    expect(within(screen.getByRole('group', { name: 'Battle map' })).getByRole('tooltip').textContent).toBe('Evie');
  });

  it('places a hero dragged from the icons onto a tile of its side', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    const icon = within(screen.getByRole('list', { name: 'Side A heroes' })).getByRole('button', { name: /^Evie/ });
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k], effectAllowed: '' };
    const map = within(screen.getByRole('group', { name: 'Battle map' }));
    fireEvent.dragStart(icon, { dataTransfer });
    // A tile of the other side refuses the drop and says why.
    fireEvent.drop(map.getAllByRole('button', { name: /Enemy deployment/ })[0]!.parentElement!, { dataTransfer });
    expect(screen.getByText(/drop it on the player \(A\) tiles/)).toBeTruthy();
    fireEvent.dragStart(icon, { dataTransfer });
    fireEvent.drop(map.getAllByRole('button', { name: /Player deployment/ })[0]!.parentElement!, { dataTransfer });
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).getByText('Evie')).toBeTruthy();
  });

  it('places a clicked icon on the first free tile of the side being edited, without a second click', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    const map = within(screen.getByRole('group', { name: 'Battle map' }));
    const cellOf = (button: HTMLElement) => button.parentElement!;
    const tooltipCells = () => map.getAllByRole('tooltip').map((t) => t.parentElement);
    await placeFirstHero(user, /^Evie/);
    await placeFirstHero(user, /^Lucca/);
    const [first, second] = map.getAllByRole('button', { name: /Player deployment/ });
    expect(tooltipCells()).toEqual([cellOf(first!), cellOf(second!)]);
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    expect(tooltipCells()).toContain(cellOf(map.getAllByRole('button', { name: /Enemy deployment/ })[0]!));
    expect(within(screen.getByRole('list', { name: 'Placed on Side B' })).getByText('Zed')).toBeTruthy();
  });

  it('moves a placed hero to another tile of its own side by dragging it', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: '' };
    const map = within(screen.getByRole('group', { name: 'Battle map' }));
    const cellOf = (button: HTMLElement) => button.parentElement!;
    const [from, to] = map.getAllByRole('button', { name: /Player deployment/ });
    expect(map.getByRole('tooltip').parentElement).toBe(cellOf(from!));
    fireEvent.dragStart(from!, { dataTransfer });
    fireEvent.drop(cellOf(map.getAllByRole('button', { name: /Enemy deployment/ })[0]!), { dataTransfer }); // the other side refuses it
    expect(map.getByRole('tooltip').parentElement).toBe(cellOf(from!));
    fireEvent.dragStart(from!, { dataTransfer });
    fireEvent.drop(cellOf(to!), { dataTransfer });
    expect(map.getByRole('tooltip').parentElement).toBe(cellOf(to!));
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('swaps two heroes of the same side when one is dragged onto the other, never with the other side, and shows the dragged hero’s side', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await placeFirstHero(user, /^Fay/);
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!); // edit Side B
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: '' };
    const map = within(screen.getByRole('group', { name: 'Battle map' }));
    const tileOf = (name: string) => map.getAllByRole('tooltip').find((t) => t.textContent === name)!.parentElement!.querySelector('button')!;
    const [eviePlace, fayPlace] = [tileOf('Evie'), tileOf('Fay')];
    fireEvent.dragStart(eviePlace, { dataTransfer });
    expect(screen.getByRole('list', { name: 'Side A heroes' })).toBeTruthy(); // the selector followed the dragged hero to Side A
    fireEvent.drop(tileOf('Zed').parentElement!, { dataTransfer }); // a unit of the other side: nothing happens
    expect(tileOf('Evie')).toBe(eviePlace);
    fireEvent.dragStart(eviePlace, { dataTransfer });
    fireEvent.drop(fayPlace.parentElement!, { dataTransfer });
    expect(tileOf('Evie')).toBe(fayPlace);
    expect(tileOf('Fay')).toBe(eviePlace);
  });

  it('offers the season’s Phantimal beside the team, and only the ones its faction lets it bring', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    const options = () => fieldablePhantimals();
    expect((screen.getByLabelText('Phantimal season') as HTMLSelectElement).value).toBe('8');
    expect(options()).toEqual([]); // no heroes yet, so no Faction Requirement is met
    // the season's Phantimals are on show, greyed out until their faction is there
    expect(phantimalButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['Gervan', 'Wedge of Matter']);
    // three Wilder heroes bring Olden (Wilder, season 7), never Gervan (Lightbearer)
    await placeFirstHero(user, /^Evie/);
    await placeFirstHero(user, /^Fay/);
    await placeFirstHero(user, /^Zed/);
    expect(options()).toEqual([]);
    await user.selectOptions(screen.getByLabelText('Phantimal season'), '7');
    expect(options()).toEqual(['Olden']);
    expect(screen.queryByRole('button', { name: 'Choose assist hero' })).toBeNull();
  });

  it('adds the chosen Phantimal to each side as soon as its faction is there, and sends it with the battle', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await user.selectOptions(screen.getByLabelText('Phantimal season'), '7');
    await placeFirstHero(user, /^Evie/);
    await placeFirstHero(user, /^Fay/);
    await placeFirstHero(user, /^Zed/);
    await user.click(phantimalPicker().getByRole('button', { name: 'Olden' })); // placed on the first free tile by itself
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).getByText('Olden')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    for (const name of [/^Evie/, /^Fay/, /^Zed/]) await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name }));
    await user.click(phantimalPicker().getByRole('button', { name: 'Olden' }));
    await user.click(screen.getByRole('button', { name: 'Save records' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST')!.body;
    expect(sent.fights[0].formation.phantimal).toEqual({ tile: 41, name: 'Olden' });
    expect(sent.fights[0].opponent.phantimal).toEqual({ tile: 3, name: 'Olden' });
  });

  it('removes the Phantimal with the third hero of its faction, and brings it back with it', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await user.selectOptions(screen.getByLabelText('Phantimal season'), '7');
    for (const name of [/^Evie/, /^Fay/, /^Zed/]) await placeFirstHero(user, name);
    await user.click(phantimalPicker().getByRole('button', { name: 'Olden' }));
    const placed = () => within(screen.getByRole('list', { name: 'Placed on Side A' }));
    expect(placed().getByText('Olden')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove Zed' })); // the third Wilder goes
    expect(placed().queryByText('Olden')).toBeNull();
    await placeFirstHero(user, /^Zed/); // and with it back the Phantimal returns by itself
    expect(placed().getByText('Olden')).toBeTruthy();
  });

  it('places the two Celestial wedges together, the second on the next free tile', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    const celestial = ['Senea', 'Rolan', 'Lucca'].map((name) => ({ ...hero(name), faction: 'Celestial' }));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url === '/api/heroes' ? Response.json(celestial) : base(url, init))));
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    for (const name of [/^Senea/, /^Rolan/, /^Lucca/]) await placeFirstHero(user, name);
    const map = () => within(screen.getByRole('group', { name: 'Battle map' }));
    await user.click(phantimalPicker().getByRole('button', { name: 'Wedge of Matter' }));
    expect(screen.queryByText(/still has to be placed/)).toBeNull();
    expect(map().getByTitle('Wedge of Matter')).toBeTruthy();
    expect(map().getByTitle('Wedge of Power')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Senea/ }));
    await user.click(screen.getByRole('button', { name: 'Save records' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST')!.body;
    expect(sent.fights[0].formation.phantimal).toEqual({ name: 'Wedge of Matter', tile: 41, partnerTile: 42 });
  });

  it('keeps the teams after "Save and record another", resetting only the winner', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Winner' })).getByLabelText('Side B'));
    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    await waitFor(() => expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1));
    expect(requests.find((r) => r.method === 'POST')!.body.outcome).toBe('Loss');
    expect((await screen.findByRole('status')).textContent).toMatch(/Saved 1 record/);
    expect(within(screen.getByRole('group', { name: 'Winner' })).getByLabelText<HTMLInputElement>('Side A').checked).toBe(true);
    expect(screen.getByRole('tab', { name: /Side A \(1\/5\)/ })).toBeTruthy(); // still placed

    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    await waitFor(() => expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2));
    expect(requests.filter((r) => r.method === 'POST')[1]!.body).toMatchObject({ outcome: 'Win' });
  });

  it('shows only the form while recording, with Save and Cancel in the same bar as the result', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(screen.queryByRole('heading', { name: 'Arena' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Battles' })).toBeNull();
    const bar = document.querySelector('.workspace-bar') as HTMLElement;
    expect(within(bar).getByRole('group', { name: 'Winner' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Save record' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(bar).getByLabelText('Note')).toBeTruthy();
  });

  it('shows each side’s artifact in an empty tile of the map, chosen from an overlay', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    const slots = () => document.querySelectorAll('.map-slot .hex-slot');
    expect(slots()).toHaveLength(2);
    expect([...slots()].every((s) => s.classList.contains('hex-slot-empty'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Choose Side A artifact' }));
    expect(screen.getByRole('dialog', { name: 'Side A artifact' })).toBeTruthy();
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    expect(screen.queryByLabelText(/Artifact level/)).toBeNull(); // a PvP battle does not ask for the level
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.hex-slot-a:not(.hex-slot-empty)')).toBeTruthy();
    expect(document.querySelector('.hex-slot-b.hex-slot-empty')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Choose Side B artifact' }));
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    expect(screen.queryByLabelText(/Artifact level/)).toBeNull();
    await user.keyboard('{Escape}');
    expect(document.querySelector('.hex-slot-b:not(.hex-slot-empty)')).toBeTruthy();
  });

  it('edits the rank and equipment of a hero clicked on the map, on either side', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!); // selects the placed hero
    await user.click(within(screen.getByRole('group', { name: 'Rank of Zed' })).getByRole('button', { name: 'Mythic+' }));
    await user.click(within(screen.getByRole('group', { name: 'Equipment of Zed' })).getByRole('button', { name: /^\+10/ })); // the Popover stays open after a pick
    // Clicking the A hero switches sides and selects it.
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Evie|Player deployment/ })[0]!);
    expect(screen.getByRole('tab', { name: /Side A/ }).getAttribute('aria-selected')).toBe('true');
    await user.click(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: 'Elite' }));
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST')!.body;
    expect(sent.opponent.heroes[0]).toMatchObject({ hero: 'Zed', rank: 'Mythic+', equipmentLevel: 10 });
    expect(sent.formation.heroes[0]).toMatchObject({ hero: 'Evie', rank: 'Elite' });
  });

  it('gives a side the profile’s rank and equipment, for heroes already placed and placed later', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/); // on None a recorded hero has no rank: any player's match
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '2');
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=2')).toBe(true));
    await user.click(within(screen.getByRole('list', { name: 'Side A heroes' })).getByRole('button', { name: /^Fay/ })); // placed after
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    expect((screen.getByLabelText('Profile of Side B') as HTMLSelectElement).value).toBe(''); // each side on its own
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST')!.body;
    expect(sent.formation.heroes).toEqual([
      { tile: 38, hero: 'Evie', rank: 'Elite', equipmentLevel: 0 },
      { tile: 39, hero: 'Fay', rank: 'Elite', equipmentLevel: 0 },
    ]);
    expect(sent.opponent.heroes[0]).toMatchObject({ hero: 'Zed', rank: null, equipmentLevel: null });
  });

  it('can give Side B a profile too, and keeps a rank set by hand', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    await user.selectOptions(screen.getByLabelText('Profile of Side B'), '3');
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=3')).toBe(true));
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    await user.click(screen.getByRole('tab', { name: /Side A/ }));
    await placeFirstHero(user, /^Evie/);
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '2');
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=2')).toBe(true));
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Evie|Player deployment/ })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: 'Mythic+' })); // set by hand afterwards
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/fights')!.body;
    expect(sent.opponent.heroes[0]).toMatchObject({ hero: 'Zed', rank: 'Mythic+', equipmentLevel: 10 });
    expect(sent.formation.heroes[0]).toMatchObject({ hero: 'Evie', rank: 'Mythic+' });
  });

  it('gives the profile’s Player ID to its side, and takes it off when the profile changes or is cleared', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '2');
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '3'); // Luna's Player ID goes, Kai's comes
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    await user.click(within(screen.getByRole('list', { name: 'Side B heroes' })).getByRole('button', { name: /^Zed/ }));
    await user.selectOptions(screen.getByLabelText('Profile of Side B'), '2');
    await user.selectOptions(screen.getByLabelText('Profile of Side B'), ''); // None: the Player ID goes
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toBe(true));
    const sent = requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/fights')!.body;
    expect(sent.playerIdA).toBe('3333');
    expect(sent.playerIdB ?? null).toBeNull();
    expect(sent.tags ?? []).toEqual([]); // a Profile no longer adds a tag
  });

  it('asks for the Player ID of a side’s profile that has none, and records it with the side', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    expect(screen.queryByRole('group', { name: 'Player ID of Side A' })).toBeNull(); // no profile yet
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '4');
    const prompt = screen.getByRole('group', { name: 'Player ID of Side A' });
    expect(prompt.textContent).toContain('will not remember');
    await user.type(within(prompt).getByLabelText('Player ID of Side A'), '4444');
    await user.click(within(prompt).getByRole('button', { name: 'Set Player ID' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/profiles/4')?.body).toEqual({ playerId: '4444' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Player ID of Side A' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toBe(true));
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/fights')!.body.playerIdA).toBe('4444');
  });

  it('changes the reference through patchReference and never on the prop the page was given', async () => {
    const [maps, heroes, artifacts, rules, heroRules, phantimals, defaults, profiles] = await Promise.all([api.maps(), api.heroes(), api.artifacts(), api.bossRules(), api.rules(), api.phantimals(), api.defaults(), api.profiles()]);
    const reference = Object.freeze({ maps, heroes, artifacts, rules, heroRules, phantimals, defaults, profiles: Object.freeze(profiles) as typeof profiles }); // writing to it throws
    const patchReference = vi.fn();
    const user = userEvent.setup();
    render(<Battles reference={reference} patchReference={patchReference} />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '4');
    const prompt = screen.getByRole('group', { name: 'Player ID of Side A' });
    await user.type(within(prompt).getByLabelText('Player ID of Side A'), '4444');
    await user.click(within(prompt).getByRole('button', { name: 'Set Player ID' }));
    await waitFor(() => expect(patchReference).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull(); // no "read only" failure from assigning to the prop
    const change = patchReference.mock.calls[0]![0] as (old: typeof reference) => { profiles: { id: number; playerId: string | null }[] };
    expect(change(reference).profiles.find((p) => p.id === 4)?.playerId).toBe('4444'); // computed from the reference as it is when applied
    expect(reference.profiles.find((p) => p.id === 4)?.playerId).toBeNull();
  });

  it('keeps the roster of the profile chosen last when the answer for the one chosen before arrives late', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url === '/api/heroes?profile=2' ? (await held, base(url, init)) : base(url, init)))); // Luna's roster is Elite +0
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '2'); // slow
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '3'); // Kai's roster is Mythic+ +10, answered at once
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=3')).toBe(true));
    await act(async () => {
      release();
      await held;
    });
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toBe(true));
    expect(requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/fights')!.body.formation.heroes).toEqual([{ tile: 38, hero: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }]);
  });

  it('keeps the count of waiting pictures from the newest read when an older one answers last', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    const queue = (n: number) => ({ queue: Array.from({ length: n }, (_, i) => ({ id: i + 1, state: 'queued' })), profiles: [], rulesVersion: 0 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.startsWith('/api/roster-import')) return base(url, init);
        reads += 1;
        if (reads === 1) return (await held, Response.json(queue(0))); // the read made when the page opened, answered last
        return Response.json(queue(2));
      }),
    );
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' })); // no read while the form is open
    await user.click(await screen.findByRole('button', { name: 'Cancel' })); // the list again: a newer read, 2 waiting
    expect(await screen.findByText(/2 waiting/)).toBeTruthy();
    await act(async () => {
      release();
      await held;
    });
    expect(screen.getByText(/2 waiting/)).toBeTruthy();
  });

  it('asks to update the profile’s roster after saving a new battle, and applies the ticked upgrades', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '2'); // roster: Evie Elite +0
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=2')).toBe(true));
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Evie|Player deployment/ })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: 'Mythic+' })); // an upgrade
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    const dialog = await screen.findByRole('dialog', { name: /^Update the roster/ });
    expect((within(dialog).getByLabelText('Update Evie') as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Update roster' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT' && r.url.startsWith('/api/roster/Evie'))).toBe(true));
    expect(requests.find((r) => r.method === 'PUT' && r.url.startsWith('/api/roster/Evie'))!.url).toContain('profile=2');
  });

  it('tells the owner on the list that the battle was saved but the roster could not be updated, when a plain Save closes the form', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    // the profile's roster loads when the profile is chosen, and fails when it is read again after the save
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const saved = requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights');
        if (url === '/api/heroes?profile=2' && saved) return Response.json({ error: 'Network down' }, { status: 500 });
        return base(url, init);
      }),
    );
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.selectOptions(screen.getByLabelText('Profile of Side A'), '2');
    await waitFor(() => expect(requests.some((r) => r.url === '/api/heroes?profile=2')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Saved\. The roster could not be updated: .*Network down/);
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull(); // the form has closed
    expect(requests.filter((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'New record' }));
    expect(screen.queryByRole('alert')).toBeNull(); // opening a form clears it
  });

  it('does not ask about the roster when the sides have no profile', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/pvp/fights')).toBe(true));
    expect(screen.queryByRole('dialog', { name: /^Update the roster/ })).toBeNull();
  });

  it('clones only one side of a fight with Clone A or Clone B', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    expect(screen.queryByRole('button', { name: /Sync roster/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Clone A' }));
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).getByText('Evie')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Placed on Side B' })).queryByText('Zed')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Clone B' }));
    expect(within(screen.getByRole('list', { name: 'Placed on Side B' })).getByText('Zed')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).queryByText('Evie')).toBeNull();
  });

  it('has no Rules tab: rules are managed in Admin', async () => {
    render(<ArenaPage />);
    await screen.findByRole('button', { name: 'New record' });
    expect(screen.queryByRole('tab', { name: 'Rules' })).toBeNull();
  });

  it('names the winner by side', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(screen.getByRole('group', { name: 'Winner' })).toBeTruthy();
    expect(screen.getByText('Side A', { selector: '.side-banner' })).toBeTruthy();
  });

  it('keeps a hero when its tile is clicked, and removes it only with its button', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/);
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Player deployment/ })[0]!);
    const placed = within(screen.getByRole('list', { name: 'Placed on Side A' }));
    expect(placed.getByText('Evie')).toBeTruthy();
    await user.click(placed.getByRole('button', { name: 'Remove Evie' }));
    expect(screen.getByRole('tab', { name: /Side A \(0\/5\)/ })).toBeTruthy();
    expect((within(screen.getByRole('list', { name: 'Side A heroes' })).getByRole('button', { name: /^Evie/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows one map for both sides, and a Side A / Side B switch for whose heroes the icons place', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(screen.getAllByRole('group', { name: /map/i })).toHaveLength(1);
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('tab', { name: /Side B/ }));
    const theirs = within(screen.getByRole('list', { name: 'Side B heroes' }));
    await user.click(theirs.getByRole('button', { name: /^Evie/ })); // a hero may be on both sides
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!);
    expect(screen.getByRole('tab', { name: /Side A \(1\/5\)/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Side B \(1\/5\)/ })).toBeTruthy();
  });

  it('clears an artifact with None from the overlay', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(screen.queryByRole('button', { name: 'Choose artifact' })).toBeNull(); // the artifact is no longer in the hero panel
    await user.click(screen.getByRole('button', { name: 'Choose Side B artifact' }));
    expect(screen.queryByRole('button', { name: 'Clear Side B artifact' })).toBeNull();
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    await user.click(screen.getByRole('button', { name: 'Clear Side B artifact' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.hex-slot-b.hex-slot-empty')).toBeTruthy();
  });

  it('opens the artifacts on the current season and the pre-season, and All lists every one', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    const artifacts = () => within(screen.getByRole('list', { name: 'Artifacts' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    for (const side of ['A', 'B']) {
      await user.click(screen.getByRole('button', { name: `Choose Side ${side} artifact` }));
      expect(artifacts()).toEqual(['Bladestorm']);
      await user.selectOptions(screen.getByLabelText('Group of Artifacts'), 'All');
      expect(artifacts()).toEqual(['Bladestorm', 'Arc Burst']);
      await user.selectOptions(screen.getByLabelText('Group of Artifacts'), 'Season 7');
      expect(artifacts()).toEqual(['Arc Burst']);
      await user.click(screen.getByRole('button', { name: 'Done' }));
    }
  });

  it('switches to Side B when an enemy tile is clicked', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(screen.getByRole('tab', { name: /Side A/ }).getAttribute('aria-selected')).toBe('true');
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!);
    expect(screen.getByRole('tab', { name: /Side B/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('narrows the icons by faction and name', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.type(screen.getByLabelText('Search Side A heroes'), 'lucc');
    const list = within(screen.getByRole('list', { name: 'Side A heroes' }));
    expect(list.getAllByRole('button')).toHaveLength(1);
    expect(list.getByRole('button', { name: /^Lucca/ })).toBeTruthy();
  });

  it('lists battles with their mode, map and rule', async () => {
    render(<ArenaPage />);
    expect(await screen.findByText(/Duel · Berserk/)).toBeTruthy();
    const chip = screen.getByRole('img', { name: 'Supreme Arena' });
    expect(chip.textContent).toBe('SA'); // the initials in a chip; the name is its label
    expect(chip.className).toContain('mode-chip');
  });

  it('boxes the winning team instead of naming the winner', async () => {
    render(<ArenaPage />);
    await screen.findByText(/Duel · Berserk/);
    expect(screen.getByLabelText('Side A (won)').className).toContain('team-won');
    expect(screen.getByLabelText('Side B (lost)').className).toContain('team-lost');
    expect(screen.queryByText('Side A won')).toBeNull();
  });

  it('shows the map of a battle on demand with its units, and hides it again', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Show map' }));
    const map = await screen.findByRole('group', { name: 'Map of battle 5' });
    expect(within(map).getByLabelText(/^Tile 39:/)).toBeTruthy();
    expect(within(map).getAllByRole('tooltip').map((t) => t.textContent).sort()).toEqual(['Evie', 'Zed']);
    await user.click(screen.getByRole('button', { name: 'Hide map' }));
    expect(screen.queryByRole('group', { name: 'Map of battle 5' })).toBeNull();
  });

  it('keeps the heroes and what was set when the map changes, moving those off a deployment tile', async () => {
    const user = userEvent.setup();
    const shifted = cells.map((_, i) => (i >= 40 ? TILE.PLAYER : i < 5 ? TILE.ENEMY : TILE.OPEN)); // our zone starts at tile 40
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      url === '/api/maps'
        ? Response.json([
            { name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false },
            { name: 'Shifted', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: shifted, source: 'manual', canRestore: false },
          ])
        : base(url, init)));
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await placeFirstHero(user, /^Evie/); // tile 38 on Duel
    await user.selectOptions(screen.getByLabelText('Map'), 'Shifted');
    const evie = (await screen.findAllByRole('tooltip')).filter((t) => t.textContent === 'Evie');
    expect(evie.length).toBe(1);
    expect(evie[0]!.closest('.hex-cell')!.querySelector('button')!.getAttribute('aria-label')).toBe('Tile 41: Player deployment'); // the first free player tile of the new map
  });

  it('asks for the Union Level of each side in Guild Duel only, and sends it with every team', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    expect(screen.queryByLabelText('Side A Union Level')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Mode'), 'Guild Duel');
    await user.type(screen.getByLabelText('Side A Union Level'), '42');
    await user.type(screen.getByLabelText('Side B Union Level'), '38');
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('button', { name: 'Save records' }));
    await waitFor(() => expect(requests.find((r) => r.url === '/api/pvp/battles')).toBeTruthy());
    const sent = requests.find((r) => r.url === '/api/pvp/battles')!.body;
    expect(sent.mode).toBe('Guild Duel');
    expect(sent.fights[0]).toMatchObject({ unionLevel: 42, opponentUnionLevel: 38, rule: null });
  });

  it('shows the Union Levels in the recap of a Guild Duel fight', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/pvp/fights') && (init?.method ?? 'GET') === 'GET' ? Response.json([{ ...battle, mode: 'Guild Duel', rule: null, unionLevel: 42, opponentUnionLevel: null }]) : base(url, init))));
    render(<ArenaPage />);
    expect((await screen.findByText('Union A 42 · B ?')).title).toBe('Union Level of each side');
  });

  it('clones a fight into a new battle with the same units, ranks and tags, and the result and note reset', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Clone' }));
    expect(screen.getByRole('heading', { name: 'New record' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Placed on Side A' })).getByText('Evie')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Placed on Side B' })).getByText('Zed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save records' }));
    await waitFor(() => expect(requests.find((r) => r.url === '/api/pvp/battles')).toBeTruthy());
    const sent = requests.find((r) => r.url === '/api/pvp/battles')!.body;
    expect(sent.mode).toBe('Supreme Arena');
    expect(sent.fights).toHaveLength(1); // only the cloned team has heroes
    expect(sent.fights[0]).toMatchObject({
      position: 1, mapName: 'Duel', rule: 'Berserk', outcome: 'Win', note: '', tags: ['Luna'],
      formation: { heroes: [{ tile: 38, hero: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }] },
      opponent: { heroes: [{ tile: 0, hero: 'Zed' }] },
    });
  });

  describe('with fights grouped into a battle', () => {
    const fight = (id: number, position: number, outcome: 'Win' | 'Loss') => ({ ...battle, id, battleId: 4, battlePosition: position, outcome });
    const fights = [fight(13, 3, 'Loss'), fight(12, 2, 'Win'), fight(11, 1, 'Win'), { ...battle, id: 10 }];

    beforeEach(() => {
      const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/pvp/fights') && (init?.method ?? 'GET') === 'GET' ? Response.json(fights) : base(url, init))));
    });

    it('shows a battle as one collapsed row with its tally and a pip per team, and opens it on demand', async () => {
      const user = userEvent.setup();
      render(<ArenaPage />);
      const card = await screen.findByRole('listitem', { name: 'Supreme Arena battle' });
      expect(within(card).getByTitle('Fights won by Side A').textContent).toBe('2-1');
      expect(within(card).getAllByTitle(/^Team \d: Side A (won|lost)$/).map((p) => p.textContent)).toEqual(['T1 · Duel · Berserk', 'T2 · Duel · Berserk', 'T3 · Duel · Berserk']);
      expect(within(card).queryByRole('list', { name: 'Fights of the battle' })).toBeNull(); // collapsed
      await user.click(within(card).getByRole('button', { name: 'Show fights' }));
      expect(within(within(card).getByRole('list', { name: 'Fights of the battle' })).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['Team 1', 'Team 2', 'Team 3']);
      await user.click(within(card).getByRole('button', { name: 'Hide fights' }));
      expect(within(card).queryByRole('list', { name: 'Fights of the battle' })).toBeNull();
    });

    it('expands and collapses every battle at once', async () => {
      const user = userEvent.setup();
      render(<ArenaPage />);
      await screen.findByRole('listitem', { name: 'Supreme Arena battle' });
      await user.click(screen.getByRole('button', { name: 'Expand all' }));
      expect(screen.getByRole('list', { name: 'Fights of the battle' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Collapse all' }));
      expect(screen.queryByRole('listitem', { name: 'Supreme Arena battle' })).toBeNull(); // the weeks are closed too
      await user.click(screen.getByRole('button', { name: /Week of Oct 26, 2026/ }));
      expect(screen.getByRole('listitem', { name: 'Supreme Arena battle' })).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Fights of the battle' })).toBeNull();
    });

    it('lists the fights one by one when grouping is switched off', async () => {
      const user = userEvent.setup();
      render(<ArenaPage />);
      await screen.findByRole('listitem', { name: 'Supreme Arena battle' });
      await user.click(screen.getByLabelText('Group by battle'));
      expect(screen.queryByRole('listitem', { name: 'Supreme Arena battle' })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4);
    });

    it('clones a whole battle, each fight into its own team', async () => {
      const user = userEvent.setup();
      render(<ArenaPage />);
      await user.click(within(await screen.findByRole('listitem', { name: 'Supreme Arena battle' })).getByRole('button', { name: 'Clone' }));
      expect(screen.getAllByRole('tab', { name: /^Team \d/ })).toHaveLength(3);
      await user.click(screen.getByRole('button', { name: 'Save records' }));
      await waitFor(() => expect(requests.find((r) => r.url === '/api/pvp/battles')).toBeTruthy());
      const sent = requests.find((r) => r.url === '/api/pvp/battles')!.body;
      expect(sent.fights.map((f: any) => [f.position, f.outcome])).toEqual([[1, 'Win'], [2, 'Win'], [3, 'Win']]);
    });

    it('edits the whole battle in the battle editor, saving every team in one request', async () => {
      const user = userEvent.setup();
      render(<ArenaPage />);
      await user.click(within(await screen.findByRole('listitem', { name: 'Supreme Arena battle' })).getByRole('button', { name: 'Edit' }));
      expect(screen.getByRole('heading', { name: 'Edit Supreme Arena record' })).toBeTruthy();
      expect(screen.getAllByRole('tab', { name: /^Team \d/ })).toHaveLength(3);
      expect(screen.queryByRole('button', { name: 'Save and record another' })).toBeNull();
      expect((screen.getByLabelText('Mode') as HTMLSelectElement).disabled).toBe(true); // a saved battle keeps its mode
      await user.click(screen.getByLabelText('Side B'));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/pvp/battles/4')).toBeTruthy());
      const sent = requests.find((r) => r.url === '/api/pvp/battles/4')!.body;
      expect(sent.fights.map((f: any) => [f.position, f.outcome])).toEqual([[1, 'Loss'], [2, 'Win'], [3, 'Loss']]); // only the team on show changed
    });

    it('moves a battle of a Tournament to another Round from the battle editor', async () => {
      const inRound = fights.map((f) => ({ ...f, tournamentId: 1, round: 'Top 48' }));
      const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/pvp/fights') && (init?.method ?? 'GET') === 'GET' ? Response.json(inRound) : base(url, init))));
      const user = userEvent.setup();
      render(<ArenaPage />);
      await user.click(within(await screen.findByRole('listitem', { name: 'Supreme Arena battle' })).getByRole('button', { name: 'Edit' }));
      expect((screen.getByLabelText('Round') as HTMLSelectElement).value).toBe('Top 48');
      await user.selectOptions(screen.getByLabelText('Round'), 'Top 16');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/pvp/battles/4')).toBeTruthy());
      expect(requests.find((r) => r.url === '/api/pvp/battles/4')!.body).toMatchObject({ tournamentId: 1, round: 'Top 16' });
    });

    it('confirms the Round Deployment of the Round chosen in the battle editor', async () => {
      const inRound = fights.map((f) => ({ ...f, tournamentId: 1, round: 'Top 48' }));
      const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url.startsWith('/api/pvp/fights') && method === 'GET') return Response.json(inRound);
        if (url === '/api/tournaments') return Response.json([{ id: 1, season: 8, number: 2, startDate: null, rounds: ['Top 48'] }]);
        if (url.startsWith('/api/tournaments/1/rounds/') && method === 'GET') return Response.json([]);
        return base(url, init);
      }));
      const user = userEvent.setup();
      render(<ArenaPage />);
      await user.click(within(await screen.findByRole('listitem', { name: 'Supreme Arena battle' })).getByRole('button', { name: 'Edit' }));
      await user.selectOptions(screen.getByLabelText('Round'), 'Top 16');
      expect(await screen.findByRole('region', { name: 'Round Deployment' })).toBeTruthy();
      await user.selectOptions(screen.getByLabelText('Profile of Side A'), '1');
      await user.click(await screen.findByRole('button', { name: 'Confirm Side A as the Round Deployment of Me' }));
      await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url.startsWith('/api/tournaments/1/rounds/Top%2016/deployments/'))).toBeTruthy());
    });

    it('deletes a battle with its fights, and offers no way to ungroup it', async () => {
      const user = userEvent.setup();
      render(<ArenaPage />);
      const card = await screen.findByRole('listitem', { name: 'Supreme Arena battle' });
      expect(within(card).queryByRole('button', { name: 'Ungroup' })).toBeNull();
      await user.click(within(card).getByRole('button', { name: 'Delete' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(requests.filter((r) => r.method === 'DELETE').at(-1)?.url).toBe('/api/battles/4?fights=delete'));
    });
  });

  it('greys out heroes another team of the same session uses, yet lets them be moved', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('tab', { name: /Team 2/ }));
    const yours = within(screen.getByRole('list', { name: 'Side A heroes' }));
    const used = yours.getByRole('button', { name: /^Evie/ });
    expect((used as HTMLButtonElement).disabled).toBe(false);
    expect(used.className).toMatch(/held/);
    expect(used.getAttribute('title')).toMatch(/team 1/i);
    expect((yours.getByRole('button', { name: /^Fay/ }) as HTMLButtonElement).className).not.toMatch(/held/);
  });

  it('switches to the side whose hero is removed with the cross', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await placeFirstHero(user, /^Evie/);
    expect(screen.getByRole('tab', { name: 'Side A (1/5)' }).getAttribute('aria-selected')).toBe('true');

    await user.click(screen.getByRole('tab', { name: 'Side B (0/5)' }));
    expect(screen.getByRole('tab', { name: 'Side B (0/5)' }).getAttribute('aria-selected')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Remove Evie' }));
    expect(screen.getByRole('tab', { name: 'Side A (0/5)' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the two side profile selectors side by side', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    const profiles = screen.getByRole('group', { name: 'Profiles of the sides' });
    expect(within(profiles).getByLabelText('Profile of Side A')).toBeTruthy();
    expect(within(profiles).getByLabelText('Profile of Side B')).toBeTruthy();
  });

  it('keeps the profiles, side tabs and search outside the scrolling unit picker', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    expect(screen.getByRole('group', { name: 'Profiles of the sides' }).closest('.workspace-bar')).toBeTruthy(); // in the bar above the editor, taking no height from the picker
    expect(screen.getByRole('tab', { name: 'Side A (0/5)' }).closest('.picker-fixed')).toBeTruthy();
    const search = screen.getByRole('textbox', { name: 'Search Side A heroes' });
    expect(search.closest('.picker-scroll')).toBeTruthy();
    expect(search.parentElement?.className).toContain('filters');

    await placeFirstHero(user, /^Evie/);
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Evie|Player deployment/ })[0]!);
    expect(screen.getByRole('group', { name: 'Rank and equipment of Evie' }).parentElement).toBe(document.body); // beside the tile, taking no height from the picker
  });

  it('moves a hero from another team once the question is accepted', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('tab', { name: /Team 2/ }));
    await placeFirstHero(user, /^Evie/);
    let dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Evie is in team 1.*Move it to this team/);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('tab', { name: 'Team 1 (1)' })).toBeTruthy(); // declined: nothing moved
    await placeFirstHero(user, /^Evie/);
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(screen.getByRole('tab', { name: 'Team 1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Team 2 (1)' })).toBeTruthy();
  });

  it('swaps your formation with another team’s, leaving the opponent where it is unless asked', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await placeFirstHero(user, /^Evie/);
    expect(screen.getByRole('tab', { name: 'Team 1 (1)' })).toBeTruthy();
    expect((screen.getByLabelText('Swap') as HTMLSelectElement).value).toBe('mine'); // one side only is the default
    await user.selectOptions(screen.getByLabelText('with'), 'Team 3');
    expect(screen.getByRole('tab', { name: 'Team 1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Team 3 (1)' })).toBeTruthy();
    expect(Array.from((screen.getByLabelText('Swap') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['my formation', 'the opponent’s formation', 'both formations']);
  });

  it('takes Zanie from another team with her turrets, all at once', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await placeFirstHero(user, /^Zanie/); // Zanie and both turrets in one gesture
    expect(screen.getByRole('tab', { name: 'Team 1 (3)' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /Team 2/ }));
    const yours = within(screen.getByRole('list', { name: 'Side A heroes' }));
    expect((yours.getByRole('button', { name: /^Zanie/ }) as HTMLButtonElement).className).toMatch(/held/); // one icon for the hero
    await placeFirstHero(user, /^Zanie/);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Move' }));
    expect(screen.getByRole('tab', { name: 'Team 1' })).toBeTruthy(); // the turrets left with her
    expect(screen.getByRole('tab', { name: 'Team 2 (3)' })).toBeTruthy();
  });

  it.each([['Supreme Arena', true], ['Super League', true], ['Guild Duel', true]])('artifacts of %s teams: only used once is %s', async (mode, once) => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, mode);
    await user.click(screen.getByRole('button', { name: 'Choose Side A artifact' }));
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('tab', { name: /Team 2/ }));
    await user.click(screen.getByRole('button', { name: 'Choose Side A artifact' }));
    const artifact = within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' });
    expect(artifact.className.includes('held')).toBe(once);
    await user.click(artifact);
    if (once) {
      const dialog = (await screen.findAllByRole('dialog')).at(-1)!;
      expect(dialog.textContent).toMatch(/Bladestorm is in team 1.*Move it to this team/);
      await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('tab', { name: /Team 1/ }));
    expect(screen.getByRole('button', { name: 'Choose Side A artifact' }).title).toMatch(once ? /^Choose Side A artifact$/ : /^Bladestorm/);
  });

  it('takes a pair from another team whole, in one gesture', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await placeFirstHero(user, /^Elijah & Lailah/); // both parts in one click
    expect(screen.getByRole('tab', { name: 'Team 1 (2)' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Team 2/ }));
    await placeFirstHero(user, /^Elijah & Lailah/);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(screen.getByRole('tab', { name: 'Team 1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Team 2 (2)' })).toBeTruthy();
  });

  it('shows tags, and adds a tag while editing', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    expect(await screen.findByText('Luna', { selector: '.badge' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(await screen.findByLabelText('Add tag'), 'A:Kai{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')?.body.tags).toEqual(['Luna', 'A:Kai']));
  });

  it('shares the tags between the teams of one battle and sends them with each', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'New record' }));
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Supreme Arena');
    await user.type(screen.getByLabelText('Add tag'), 'Season 8{Enter}');
    await placeFirstHero(user, /^Evie/);
    await user.click(screen.getByRole('tab', { name: /^Team 2/ }));
    expect(screen.getByText('Season 8', { selector: '.badge' })).toBeTruthy();
    await placeFirstHero(user, /^Fay/);
    await user.click(screen.getByRole('button', { name: 'Save records' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST' && r.url === '/api/pvp/battles')).toBeTruthy());
    const sent = requests.find((r) => r.url === '/api/pvp/battles')!.body;
    expect(sent.mode).toBe('Supreme Arena');
    expect(sent.fights.map((f: any) => f.position)).toEqual([1, 2]);
    for (const fight of sent.fights) expect(fight).toMatchObject({ tags: ['Season 8'] });
  });

  it('edits a saved battle and sends its stored hero state back', async () => {
    const user = userEvent.setup();
    render(<ArenaPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Edit record')).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Winner' })).getByLabelText('Side B'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')).toBeTruthy());
    const sent = requests.find((r) => r.method === 'PUT')!;
    expect(sent.url).toBe('/api/pvp/fights/5');
    expect(sent.body).toMatchObject({ mode: 'Supreme Arena', outcome: 'Loss', rule: 'Berserk' });
    expect(sent.body.formation.heroes).toEqual([{ tile: 38, hero: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }]);
  });
});

describe('a link to a record', () => {
  afterEach(() => window.history.replaceState(null, '', '#arena'));

  it('opens the edit form of the record the address names, asking for that one record, and takes it out of the address when the form closes', async () => {
    window.history.replaceState(null, '', '#arena?record=5');
    const user = userEvent.setup();
    render(<ArenaPage />);
    expect(await screen.findByText('Edit record')).toBeTruthy();
    expect(requests.some((r) => r.url === '/api/pvp/fights/5')).toBe(true);
    expect(window.location.hash).toBe('#arena?record=5'); // still there while the form is open
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'New record' })).toBeTruthy();
    expect(window.location.hash).toBe('#arena');
  });

  it('says the record is gone, opens no form and drops the id from the address', async () => {
    window.history.replaceState(null, '', '#arena?record=99');
    render(<ArenaPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Record 99 no longer exists');
    expect(screen.queryByText('Edit record')).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe('#arena')); // the address is cleaned in an effect after the message shows
  });

  it('asks for no record when the address names none', async () => {
    render(<ArenaPage />);
    await screen.findByRole('button', { name: 'Edit' });
    expect(requests.some((r) => /^\/api\/pvp\/battles\/\d+$/.test(r.url))).toBe(false);
  });
});
