// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { StagesPage } from '../../../web/stages/StagesPage.js';

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
let gridBoxes: unknown[];
let holdCreate: Promise<void> | null;

beforeEach(() => {
  requests = [];
  attempts = [];
  gridBoxes = [];
  holdCreate = null;
  window.history.replaceState(null, '', '#stages'); // the page state lives in the address
  vi.stubGlobal('window', Object.assign(window, { confirm: () => true }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body });
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/stage-grid') return Response.json({ season: 8, boxes: gridBoxes });
      if (url.startsWith('/api/attempts') && method === 'GET') return Response.json(attempts);
      if (url === '/api/attempts' && method === 'POST') {
        await holdCreate;
        return Response.json({ id: 1 }, { status: 201 });
      }
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

const box = (kind: string, number: number, state: 'cleared' | 'older' = 'cleared', phase = 0) => ({ kind, phase, number, state, newestSeason: state === 'cleared' ? 8 : 7 });
const record = (id: number, over: object = {}) => ({
  id, buffLevel: null, note: '', tags: [], createdAt: `2026-10-${String(10 + id).padStart(2, '0')}`, season: 8,
  stage: { id: 7, season: 8, phase: 0, kind: 'Normal', number: 12, mapName: 'Open', attemptCount: 1, enemies: [] },
  formation: { artifact: null, phantimal: null, assist: null, formationId: null, heroes: [{ tile: 38, name: 'Evie', part: '', rank: null, equipmentLevel: null }] },
  ...over,
});
const lane = (name: string) => within(screen.getByRole('region', { name }));
const laneHead = (name: string) => lane(name).getAllByRole('button')[0]!;

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

  it('records an attempt once when Save is clicked again while the first save is still running', async () => {
    let release!: () => void;
    holdCreate = new Promise((resolve) => (release = resolve));
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.dblClick(screen.getByRole('button', { name: 'Save attempt' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save and record another' }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
    expect(requests.filter((r) => r.url === '/api/attempts' && r.method === 'POST')).toHaveLength(1);
  });

  it('keeps the formation after "Save and record another", so the same team can be recorded on the next stage', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    await waitFor(() => expect(requests.filter((r) => r.url === '/api/attempts' && r.method === 'POST')).toHaveLength(1));
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body).not.toHaveProperty('outcome');
    expect((await screen.findByRole('status')).textContent).toMatch(/^Saved/);
    expect(within(screen.getByRole('list', { name: 'Placed on Your formation' })).getByText('Evie')).toBeTruthy();
  });

  it('keeps no hero state: no rank or equipment to edit, on the tile or in the assist hero, and none is sent (ADR 0041)', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Stage number'), '100');
    await user.click(within(await screen.findByRole('list', { name: 'Heroes' })).getByRole('button', { name: /Evie/ }));
    await user.click(yourTiles()[0]!);
    await user.click(yourTiles()[0]!); // a second click on the hero would open its rank and equipment in the other modes
    expect(screen.queryByRole('group', { name: 'Rank of Evie' })).toBeNull();
    expect(document.querySelector('.tile-tag')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Choose assist hero' }));
    await user.click(within(screen.getByRole('list', { name: 'Assist heroes' })).getByRole('button', { name: 'Fay' }));
    expect(screen.queryByRole('button', { name: /^Rank of Fay/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Choose artifact' }));
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.querySelector('.map-slot .hex-slot:not(.hex-slot-empty)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(true));
    const formation = requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body.formation;
    expect(formation).toEqual({ heroes: [{ tile: 38, hero: 'Evie' }], phantimal: null, assistHero: 'Fay', artifact: 'Bladestorm', formationId: null });
    expect(requests.some((r) => r.url.startsWith('/api/roster/'))).toBe(false); // nothing asks to update the roster
  });

  it('clones an attempt into a new one on the current season’s stage, with the formation, buff level and tags but not the note', async () => {
    const user = userEvent.setup();
    attempts = [{
      id: 3, buffLevel: 12, note: 'too slow', tags: ['Luna'], createdAt: '2026-10-29',
      stage: { id: 7, season: 8, phase: 1, kind: 'Apex Normal', number: 100, mapName: 'Open', attemptCount: 1, enemies: [] },
      formation: { artifact: null, phantimal: null, assist: null, heroes: [{ tile: 38, name: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }] },
    }];
    gridBoxes = [box('Apex Normal', 100, 'cleared', 1)];
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Apex Normal stage 100, cleared this season' }));
    await user.click(await screen.findByRole('button', { name: 'Clone' }));
    expect(screen.getByText('New attempt', { selector: 'h2' })).toBeTruthy();
    expect((screen.getByLabelText('Stage number') as HTMLInputElement).value).toBe('100');
    await waitFor(() => expect(requests.some((r) => r.url.startsWith('/api/stages?') && r.url.includes('season=8'))).toBe(true)); // the stage of this season, not the cloned record's
    expect(await screen.findByLabelText(/Buff level/)).toBeTruthy();
    expect((screen.getByLabelText(/Buff level/) as HTMLInputElement).value).toBe('12');
    expect(within(await screen.findByRole('list', { name: 'Placed on Your formation' })).getByText('Evie')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));
    await waitFor(() => expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')).toBeTruthy());
    expect(requests.find((r) => r.url === '/api/attempts' && r.method === 'POST')!.body).toMatchObject({
      stageId: 7, buffLevel: 12, note: '', tags: ['Luna'], formation: { heroes: [{ tile: 38, hero: 'Evie' }] },
    });
  });

  it('draws the Phase tabs, the four lanes and the three states of a box', async () => {
    gridBoxes = [box('Normal', 1), box('Normal', 2, 'older'), box('Phantisomal', 3)];
    render(<StagesPage />);
    expect((await screen.findByRole('tab', { name: 'Phase 1' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Phase 1', 'Phase 2', 'Phase 3']);
    expect(await screen.findByRole('button', { name: 'Normal stage 1, cleared this season' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Normal stage 2, cleared in an older season' })).toBeTruthy(); // an older season's record only
    expect(screen.getByRole('button', { name: 'Normal stage 3, no record' })).toBeTruthy();
    expect(lane('Normal').getAllByRole('button')).toHaveLength(1 + 300);
    expect(laneHead('Phantisomal').textContent).toContain('1 cleared');
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('false'); // no Apex record, standard lanes not cleared
    expect(laneHead('Apex Normal').textContent).toContain('Apex Normal · 1–333 · Collapsed');
    expect(laneHead('Apex Phantisomal').textContent).toContain('Apex Phantisomal · 1–667 · Collapsed');
  });

  it('opens on the highest phase with a record of this season, and shows that phase’s numbers', async () => {
    gridBoxes = [box('Normal', 1), box('Phantisomal', 700), box('Phantisomal', 1300, 'older')];
    render(<StagesPage />);
    expect((await screen.findByRole('tab', { name: 'Phase 2' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Phantisomal stage 700, cleared this season' })).toBeTruthy();
    expect(laneHead('Normal').textContent).toContain('Normal · 301–600');
  });

  it('collapses a standard lane once its last box is cleared, however empty it is before, and opens Apex once both are', async () => {
    gridBoxes = [box('Normal', 300), box('Phantisomal', 600)];
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    expect(laneHead('Normal').getAttribute('aria-expanded')).toBe('false');
    expect(laneHead('Normal').textContent).toContain('Cleared · Season 8');
    expect(laneHead('Phantisomal').getAttribute('aria-expanded')).toBe('false');
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('true'); // unlocked, not recorded yet
    expect(lane('Apex Normal').getAllByRole('button')).toHaveLength(1 + 333);
    expect(laneHead('Apex Phantisomal').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens an Apex lane for a record of its own, and Normal and Phantisomal stay apart', async () => {
    gridBoxes = [box('Apex Phantisomal', 5, 'cleared', 1)];
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    expect(laneHead('Apex Phantisomal').getAttribute('aria-expanded')).toBe('true');
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('false');
    expect(lane('Apex Phantisomal').getByRole('button', { name: 'Apex Phantisomal stage 5, cleared this season' })).toBeTruthy();
  });

  it('keeps a lane opened by hand in the page address, and forgets it when the page is left', async () => {
    const user = userEvent.setup();
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    await user.click(laneHead('Apex Normal'));
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('true');
    expect(decodeURIComponent(window.location.hash)).toBe('#stages?open=1:apex-normal');
    await user.click(screen.getByRole('tab', { name: 'Phase 3' }));
    expect(decodeURIComponent(window.location.hash)).toBe('#stages?phase=3&open=1:apex-normal');
    cleanup();
    render(<StagesPage />); // a reload of the same address
    expect((await screen.findByRole('tab', { name: 'Phase 3' })).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('tab', { name: 'Phase 1' }));
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('true');
    cleanup();
    window.history.replaceState(null, '', '#stages'); // left and come back
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('false');
  });

  it('moves between the Phase tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<StagesPage />);
    (await screen.findByRole('tab', { name: 'Phase 1' })).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Phase 2' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Phase 2' }));
  });

  it('opens the panel of a box right under it, lists the five newest records and reveals the rest, and Escape closes it', async () => {
    const user = userEvent.setup();
    gridBoxes = [box('Normal', 12)];
    attempts = [7, 6, 5, 4, 3, 2, 1].map((id) => record(id, { note: `note ${id}` }));
    render(<StagesPage />);
    const button = await screen.findByRole('button', { name: 'Normal stage 12, cleared this season' });
    await user.click(button);
    const panel = await screen.findByRole('region', { name: 'Normal · stage 12' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.nextElementSibling).toBe(panel); // one column wide in the test, so the box's row ends at the box
    expect(within(panel).getByText('Cleared this season')).toBeTruthy();
    expect(requests.find((r) => r.url.startsWith('/api/attempts?'))!.url).toContain('number=12');
    const records = () => within(panel).getAllByRole('listitem').filter((li) => li.classList.contains('stage-card'));
    expect(records()).toHaveLength(5);
    expect(within(panel).getByText('note 7')).toBeTruthy();
    expect(within(panel).queryByText('note 2')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Show 2 older records' }));
    expect(records()).toHaveLength(7);
    expect(within(panel).queryByRole('button', { name: /Show .* older records/ })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Normal · stage 12' })).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('lays a record out as a card: its facts, then its map, tags and note, and the buttons last', async () => {
    const user = userEvent.setup();
    gridBoxes = [box('Normal', 12)];
    attempts = [record(3, { note: 'n', tags: ['Luna'] })];
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Normal stage 12, cleared this season' }));
    const card = (await screen.findByRole('list', { name: 'Records of Normal · stage 12' })).querySelector('.stage-card')!;
    expect(card.querySelector('.stage-record')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('n').getAttribute('title')).toBe('n');
    expect(card.lastElementChild!.className).toBe('attempt-actions');
    expect(within(card.lastElementChild as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Edit', 'Clone', 'Delete']);
    expect(screen.queryByText('Win')).toBeNull(); // a stage record is a clear: no win/loss badge
  });

  it('says Record a clear on an empty box and opens the form on that stage', async () => {
    const user = userEvent.setup();
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Normal stage 12, no record' }));
    expect(await screen.findByText('Nothing recorded for this stage yet.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Record a clear' }));
    expect((screen.getByLabelText('Stage number') as HTMLInputElement).value).toBe('12');
    expect(screen.getByText('New attempt', { selector: 'h2' })).toBeTruthy();
  });

  it('adds a clear to an older box on the map of its newest record', async () => {
    const user = userEvent.setup();
    gridBoxes = [box('Normal', 12, 'older')];
    attempts = [record(1, { stage: { id: 5, season: 7, phase: 0, kind: 'Normal', number: 12, mapName: 'Open', attemptCount: 1, enemies: [] } })];
    const maps = data['/api/maps'] as { name: string }[];
    data['/api/maps'] = [{ ...maps[0]!, name: 'Walls' }, ...maps]; // the form would otherwise start on the first map
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Normal stage 12, cleared in an older season' }));
    const panel = await screen.findByRole('region', { name: 'Normal · stage 12' });
    expect(within(panel).getByText('Cleared in season 7')).toBeTruthy();
    expect(within(panel).getByText('S7')).toBeTruthy();
    await user.click(await within(panel).findByRole('button', { name: 'Add a clear' }));
    expect((screen.getByLabelText('Stage number') as HTMLInputElement).value).toBe('12');
    expect(screen.getByDisplayValue('Open')).toBeTruthy(); // the map of the newest record, not the first map
    data['/api/maps'] = maps;
  });

  it('draws a record on its stage’s map, and an AFK range copy on the map Open since its map is unknown', async () => {
    const user = userEvent.setup();
    gridBoxes = [box('Normal', 12)];
    const elsewhere = { id: 7, season: 8, phase: 0, kind: 'Normal', number: 12, mapName: 'Elsewhere', attemptCount: 1, enemies: [] };
    attempts = [record(2, { tags: ['AFK range'], stage: elsewhere }), record(1, { stage: elsewhere })];
    render(<StagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Normal stage 12, cleared this season' }));
    const panel = await screen.findByRole('region', { name: 'Normal · stage 12' });
    await within(panel).findAllByRole('listitem');
    expect(within(panel).getAllByRole('group', { name: 'Formation on Open' })).toHaveLength(1);
  });

  it('jumps to a stage number in a lane, switching the phase for a standard number and flashing the box', async () => {
    const user = userEvent.setup();
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    await user.selectOptions(screen.getByLabelText('Lane to jump to'), 'Phantisomal');
    await user.type(screen.getByLabelText('Stage number to jump to'), '700');
    await user.click(screen.getByRole('button', { name: 'Jump' }));
    expect(screen.getByRole('tab', { name: 'Phase 2' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Phantisomal stage 700, no record' }).className).toContain('flash');
    await user.clear(screen.getByLabelText('Stage number to jump to'));
    await user.selectOptions(screen.getByLabelText('Lane to jump to'), 'Apex Normal');
    await user.type(screen.getByLabelText('Stage number to jump to'), '500');
    await user.click(screen.getByRole('button', { name: 'Jump' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Apex Normal has no stage 500/);
  });

  it('opens a collapsed lane when a jump goes to it', async () => {
    const user = userEvent.setup();
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    await user.selectOptions(screen.getByLabelText('Lane to jump to'), 'Apex Normal');
    await user.type(screen.getByLabelText('Stage number to jump to'), '40');
    await user.click(screen.getByRole('button', { name: 'Jump' }));
    expect(laneHead('Apex Normal').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Apex Normal stage 40, no record' }).className).toContain('flash');
  });

  it('has no Only cleared filter and no list of attempts', async () => {
    render(<StagesPage />);
    await screen.findByRole('tab', { name: 'Phase 1' });
    expect(screen.queryByRole('button', { name: /Only cleared/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Attempts' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Kind:/ })).toBeNull();
  });

  it('records a Normal stage attempt with any hero, the roster’s or not', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByLabelText('Stage number'), '100');
    const heroes = within(await screen.findByRole('list', { name: 'Heroes' }));
    expect(heroes.getByRole('button', { name: /Evie/ })).toBeTruthy();
    expect(heroes.getByRole('button', { name: /Lucca/ })).toBeTruthy(); // not owned: a stage record keeps no hero state, so any hero may be placed

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
    const locked = screen.getByText('AFK range'); // shown for the stages after the first, without a button to remove it
    expect(locked.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove tag AFK range' })).toBeNull();
    expect(screen.queryByText('Result')).toBeNull(); // a range is only cleared stages
    await user.click(screen.getByRole('button', { name: 'Save attempt' }));

    await waitFor(() => expect(requests.some((r) => r.url === '/api/attempts/range')).toBe(true));
    expect(requests.some((r) => r.url === '/api/attempts' && r.method === 'POST')).toBe(false);
    expect(requests.find((r) => r.url === '/api/attempts/range')!.body).toMatchObject({
      season: 8, phase: 0, kind: 'Normal', from: 100, to: 102, mapName: 'Open', tags: [],
      formation: { heroes: [{ tile: 38, hero: 'Evie' }] },
    });
  });

  it('shows the tag only while the form is a range', async () => {
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
