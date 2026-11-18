// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { columnsOf } from '../css-columns.js';
import { DreamHuntPage } from '../../../web/dream-hunt/DreamHuntPage.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned: true, rank: 'Mythic+', equipmentLevel: 10 });
const formation = { artifact: 'Bladestorm', heroes: [{ tile: 38, name: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }], phantimal: null, assist: null };
const composition = (key: string, extra: object) => ({
  key, heroes: ['Evie'], artifact: 'Bladestorm', attempts: 4, clears: 4, clearRate: 1,
  bestSeconds: 60, medianSeconds: 75, meanSeconds: 75, worstSeconds: 90, lowConfidence: false, latest: formation, ...extra,
});

const layout = (mapName: string, tiles: number[], attempts: number, clears: number, median: number | null, hero: string) => ({
  key: `${mapName}#${tiles.join()}`, mapName, layout: { units: tiles.map((tile) => ({ hero, part: '', tile })), phantimal: null },
  attempts, clears, bestSeconds: median, medianSeconds: median, worstSeconds: median, lowConfidence: clears < 3, latestAttemptId: 1,
});

let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/bosses') return Response.json([{ name: 'King Croaker', class: null, damageType: null, attempts: 4 }]);
      if (url === '/api/defaults') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: [], updatedAt: null } });
      if (url.startsWith('/api/defaults/') && method === 'PUT') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Dream Hunt': { slots: body.slots, updatedAt: '2026-10-30 10:00:00' } });
      if (url.startsWith('/api/roster/') && method === 'PUT') return new Response(null, { status: 204 });
      if (url === '/api/boss-rules') return Response.json([{ name: 'Berserk', description: 'Hits harder' }]);
      if (url === '/api/maps') return Response.json([{ name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie')]);
      if (url === '/api/artifacts') return Response.json([{ name: 'Bladestorm', group: 'Season 8' }, { name: 'Arc Burst', group: 'Season 7' }]);
      if (url.startsWith('/api/dream-hunt/leaderboard')) {
        return Response.json({
          boss: 'King Croaker', rule: 'any', attempts: 5,
          compositions: [composition('a', { layouts: [layout('Open', [38], 3, 3, 60, 'Evie'), layout('Open', [39], 1, 0, null, 'Evie')] }), composition('b', { heroes: ['Fay'], attempts: 1, clears: 1, lowConfidence: true })],
        });
      }
      if (url.startsWith('/api/dream-hunt/attempts') && method === 'GET') return Response.json([]);
      if (url === '/api/dream-hunt/attempts' && method === 'POST') return Response.json({ id: 1 }, { status: 201 });
      if (url === '/api/dream-hunt/battle-groups/4' && method === 'PUT') return Response.json({ id: 4, fights: [] });
      if (url === '/api/dream-hunt/battle-groups' && method === 'POST') return Response.json({ id: 1, fights: [] }, { status: 201 });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<DreamHuntPage />);
  await user.click(await screen.findByRole('tab', { name: 'Fights' }));
  await user.click(await screen.findByRole('button', { name: 'New fights' }));
};
const placeHero = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(within(screen.getByRole('list', { name: 'Heroes' })).getByRole('button', { name })); // a click places it on the first free tile
};
// A day is saved as one battle; each of its fights counts as a post here.
const posts = () => requests.filter((r) => r.method === 'POST' && r.url === '/api/dream-hunt/battle-groups').flatMap((r) => (r.body.fights as any[]).map((fight) => ({ ...r, body: fight })));

