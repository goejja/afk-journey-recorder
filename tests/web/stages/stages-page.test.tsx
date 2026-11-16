// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { StagesPage } from '../../../web/stages/StagesPage.js';
import { columnsOf } from '../css-columns.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const rowLengths = [2, 5, 6, 6, 7, 6, 6, 5, 2];
const hero = (name: string, owned: boolean) => ({
  name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned, rank: owned ? 'Mythic+' : null, equipmentLevel: owned ? 10 : null,
});

const data: Record<string, unknown> = {
  '/api/maps': [{ name: 'Open', tags: ['Stage'], rowLengths, cells, source: 'manual', canRestore: false }],
  '/api/heroes': [hero('Evie', true), hero('Fay', true), hero('Lucca', false)],
  '/api/artifacts': [
    { name: 'Bladestorm', group: 'Season 8' },
    { name: 'Arc Burst', group: 'Season 7' },
    { name: 'Awakening', group: 'Pre-Season' },
  ],
  '/api/enemies': [{ name: 'Grunt', category: 'Common', class: null, damageType: null, imagePath: null, uses: 0 }],
  '/api/phantimals': [{ name: 'Gervan', faction: 'Lightbearer', class: 'Mage', seasons: [8], source: 'import' }],
};

let requests: { method: string; url: string; body?: any }[];
let attempts: unknown[];

beforeEach(() => {
  requests = [];
  attempts = [];
  vi.stubGlobal('window', Object.assign(window, { confirm: () => true }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body });
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url.startsWith('/api/attempts') && method === 'GET') return Response.json(attempts);
      if (url === '/api/attempts' && method === 'POST') return Response.json({ id: 1 }, { status: 201 });
      if (url.startsWith('/api/roster/') && method === 'PUT') return new Response(null, { status: 204 });
      if (url === '/api/stages' && method === 'POST') {
        return Response.json({ id: 7, ...body, phase: body.phase ?? 0, attemptCount: 0, enemies: [] });
      }
      if (url === '/api/stages/change-kind') return Response.json({ stages: 3, attempts: 5 });
      if (url.startsWith('/api/stages/') && method === 'PUT') return Response.json({ id: 7, season: 8, phase: 0, kind: 'Normal', number: 100, mapName: 'Open', attemptCount: 0, enemies: body.enemies });
      return Response.json(data[url] ?? []);
    }),
  );
});
afterEach(cleanup);

const yourTiles = () =>
  within(screen.getByRole('group', { name: 'Stage map' })).getAllByRole('button', { name: /Player deployment/ });

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  render(<StagesPage />);
  await user.click(await screen.findByRole('button', { name: 'New attempt' }));
}

