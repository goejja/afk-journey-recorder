// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { ScenariosPage } from '../../../web/scenarios/ScenariosPage.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string, owned = true) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned, rank: null, equipmentLevel: null });
const scenario = {
  id: 3, name: 'Rival', mode: 'Arena', note: 'tough', estimate: 'Try Evie and Fay, 4 similar battles.', estimateAt: '2026-10-30 10:00:00',
  createdAt: '2026-10-30 09:00:00', updatedAt: '2026-10-30 11:00:00',
  slots: [{ position: 1, mapName: 'Duel', rule: null, mine: [{ tile: 38, name: 'Evie', rank: null, equipmentLevel: null }], enemy: [{ tile: 0, name: 'Zed', rank: null, equipmentLevel: null }] }],
};

let requests: { method: string; url: string; body?: any; headers?: Record<string, string> }[];
/** What the server says about the agent's run on scenario 3, and the scenario as it is saved. */
let runState: { state: string; error?: string };
let saved: typeof scenario;

beforeEach(() => {
  requests = [];
  runState = { state: 'idle' };
  saved = scenario;
  vi.stubGlobal('window', Object.assign(window, { confirm: () => true }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined, headers: init?.headers as Record<string, string> });
      if (url === '/api/scenarios' && method === 'GET') return Response.json([saved]);
      if (url === '/api/scenarios/runs' && method === 'GET') return Response.json(runState.state === 'idle' ? {} : { 3: runState });
      if (url === '/api/scenarios/3/run' && method === 'POST') return Response.json((runState = { state: 'running' }), { status: 202 });
      if (url === '/api/scenarios/3/run/cancel' && method === 'POST') return Response.json(runState);
      if (url === '/api/scenarios' && method === 'POST') return Response.json(scenario, { status: 201 });
      if (url.startsWith('/api/scenarios/') && method === 'PUT') return Response.json(scenario);
      if (url === '/api/maps') return Response.json([{ name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Fay'), hero('Zed', false)]);
      if (url === '/api/artifacts') return Response.json([]);
      if (url === '/api/boss-rules') return Response.json([]);
      if (url === '/api/reference') return Response.json({ ranks: ['Elite'], equipmentLevels: [], caps: [] });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

/** The page opens on the team generator; these tests are about the scenario planner. */
async function renderPlanner() {
  render(<ScenariosPage />);
  await userEvent.click(screen.getByRole('tab', { name: 'Scenario planner' }));
}

describe('Scenarios page', () => {
  it('shows the agent estimate and warns when the scenario was edited after it', async () => {
    await renderPlanner();
    expect(await screen.findByText(/Try Evie and Fay/)).toBeTruthy();
    expect(screen.getByText(/edited since: ask again/)).toBeTruthy();
    expect(screen.getByText(/Team 1: Zed vs Evie/)).toBeTruthy();
  });

  it('plans a scenario with an enemy hero and saves it', async () => {
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(await screen.findByRole('button', { name: 'New scenario' }));
    await user.type(await screen.findByLabelText('Name'), 'Test plan');
    await user.selectOptions(screen.getAllByLabelText('Mode').at(-1)!, 'Arena');
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!); // switches to the enemy side
    await user.click(within(screen.getByRole('list', { name: 'Enemy heroes' })).getByRole('button', { name: /^Zed/ }));
    await user.click(within(screen.getByRole('group', { name: 'Battle map' })).getAllByRole('button', { name: /Enemy deployment/ })[0]!);
    await user.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST' && r.url === '/api/scenarios')).toBeTruthy());
    const sent = requests.find((r) => r.method === 'POST')!.body;
    expect(sent).toMatchObject({ name: 'Test plan', mode: 'Arena' });
    expect(sent.slots).toHaveLength(1);
    expect(sent.slots[0].enemy).toEqual([{ tile: 0, hero: 'Zed', rank: null, equipmentLevel: null }]);
    expect(sent.slots[0].mine).toEqual([]);
  });


  it('edits a saved scenario', async () => {
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(await screen.findByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')?.body.name).toBe('Renamed'));
    expect(requests.find((r) => r.method === 'PUT')!.url).toBe('/api/scenarios/3');
    expect(requests.find((r) => r.method === 'PUT')!.body.slots[0].mine).toEqual([{ tile: 38, hero: 'Evie' }]);
  });

  it('keeps the heroes where they are when the map changes, moving those off a deployment tile', async () => {
    const user = userEvent.setup();
    const shifted = cells.map((_, i) => (i >= 40 && i < 45 ? TILE.PLAYER : i >= 5 && i < 10 ? TILE.ENEMY : TILE.OPEN));
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      url === '/api/maps'
        ? Response.json([
            { name: 'Duel', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false },
            { name: 'Shifted', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: shifted, source: 'manual', canRestore: false },
          ])
        : base(url, init)));
    await renderPlanner();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.selectOptions(await screen.findByLabelText('Map'), 'Shifted');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')).toBeTruthy());
    const slot = requests.find((r) => r.method === 'PUT')!.body.slots[0];
    expect(slot.mapName).toBe('Shifted');
    expect(slot.mine).toEqual([{ tile: 40, hero: 'Evie' }]);
    expect(slot.enemy).toEqual([{ tile: 5, hero: 'Zed', rank: null, equipmentLevel: null }]);
  });
});

describe('Running the agent on a scenario', () => {
  afterEach(() => vi.useRealTimers());

  it('starts the agent, shows that it is working, and shows the new estimate when it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderPlanner();
    await user.click(await screen.findByRole('button', { name: 'Run estimate' }));

    const start = requests.find((r) => r.method === 'POST' && r.url === '/api/scenarios/3/run')!;
    expect(start.headers).toMatchObject({ 'x-afk-action': 'app' });
    expect(await screen.findByText(/The agent is working on this/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel estimate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run estimate' })).toBeNull();

    // the server finishes: it has saved a new estimate
    runState = { state: 'done' };
    saved = { ...scenario, estimate: 'Fresh answer from the agent.', estimateAt: '2026-10-30 12:00:00' };
    await act(() => vi.advanceTimersByTimeAsync(2100));

    expect(await screen.findByText('Fresh answer from the agent.')).toBeTruthy();
    expect(screen.queryByText(/The agent is working on this/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Run estimate' })).toBeTruthy();
  });

  it('cancels a run that is going', async () => {
    const user = userEvent.setup();
    await renderPlanner();
    await user.click(await screen.findByRole('button', { name: 'Run estimate' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel estimate' }));

    const cancel = requests.find((r) => r.method === 'POST' && r.url === '/api/scenarios/3/run/cancel')!;
    expect(cancel.headers).toMatchObject({ 'x-afk-action': 'app' });
  });

  it('shows a run that failed with its reason, and says the old estimate is kept', async () => {
    runState = { state: 'failed', error: 'claude: not logged in' };
    await renderPlanner();
    const alert = await screen.findByText(/The last run failed: claude: not logged in/);
    expect(alert.textContent).toMatch(/The previous estimate is kept/);
    expect(screen.getByText(/Try Evie and Fay/)).toBeTruthy();
  });

  it('does not reload the list for a run that finished before the page was opened', async () => {
    runState = { state: 'done' };
    await renderPlanner();
    await screen.findByText(/Try Evie and Fay/);
    const loads = () => requests.filter((r) => r.method === 'GET' && r.url === '/api/scenarios').length;
    const before = loads();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // the run finished before the page opened, so it causes no further load of the list
    expect(loads()).toBe(before);
  });

  it('shows why the agent could not be started, for example when another scenario is already running', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) =>
      url === '/api/scenarios/3/run' && init?.method === 'POST' ? Response.json({ error: 'The agent is already running on a scenario' }, { status: 409 }) : original(url, init),
    );
    await renderPlanner();
    await user.click(await screen.findByRole('button', { name: 'Run estimate' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The agent is already running on a scenario');
  });
});