describe('Fights list', () => {
  it('gives every cell of a day and of a fight its own grid column, empty when it has no value', async () => {
    const bosses = ['Illucia', 'Blightshroom', 'Crazed Shellbrute', 'Lady Starfallen', 'Mirage Frostspike'];
    const fight = (id: number, battleId: number | null, position: number | null, win: boolean) => ({
      id, createdAt: '2026-01-05 10:00:00', season: 8, outcome: win ? 'Win' : 'Loss', note: null, boss: bosses[id % 5], mapName: 'Open', timeSeconds: win ? 60 : null, bossRule: null, tags: [], battleId, battlePosition: position, battleFormationId: null, formation,
    });
    const attempts = [fight(1, null, null, false), ...bosses.map((_, i) => fight(10 + i, 2, i + 1, i % 2 === 0))];
    const fetchBefore = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/dream-hunt/attempts') && (init?.method ?? 'GET') === 'GET' ? Response.json(attempts) : fetchBefore(url, init))));
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Fights' }));
    const day = (await screen.findByRole('listitem', { name: 'Dream Hunt day' })).querySelector('.day-info')!;
    expect(day.children).toHaveLength(columnsOf('.day-info'));
    const line = document.querySelector('.fight-line:not(.in-battle)')!;
    expect(line.children).toHaveLength(columnsOf('.fight-line'));
    await user.click(screen.getByRole('button', { name: 'Show fights' }));
    const inDay = document.querySelector('.fight-line.in-battle')!;
    expect(inDay.children.length).toBeLessThanOrEqual(columnsOf('.fight-line.in-battle'));
  });

  it('colours the clear times of a boss from green to red within a week, and not those of another week or boss', async () => {
    const fight = (id: number, boss: string, createdAt: string, timeSeconds: number) => ({
      id, createdAt, outcome: 'Win', note: null, boss, mapName: 'Open', timeSeconds, bossRule: null, tags: [], battleId: null, battlePosition: null, battleFormationId: null, formation,
    });
    const attempts = [fight(1, 'King Croaker', '2026-01-05 10:00:00', 60), fight(2, 'King Croaker', '2026-01-06 10:00:00', 100), fight(3, 'King Croaker', '2026-01-13 10:00:00', 30), fight(4, 'Thalassa', '2026-01-05 10:00:00', 45)];
    const fetchBefore = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/dream-hunt/attempts') && (init?.method ?? 'GET') === 'GET' ? Response.json(attempts) : fetchBefore(url, init))));
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Fights' }));
    // the newest week is open, the older one is not
    await user.click(await screen.findByRole('button', { name: /Week of Jan 5/ }));
    const times = new Map([...document.querySelectorAll<HTMLElement>('.attempt-info > strong:not(:first-child)')].map((el) => [el.textContent, el.style.getPropertyValue('--worst')]));
    expect(times.get('1:00')).toBe('0'); // 60 against 100 in the same week
    expect(times.get('1:40')).toBe('1');
    expect(times.get('30s')).toBe(''); // alone against its boss that week
    expect(times.get('45s')).toBe(''); // another boss
  });

  it('colours the times under the bosses of a day and its total against the other finished days of the week', async () => {
    const bosses = ['Illucia', 'Blightshroom', 'Crazed Shellbrute', 'Lady Starfallen', 'Mirage Frostspike'];
    const day = (battleId: number, seconds: number) =>
      bosses.map((boss, i) => ({
        id: battleId * 10 + i, createdAt: '2026-01-05 10:00:00', outcome: 'Win', note: null, boss, mapName: 'Open', timeSeconds: seconds, bossRule: null, tags: [], battleId, battlePosition: i + 1, battleFormationId: null, formation,
      }));
    const attempts = [...day(1, 10), ...day(2, 20)];
    const fetchBefore = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/dream-hunt/attempts') && (init?.method ?? 'GET') === 'GET' ? Response.json(attempts) : fetchBefore(url, init))));
    render(<DreamHuntPage />);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Fights' }));
    const days = await screen.findAllByRole('listitem', { name: 'Dream Hunt day' });
    const shares = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>('.ranked')].map((el) => el.style.getPropertyValue('--worst'));
    expect(shares(days[0]!)).toEqual(['0', '0', '0', '0', '0', '0']); // the faster day (10 against 20): five boss times and the total
    expect(shares(days[1]!)).toEqual(['1', '1', '1', '1', '1', '1']);
  });
});