describe('StagesPage', () => {
  it('offers only the stage season’s artifacts and the pre-season ones', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await screen.findByRole('list', { name: 'Heroes' });
    await user.click(screen.getByRole('button', { name: 'Choose artifact' }));
    const artifacts = within(screen.getByRole('list', { name: 'Artifacts' }));
    expect(artifacts.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Bladestorm', 'Awakening']);
  });

  it('chooses the assist hero and the artifact from icons', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);

    await user.click(screen.getByRole('button', { name: 'Choose assist hero' }));
    const assists = within(screen.getByRole('list', { name: 'Assist heroes' }));
    expect(assists.queryByRole('button', { name: 'Evie' })).toBeNull(); // already placed
    await user.click(assists.getByRole('button', { name: 'Fay' }));
    expect(screen.queryByRole('list', { name: 'Assist heroes' })).toBeNull(); // closes after the choice
    expect(screen.getByRole('button', { name: 'Clear assist hero' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Choose artifact' }));
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    expect(screen.queryByLabelText(/Artifact level/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body.formation).toMatchObject({ assistHero: 'Fay', artifact: 'Bladestorm'});
  });

  it('keeps the formation after "Save and record another", resetting only the result', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.click(screen.getByLabelText('Not cleared'));
    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    await waitFor(() => expect(requests.filter((r) => r.url === '/api/attempts' && r.method === 'POST')).toHaveLength(1));
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body.outcome).toBe('Loss');
    expect((await screen.findByRole('status')).textContent).toMatch(/^Saved/);
    expect((screen.getByLabelText('Cleared') as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByRole('list', { name: 'Placed on Your formation' })).getByText('Evie')).toBeTruthy();
  });

  it('edits a hero’s rank by clicking it on the map and shows the artifact in its map tile', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(screen.getByRole('button', { name: 'Choose artifact' }));
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.querySelector('.map-slot .hex-slot:not(.hex-slot-empty)')).toBeTruthy();
    await user.click(yourTiles()[0]!);
    await user.selectOptions(within(screen.getByRole('group', { name: 'Selected hero Evie' })).getByLabelText('Evie rank'), 'Elite');
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body.formation.heroes[0]).toMatchObject({ hero: 'Evie', rank: 'Elite' });
  });

  it('offers to update the roster when the attempt was recorded at a higher rank, and the form waits for the answer', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url === '/api/heroes' ? Response.json([{ ...hero('Evie', true), rank: 'Elite', equipmentLevel: null }]) : base(url, init))));
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.selectOptions(within(screen.getByRole('group', { name: 'Selected hero Evie' })).getByLabelText('Evie rank'), 'Mythic+');
    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Update the roster?' }));
    expect((dialog.getByLabelText('Update Evie') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(/Saved\./)).toBeNull(); // not before the answer
    await user.click(dialog.getByRole('button', { name: 'Update roster' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/roster/Evie')?.body).toMatchObject({ rank: 'Mythic+' }));
    expect(await screen.findByText(/Saved\./)).toBeTruthy();
  });

  it('puts New attempt beside the tag filter', async () => {
    render(<StagesPage />);
    const button = await screen.findByRole('button', { name: 'New attempt' });
    expect(within(button.parentElement!).getByRole('button', { name: /^Kind:/ })).toBeTruthy();
  });

  it('clones an attempt into a new one on the same stage, with the formation, buff level and tags but not the result or note', async () => {
    const user = userEvent.setup();
    attempts = [{
      id: 3, outcome: 'Loss', buffLevel: 12, note: 'too slow', tags: ['Luna'], createdAt: '2026-10-29',
      stage: { id: 7, season: 8, phase: 1, kind: 'Apex Normal', number: 100, mapName: 'Open', attemptCount: 1, enemies: [] },
      formation: { artifact: null, phantimal: null, assist: null, heroes: [{ tile: 38, name: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }] },
    }];
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Clone' }));
    expect(screen.getByText('New attempt', { selector: 'h2' })).toBeTruthy();
    expect((screen.getByLabelText('Stage number') as HTMLInputElement).value).toBe('100');
    expect(await screen.findByLabelText(/Buff level/)).toBeTruthy();
    expect((screen.getByLabelText(/Buff level/) as HTMLInputElement).value).toBe('12');
    expect(within(await screen.findByRole('list', { name: 'Placed on Your formation' })).getByText('Evie')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')).toBeTruthy());
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body).toMatchObject({
      stageId: 7, outcome: 'Win', buffLevel: 12, note: '', tags: ['Luna'], formation: { heroes: [{ tile: 38, hero: 'Evie' }] },
    });
  });

  it('says when there are older attempts than the list shows, asking for one more than it shows', async () => {
    const one = (id: number) => ({
      id, outcome: 'Win', buffLevel: null, note: '', tags: [], createdAt: '2026-10-29',
      stage: { id: 7, season: 8, phase: 0, kind: 'Normal', number: id, mapName: 'Open', attemptCount: 1, enemies: [] },
      formation: { artifact: null, phantimal: null, assist: null, heroes: [] },
    });
    attempts = Array.from({ length: 201 }, (_, i) => one(i + 1));
    render(<StagesPage />);
    expect(await screen.findByText(/Showing the latest 200 attempts/)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Attempts' })).getAllByRole('listitem').filter((li) => li.className === 'attempt')).toHaveLength(200);
    expect(requests.find((r) => r.url.startsWith('/api/attempts?'))!.url).toContain('limit=201');
    cleanup();
    attempts = [one(1)];
    render(<StagesPage />);
    await screen.findByRole('list', { name: 'Attempts' });
    expect(screen.queryByText(/Showing the latest/)).toBeNull();
  });

  it('gives every cell of a record its own grid column, so the buttons stay at the right of the first line', async () => {
    attempts = [{
      id: 3, outcome: 'Win', buffLevel: null, note: 'n', tags: ['Luna'], createdAt: '2026-10-29', season: 8,
      stage: { id: 7, season: 8, phase: 0, kind: 'Normal', number: 100, mapName: 'Open', attemptCount: 1, enemies: [] },
      formation: { artifact: null, phantimal: null, assist: null, heroes: [] },
    }];
    render(<StagesPage />);
    const row = (await screen.findByRole('list', { name: 'Attempts' })).querySelector('.stage-row')!;
    expect(row.children).toHaveLength(columnsOf('.stage-row'));
    expect(row.lastElementChild!.className).toBe('attempt-actions');
  });

  it('shows an empty state', async () => {
    render(<StagesPage />);
    expect(await screen.findByText('No attempts recorded yet.')).toBeTruthy();
  });

  it('records a Normal stage attempt with heroes from the roster', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByLabelText('Stage number'), '100');
    const heroes = within(await screen.findByRole('list', { name: 'Heroes' }));
    expect(heroes.getByRole('button', { name: /Evie/ })).toBeTruthy();
    expect(heroes.queryByRole('button', { name: /Lucca/ })).toBeNull(); // not owned

    await user.click(heroes.getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    expect(heroes.getByRole('button', { name: /Evie/ }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    // a stage that is new is created when the attempt is saved
    expect(requests.find((r) => r.url === '/api/stages' && r.method === 'POST')!.body).toMatchObject({ season: 8, phase: 0, kind: 'Normal', number: 100, mapName: 'Open' });
    const saved = requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!;
    expect(saved.body).toMatchObject({
      stageId: 7,
      outcome: 'Win',
      buffLevel: null,
      formation: { heroes: [{ tile: 38, hero: 'Evie' }], phantimal: null, assistHero: null, artifact: null },
    });
  });

  it('records one attempt per stage when the same formation cleared a range in auto-battle', async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url === '/api/attempts/range' && init?.method === 'POST' ? (requests.push({ method: 'POST', url, body: JSON.parse(init.body as string) }), Response.json({ attempts: [{ id: 1 }, { id: 2 }, { id: 3 }] }, { status: 201 })) : base(url, init))));
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    const heroes = within(await screen.findByRole('list', { name: 'Heroes' }));
    await user.click(heroes.getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);

    await user.type(screen.getByLabelText('Up to stage (optional)'), '102');
    expect(screen.getByText('AFK range')).toBeTruthy(); // tagged on its own, and the tag can be removed
    expect(screen.queryByRole('radio', { name: 'Not cleared' })).toBeNull(); // every stage but the last is a win
    await user.click(screen.getByLabelText('Stage 102 not cleared'));
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));

    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts/range')).toBe(true));
    expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(false);
    expect(requests.find((r) => r.url === '/api/attempts/range')!.body).toMatchObject({
      season: 8, phase: 0, kind: 'Normal', from: 100, to: 102, mapName: 'Open', lastLost: true, tags: ['AFK range'],
      formation: { heroes: [{ tile: 38, hero: 'Evie' }] },
    });
  });

  it('takes the tag off again when the range is cleared', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.type(screen.getByLabelText('Up to stage (optional)'), '105');
    expect(screen.getByText('AFK range')).toBeTruthy();
    await user.clear(screen.getByLabelText('Up to stage (optional)'));
    expect(screen.queryByText('AFK range')).toBeNull();
  });

  it('keeps the team on the next stage, standing where the new map allows', async () => {
    const user = userEvent.setup();
    const shifted = cells.map((_, i) => (i >= 40 ? TILE.PLAYER : i < 5 ? TILE.ENEMY : TILE.OPEN));
    data['/api/maps'] = [
      { name: 'Open', tags: ['Stage'], rowLengths, cells, source: 'manual', canRestore: false },
      { name: 'Shifted', tags: ['Stage'], rowLengths, cells: shifted, source: 'manual', canRestore: false },
    ];
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.selectOptions(screen.getByLabelText(/^Map/), 'Shifted');
    await user.clear(screen.getByLabelText('Stage number'));
    await user.type(screen.getByLabelText('Stage number'), '101');
    await screen.findByRole('list', { name: 'Heroes' });
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body.formation.heroes).toEqual([{ tile: 40, hero: 'Evie' }]);
    data['/api/maps'] = [{ name: 'Open', tags: ['Stage'], rowLengths, cells, source: 'manual', canRestore: false }];
  });

  it('offers a Phantimal only for Phantisomal kinds, and adds it with the third matching hero', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '5');
    await screen.findByRole('list', { name: 'Heroes' });
    expect(screen.queryByLabelText('Phantimal')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Kind'), 'Phantisomal');
    const heroes = within(await screen.findByRole('list', { name: 'Heroes' }));
    for (const name of [/^Evie/, /^Fay/]) await user.click(heroes.getByRole('button', { name }));
    // Gervan is a Lightbearer and this roster has only Wilders: the Faction Requirement is not met (ADR 0029), so its portrait is greyed out
    const phantimals = within(screen.getByRole('list', { name: 'Phantimal' }));
    expect((phantimals.getByRole('button', { name: 'No Phantimal' }) as HTMLButtonElement).disabled).toBe(false);
    expect((phantimals.getByRole('button', { name: 'Gervan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Three heroes of one faction bring a Phantimal/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    const saved = requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!;
    expect(saved.body.formation.phantimal).toBeNull();
    expect(saved.body.formation.heroes.map((h: any) => h.hero)).toEqual(['Evie', 'Fay']);
  });

  it('asks for a buff level on Apex stages and saves it', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.selectOptions(screen.getByLabelText('Kind'), 'Apex Normal');
    await user.selectOptions(screen.getByLabelText('Phase'), '2');
    await user.type(screen.getByLabelText('Stage number'), '30');
    await screen.findByRole('list', { name: 'Heroes' });
    const buff = screen.getByLabelText('Buff level') as HTMLInputElement;
    await user.clear(buff);
    await user.type(buff, '12');
    await user.click(within(screen.getByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body.buffLevel).toBe(12);
    expect(requests.find((r) => r.url === '/api/stages' && r.method === 'POST')!.body).toMatchObject({ kind: 'Apex Normal', phase: 2, number: 30 });
  });

  it('keeps the Stage Enemies as chips with a count, saved with the attempt', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    const add = screen.getByLabelText('Add stage enemy');
    await user.type(add, 'Grunt{Enter}');
    await user.type(add, 'grunt{Enter}'); // the same enemy again counts one more
    await user.type(add, 'Lucca{Enter}'); // any hero, not only roster ones
    expect(screen.getByText(/Grunt ×2/)).toBeTruthy();
    expect(screen.getByText(/Lucca ×1/)).toBeTruthy();
    await user.type(add, 'Nobody{Enter}');
    expect(screen.getByText(/"Nobody" is not an enemy or a hero/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'One fewer Grunt' }));
    await user.click(screen.getByRole('button', { name: 'Remove Lucca' }));
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.method === 'PUT')!.body).toEqual({ mapName: 'Open', enemies: [{ enemy: 'Grunt', hero: null, count: 1 }] });
  });

  it('looks the stage up without creating it, and has no enemies to edit for a range', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    expect(await screen.findByText('New stage')).toBeTruthy();
    expect(requests.some((r) => r.url === '/api/stages' && r.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('Add stage enemy')).toBeTruthy();
    await user.type(screen.getByLabelText('Up to stage (optional)'), '102');
    expect(screen.queryByLabelText('Add stage enemy')).toBeNull();
  });

  it('turns a range of stages recorded as Normal into Phantisomal ones', async () => {
    const user = userEvent.setup();
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Change stage kind' }));
    const form = within(screen.getByRole('group', { name: 'Change stage kind' }));
    await user.type(form.getByLabelText('From stage'), '100');
    await user.type(form.getByLabelText(/To stage/), '102');
    await user.click(form.getByRole('button', { name: 'Make Phantisomal' }));
    expect((await form.findByRole('status')).textContent).toBe('3 stages and 5 attempts are now Phantisomal.');
    expect(requests.find((r) => r.url === '/api/stages/change-kind')!.body).toMatchObject({ phase: 0, kind: 'Normal', newKind: 'Phantisomal', from: 100, to: 102 });
  });
});