describe('Dream Hunt page', () => {
  it('opens on This week: the bosses as columns and the fastest days played this week under them', async () => {
    const createdAt = '2026-01-05 10:00:00'; // the date does not matter: the weekly default decides what is this week
    const bosses = ['Illucia', 'Blightshroom', 'Crazed Shellbrute', 'Lady Starfallen', 'Mirage Frostspike'];
    const fight = (id: number, battleId: number, position: number, timeSeconds: number | null, outcome = 'Win') => ({
      id, createdAt, outcome, note: null, boss: bosses[position - 1], mapName: 'Open', timeSeconds, bossRule: null, tags: [], battleId, battlePosition: position, battleFormationId: null,
      formation: { ...formation, heroes: [{ tile: 38, name: position === 1 ? 'Zanie' : 'Evie', rank: 'Mythic+', equipmentLevel: 10 }, { tile: 39, name: position === 1 ? 'Zanie' : 'Evie', part: 'Laser Turret', rank: null, equipmentLevel: null }] },
    });
    const day = (battleId: number, times: (number | null)[], outcome = 'Win') => times.map((t, i) => fight(battleId * 10 + i, battleId, i + 1, t, outcome));
    // Day 5 was played against last week's bosses, so it is not part of this week whatever its date. Day 6 has this week's bosses but another rule.
    const lastWeek = [...day(5, [1, 1, 1, 1, 1]).map((f) => ({ ...f, boss: `Old ${f.boss}` })), ...day(6, [1, 1, 1, 1, 1]).map((f) => ({ ...f, bossRule: 'Berserk' }))];
    const attempts = [...day(1, [10, 10, 10, 10, 16.57]), ...day(2, [9, 9, 9, 9, 9]), ...day(3, [1, 1, 1, 1, null]), ...day(4, [1, 1, 1, 1, 1], 'Loss'), ...lastWeek];
    const slots = bosses.map((boss) => ({ boss, mapName: 'Open', rule: null }));
    const defaults = { 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Dream Hunt': { slots, updatedAt: null } };
    const fetchBefore = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/dream-hunt/attempts') && (init?.method ?? 'GET') === 'GET' ? Response.json(attempts) : url === '/api/defaults' ? Response.json(defaults) : fetchBefore(url, init))));
    render(<DreamHuntPage />);
    const table = within(await screen.findByRole('table', { name: 'This week' }));
    expect(await table.findByText('Mirage Frostspike')).toBeTruthy(); // the bosses are the column headings
    const rows = table.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Day 1', 'Day 2']); // a day with a lost or untimed fight is left out
    expect(within(rows[0]!).getByText('45.00s')).toBeTruthy(); // the fastest total first
    expect(within(rows[1]!).getByText('56.57s')).toBeTruthy();
    expect(rows[0]!.querySelectorAll('.week-team-units > span[title="Zanie"]')).toHaveLength(1); // a hero on several tiles shows once
    // Every day fields the same units against each boss: the won, timed fights count (day 3 won four, day 4 was lost, day 1 and 2 won all five).
    const cells = '.week-times .week-time';
    expect(within(rows[1]!).getAllByText('1.00s', { selector: cells })).toHaveLength(4); // the best of 10, 9 and 1
    expect(within(rows[1]!).getAllByText('6.67s', { selector: cells })).toHaveLength(4); // their average
    expect(within(rows[1]!).getByText('9.00s', { selector: cells })).toBeTruthy(); // the last boss: 16.57 and 9
    expect(within(rows[1]!).queryByText(/×/)).toBeNull(); // the number of fights is not shown
    expect(rows[1]!.querySelectorAll('.week-times')[0]!.textContent).toBe('10.00s · best 1.00s · avg 6.67s'); // run, best and average on one line
    // Against each boss the fastest of the days listed is green (0) and the slowest red (1); the last boss took 9 on the fastest day and 16.57 on the other.
    const share = (row: HTMLElement, index: number) => row.querySelectorAll('td')[index + 1]!.querySelector<HTMLElement>('.week-times > .week-time')!.style.getPropertyValue('--worst');
    expect(share(rows[0]!, 0)).toBe('0'); // the fastest day, with 9 against 10
    expect(share(rows[1]!, 0)).toBe('1');
    expect(share(rows[0]!, 4)).toBe('0'); // 9 against 16.57
    expect(share(rows[1]!, 4)).toBe('1');
    expect(table.queryAllByRole('group', { name: 'Layout on Open' })).toHaveLength(0); // collapsed
    await userEvent.setup().click(within(rows[0]!).getByRole('button', { name: /Show placements of day 1/ }));
    expect(await table.findAllByRole('group', { name: 'Layout on Open' })).toHaveLength(5); // where the heroes stood against each boss
  });

  it('ranks teams and flags those with few clears', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Best teams' }));
    expect(await screen.findByText('few clears')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /best 1:00, median 1:15, worst 1:30/ }).length).toBeGreaterThan(0);
  });

  it('shows the answer for the rule chosen last, even when an earlier request answers after it', async () => {
    const user = userEvent.setup();
    const before = globalThis.fetch;
    let releaseAny: () => void = () => undefined;
    const slowAny = new Promise<void>((resolve) => (releaseAny = resolve));
    // only the board of the rule chosen last holds a team flagged "few clears"
    const board = (rule: string, key: string) => ({ boss: 'King Croaker', rule, attempts: 1, compositions: [composition(key, { lowConfidence: rule === 'Berserk' })] });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.startsWith('/api/dream-hunt/leaderboard')) return before(url, init);
      if (url.includes('rule=Berserk')) return Response.json(board('Berserk', 'berserk-team'));
      await slowAny; // the first request, for every rule, answers only after the second one
      return Response.json(board('any', 'any-team'));
    }));
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Best teams' }));
    await user.selectOptions(await screen.findByLabelText('Rule'), 'Berserk');
    expect(await screen.findByText('few clears')).toBeTruthy();
    releaseAny();
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the late answer arrive
    expect(screen.getByText('few clears')).toBeTruthy();
  });

  it('opens a team to show each placement with its fights and times', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Best teams' }));
    await user.click((await screen.findAllByRole('button', { name: /Show placements of team 1/ }))[0]!);
    expect(await screen.findByText('fastest')).toBeTruthy();
    expect(screen.getAllByRole('group', { name: 'Layout on Open' })).toHaveLength(2);
    expect(screen.getByText(/3 fights, 3 clears/)).toBeTruthy();
    expect(screen.getByText(/1 fight, 0 clears/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Hide placements of team 1/ }));
    expect(screen.queryByRole('group', { name: 'Layout on Open' })).toBeNull();
  });

  it('swaps the formation of two fights while the boss, map and result stay with each fight', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await placeHero(user, /^Evie/);
    expect(screen.getByRole('tab', { name: 'Fight 1 (1)' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Swap formation with'), 'Fight 5');
    expect(screen.getByRole('tab', { name: 'Fight 1' })).toBeTruthy(); // fight 1 is empty now
    expect(screen.getByRole('tab', { name: 'Fight 5 (1)' })).toBeTruthy();
    expect(screen.queryByLabelText('Swap formation with')).toBeTruthy();
  });

  it('asks for a clear time when the fight was cleared', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await placeHero(user, /^Evie/);
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/clear time/i);
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('offers only the current season’s artifacts', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Fights' }));
    await user.click(await screen.findByRole('button', { name: 'New fights' }));
    await user.click(await screen.findByRole('button', { name: 'Choose artifact' }));
    const names = within(screen.getByRole('list', { name: 'Artifacts' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Bladestorm']);
  });

  it('records the five fights of a day on tabs, only the fifth with a rule, and greys out heroes used elsewhere', async () => {
    const user = userEvent.setup();
    await openForm(user);
    expect(screen.getAllByRole('tab').filter((t) => /^Fight \d/.test(t.textContent ?? '')).map((t) => t.textContent)).toEqual(['Fight 1', 'Fight 2', 'Fight 3', 'Fight 4', 'Fight 5']);
    expect(screen.queryByLabelText('Rule')).toBeNull();
    await placeHero(user, /^Evie/);
    await user.type(screen.getByLabelText('Clear time'), '1:10');

    await user.click(screen.getByRole('tab', { name: /^Fight 2/ }));
    const evie = within(screen.getByRole('list', { name: 'Heroes' })).getByRole('button', { name: /^Evie/ }) as HTMLButtonElement;
    expect(evie.disabled).toBe(false); // used in fight 1, but it can be moved here
    expect(evie.title).toMatch(/fight 1/);

    await user.click(screen.getByRole('tab', { name: /^Fight 5/ }));
    expect(screen.getByLabelText('Rule')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /^Fight 1/ }));
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    await waitFor(() => expect(posts()).toHaveLength(1)); // fights without heroes are skipped
    expect(posts()[0]!.body).toMatchObject({ boss: 'King Croaker', timeSeconds: 70, outcome: 'Win' });
  });

  it('keeps the formation after "Save and record another", clearing only the time', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await placeHero(user, /^Evie/);
    await user.type(screen.getByLabelText('Clear time'), '1:10');
    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((await screen.findByRole('status')).textContent).toMatch(/Saved 1 fight/);
    expect((screen.getByLabelText('Clear time') as HTMLInputElement).value).toBe('');
    expect(within(screen.getByRole('list', { name: 'Placed on Your formation' })).getByText('Evie')).toBeTruthy();

    await user.type(screen.getByLabelText('Clear time'), '1:05');
    await user.click(screen.getByRole('button', { name: 'Save and record another' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]!.body).toMatchObject({ timeSeconds: 65, formation: { heroes: [{ hero: 'Evie' }] } });
  });

  it('keeps the team and its artifact when the map changes, moving a hero off a deployment tile', async () => {
    const user = userEvent.setup();
    const shifted = cells.map((_, i) => (i >= 40 ? TILE.PLAYER : i < 5 ? TILE.ENEMY : TILE.OPEN));
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      url === '/api/maps'
        ? Response.json([
            { name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false },
            { name: 'Shifted', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: shifted, source: 'manual', canRestore: false },
          ])
        : base(url, init)));
    await openForm(user);
    await placeHero(user, /^Evie/); // tile 38 on Open
    await user.selectOptions(screen.getByLabelText('Map'), 'Shifted');
    await user.type(screen.getByLabelText('Clear time'), '1:10');
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body.formation.heroes).toEqual([expect.objectContaining({ tile: 40, hero: 'Evie' })]);
  });

  it('clones a fight into the first of new fights, without its result, time or note', async () => {
    const user = userEvent.setup();
    const saved = { id: 4, createdAt: '2026-10-29', outcome: 'Win', note: 'lucky', boss: 'King Croaker', mapName: 'Open', timeSeconds: 70, bossRule: null, tags: ['Luna'], battleId: null, battlePosition: null, formation };
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      url.startsWith('/api/dream-hunt/attempts') && (init?.method ?? 'GET') === 'GET' ? Response.json([saved]) : base(url, init)));
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Fights' }));
    await user.click(await screen.findByRole('button', { name: 'Clone' }));
    expect(within(screen.getByRole('list', { name: 'Placed on Your formation' })).getByText('Evie')).toBeTruthy();
    expect((screen.getByLabelText('Clear time') as HTMLInputElement).value).toBe('');
    await user.type(screen.getByLabelText('Clear time'), '1:20');
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ boss: 'King Croaker', outcome: 'Win', timeSeconds: 80, note: '', tags: ['Luna'], formation: { heroes: [{ hero: 'Evie' }] } });
  });

  it('saves the fights of a day as one battle, each with its number and the day’s shared tags', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByLabelText('Add tag'), 'Luna{Enter}');
    await placeHero(user, /^Evie/);
    await user.type(screen.getByLabelText('Clear time'), '1:10');
    await user.click(screen.getByRole('tab', { name: /^Fight 2/ }));
    expect(screen.getByText('Luna', { selector: '.badge' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(requests.filter((r) => r.url === '/api/dream-hunt/battle-groups')).toHaveLength(1);
    expect(posts()[0]!.body).toMatchObject({ position: 1, tags: ['Luna'] });
  });

  describe('with fights grouped into a day', () => {
    const saved = (id: number, position: number | null, outcome: 'Win' | 'Loss') => ({
      id, createdAt: '2026-10-29', outcome, note: null, boss: 'King Croaker', mapName: 'Open', timeSeconds: outcome === 'Win' ? 70 : null, bossRule: null, tags: ['Luna'],
      battleId: position === null ? null : 4, battlePosition: position, formation,
    });
    const listed = [saved(24, 2, 'Loss'), saved(23, 1, 'Win'), saved(22, null, 'Win')];

    beforeEach(() => {
      const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
        url.startsWith('/api/dream-hunt/attempts') && (init?.method ?? 'GET') === 'GET' ? Response.json(listed) : base(url, init)));
    });
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      render(<DreamHuntPage />);
      await user.click(await screen.findByRole('tab', { name: 'Fights' }));
      return screen.findByRole('listitem', { name: 'Dream Hunt day' });
    };

    it('shows a day as one collapsed row: the bosses in order with their results and the total time', async () => {
      const user = userEvent.setup();
      const card = within(await open(user));
      expect(card.getByText('1/2 cleared')).toBeTruthy();
      expect(card.getByTitle('The clear times of the cleared fights added up').textContent).toBe('total 1:10');
      const strip = within(card.getByLabelText('Bosses of the day'));
      expect(strip.getAllByTitle(/^Fight \d:/).map((f) => f.getAttribute('title'))).toEqual([
        'Fight 1: King Croaker, cleared in 1:10', 'Fight 2: King Croaker, not cleared', 'Fight 3: not recorded', 'Fight 4: not recorded', 'Fight 5: not recorded',
      ]);
      expect(card.queryByRole('list', { name: 'Fights of the day' })).toBeNull(); // collapsed
      await user.click(card.getByRole('button', { name: 'Show fights' }));
      expect(within(card.getByRole('list', { name: 'Fights of the day' })).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['Fight 1', 'Fight 2']);
      await user.click(screen.getByLabelText('Group by day'));
      expect(screen.queryByRole('listitem', { name: 'Dream Hunt day' })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(3);
    });

    it('expands and collapses every day, and keeps the days under their week', async () => {
      const user = userEvent.setup();
      await open(user);
      expect(screen.getByRole('button', { name: /Week of Oct 26, 2026/ }).getAttribute('aria-expanded')).toBe('true'); // the newest week is open
      await user.click(screen.getByRole('button', { name: 'Expand all' }));
      expect(screen.getByRole('list', { name: 'Fights of the day' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Collapse all' }));
      expect(screen.queryByRole('listitem', { name: 'Dream Hunt day' })).toBeNull();
    });

    it('edits the whole day in the day editor, saving every fight in one request', async () => {
      const user = userEvent.setup();
      const day = within(await open(user));
      await user.click(day.getByRole('button', { name: 'Edit' }));
      expect(screen.getByRole('heading', { name: 'Edit Dream Hunt day' })).toBeTruthy();
      expect(screen.getAllByRole('tab', { name: /^Fight \d/ }).map((t) => t.textContent)).toEqual(['Fight 1 (1)', 'Fight 2 (1)', 'Fight 3', 'Fight 4', 'Fight 5']);
      expect((screen.getByLabelText('Clear time') as HTMLInputElement).value).toBe('1:10'); // an edit keeps the saved time
      expect(screen.queryByRole('button', { name: 'Save and record another' })).toBeNull();
      await user.clear(screen.getByLabelText('Clear time'));
      await user.type(screen.getByLabelText('Clear time'), '9.69');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/dream-hunt/battle-groups/4')).toBeTruthy());
      const fights = requests.find((r) => r.url === '/api/dream-hunt/battle-groups/4')!.body.fights;
      expect(fights.map((f: any) => [f.position, f.timeSeconds])).toEqual([[1, 9.69], [2, null]]);
    });

    it('ungroups or deletes a day, and clones it into the same fight numbers', async () => {
      const user = userEvent.setup();
      const day = within(await open(user));
      await user.click(day.getByRole('button', { name: 'Ungroup' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ungroup' }));
      await waitFor(() => expect(requests.find((r) => r.method === 'DELETE')?.url).toBe('/api/battles/4'));
      await user.click(day.getByRole('button', { name: 'Delete' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(requests.filter((r) => r.method === 'DELETE').at(-1)?.url).toBe('/api/battles/4?fights=delete'));
      await user.click(day.getByRole('button', { name: 'Clone' }));
      expect(screen.getAllByRole('tab', { name: /^Fight \d/ }).map((t) => t.textContent)).toEqual(['Fight 1 (1)', 'Fight 2 (1)', 'Fight 3', 'Fight 4', 'Fight 5']);
      expect((screen.getByLabelText('Clear time') as HTMLInputElement).value).toBe(''); // the clone starts without the old time
    });
  });

  it('has no assist hero, shows the artifact on the map, and edits a hero’s rank by clicking it on the map', async () => {
    const user = userEvent.setup();
    await openForm(user);
    expect(screen.queryByRole('button', { name: 'Choose assist hero' })).toBeNull();
    await placeHero(user, /^Evie/);
    await user.click(screen.getByRole('button', { name: 'Choose artifact' }));
    await user.click(within(screen.getByRole('list', { name: 'Artifacts' })).getByRole('button', { name: 'Bladestorm' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.querySelector('.map-slot .hex-slot')?.getAttribute('title')).toMatch(/Bladestorm/);

    expect(screen.queryByRole('group', { name: 'Rank of Evie' })).toBeNull();
    await user.click(within(screen.getByRole('group', { name: 'Your formation map' })).getAllByRole('button', { name: /Player deployment|Evie/ })[0]!);
    expect(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: 'Mythic+' }).getAttribute('aria-pressed')).toBe('true'); // from the roster
    await user.click(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: 'Elite' }));
    expect(document.querySelector('.tile-tag')).toBeNull(); // Dream Hunt draws no rank tags; the Stages form does
    await user.type(screen.getByLabelText('Clear time'), '1:10');
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body.formation.heroes[0]).toMatchObject({ hero: 'Evie', rank: 'Elite', equipmentLevel: null });
  });

  it('saves the bosses, maps and the last fight’s rule as the week’s default', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.click(screen.getByRole('button', { name: /Set as this week/ }));
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')?.url).toBe('/api/defaults/Dream%20Hunt'));
    const slots = requests.find((r) => r.method === 'PUT')!.body.slots;
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual({ boss: 'King Croaker', mapName: 'Open', rule: null });
    expect(await screen.findByText(/Saved as this week/)).toBeTruthy();
  });

  it('takes a clear time in seconds with hundredths', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await placeHero(user, /^Evie/);
    await user.type(screen.getByLabelText('Clear time'), '9s69');
    await user.click(screen.getByRole('button', { name: 'Save fights' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body.timeSeconds).toBe(9.69);
  });

  describe('roster sync after saving', () => {
    const setRank = async (user: ReturnType<typeof userEvent.setup>, rank: string) => {
      await placeHero(user, /^Evie/);
      await user.type(screen.getByLabelText('Clear time'), '9.69');
      await user.click(within(screen.getByRole('group', { name: 'Your formation map' })).getAllByRole('button', { name: /Player deployment|Evie/ })[0]!);
      await user.click(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: rank }));
      await user.click(screen.getByRole('button', { name: 'Save fights' }));
    };

    it('offers an upgrade ticked, and updates the roster of the default profile when asked', async () => {
      const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url === '/api/heroes' ? Response.json([{ ...hero('Evie'), rank: 'Elite', equipmentLevel: null }]) : base(url, init))));
      const user = userEvent.setup();
      await openForm(user);
      await setRank(user, 'Mythic+');
      const dialog = within(await screen.findByRole('dialog', { name: 'Update the roster?' }));
      expect((dialog.getByLabelText('Update Evie') as HTMLInputElement).checked).toBe(true);
      await user.click(dialog.getByRole('button', { name: 'Update roster' }));
      await waitFor(() => expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/roster/Evie')?.body).toMatchObject({ rank: 'Mythic+' }));
      expect(screen.queryByRole('dialog', { name: 'Update the roster?' })).toBeNull();
    });

    it('offers a lower state unticked, and Skip leaves the roster alone', async () => {
      const user = userEvent.setup();
      await openForm(user);
      await setRank(user, 'Elite'); // the roster has Mythic+
      const dialog = within(await screen.findByRole('dialog', { name: 'Update the roster?' }));
      expect((dialog.getByLabelText('Update Evie') as HTMLInputElement).checked).toBe(false);
      expect((dialog.getByRole('button', { name: 'Update roster' }) as HTMLButtonElement).disabled).toBe(true);
      await user.click(dialog.getByRole('button', { name: 'Skip' }));
      expect(requests.some((r) => r.url.startsWith('/api/roster/'))).toBe(false);
      expect(posts()).toHaveLength(1); // the record is saved either way
    });

    it('can bring the saved record to the roster’s state instead of the roster to the record’s', async () => {
      const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url === '/api/dream-hunt/battle-groups' && init?.method === 'POST') {
            await base(url, init); // keep the request in the log
            return Response.json({ id: 1, fights: [{ id: 41 }] }, { status: 201 });
          }
          if (url === '/api/records/hero-states') {
            requests.push({ method: 'POST', url, body: JSON.parse(init!.body as string) });
            return Response.json({ corrected: 1 });
          }
          return base(url, init);
        }),
      );
      const user = userEvent.setup();
      await openForm(user);
      await setRank(user, 'Elite'); // the record is lower than the roster's Mythic+: probably cloned from an older fight
      const dialog = within(await screen.findByRole('dialog', { name: 'Update the roster?' }));
      await user.click(dialog.getByLabelText('Fix record for Evie'));
      expect((dialog.getByLabelText('Update Evie') as HTMLInputElement).checked).toBe(false); // one or the other
      await user.click(dialog.getByRole('button', { name: 'Fix record' }));
      await waitFor(() => expect(requests.find((r) => r.url === '/api/records/hero-states')?.body).toMatchObject({ attemptIds: [41], side: 'A', heroes: [{ hero: 'Evie', rank: 'Mythic+' }] }));
      expect(requests.some((r) => r.url.startsWith('/api/roster/'))).toBe(false);
    });

    it('asks nothing when the record agrees with the roster', async () => {
      const user = userEvent.setup();
      await openForm(user);
      await placeHero(user, /^Evie/);
      await user.type(screen.getByLabelText('Clear time'), '9.69');
      await user.click(screen.getByRole('button', { name: 'Save fights' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(screen.queryByRole('dialog', { name: 'Update the roster?' })).toBeNull();
    });
  });

  it('has no Rules tab: rules are managed in Admin', async () => {
    render(<DreamHuntPage />);
    await screen.findByRole('tab', { name: 'Fights' });
    expect(screen.queryByRole('tab', { name: 'Rules' })).toBeNull();
  });
});

describe('Fights, older than the list', () => {
  const fight = (id: number) => ({ id, createdAt: '2026-10-29', outcome: 'Win', note: null, boss: 'King Croaker', mapName: 'Open', timeSeconds: 70, bossRule: null, tags: [], battleId: null, battlePosition: null, battleFormationId: null, formation: { artifact: null, phantimal: null, assist: null, heroes: [] } });
  const listing = (count: number) => {
    const fetchBefore = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.startsWith('/api/dream-hunt/attempts?') ? (requests.push({ method: 'GET', url }), Response.json(Array.from({ length: count }, (_, i) => fight(i + 1)))) : fetchBefore(url, init))));
  };

  it('offers older fights only when one more than the page came back, and asks for that one', async () => {
    listing(101);
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Fights' }));
    expect(await screen.findByRole('button', { name: 'Show older fights' })).toBeTruthy();
    expect(requests.some((r) => r.url.startsWith('/api/dream-hunt/attempts?') && r.url.includes('limit=101'))).toBe(true);
  });

  it('does not offer them when the list ends exactly at the page', async () => {
    listing(100);
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Fights' }));
    await waitFor(() => expect(requests.some((r) => r.url.startsWith('/api/dream-hunt/attempts?'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: 'Show older fights' })).toBeNull();
  });
});
