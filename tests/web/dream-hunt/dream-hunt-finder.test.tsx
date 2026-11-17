// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE, TILE_COUNT } from '../../../src/domain/map.js';
import { DreamHuntPage } from '../../../web/dream-hunt/DreamHuntPage.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const hero = (name: string, owned = true) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned, rank: 'Mythic+', equipmentLevel: 10 });
const formation = { artifact: 'Bladestorm', heroes: [{ tile: 38, name: 'Evie', rank: 'Mythic+', equipmentLevel: 10 }], phantimal: null, assist: null };
const layout = {
  key: 'Open#38', mapName: 'Open', layout: { units: [{ kind: 'hero', hero: 'Evie', part: '', tile: 38 }], phantimal: null },
  attempts: 3, clears: 3, bestSeconds: 60, medianSeconds: 60, worstSeconds: 60, lowConfidence: false, latestAttemptId: 1, rule: null,
};
const composition = {
  key: 'evie', heroes: ['Evie'], artifact: 'Bladestorm', attempts: 3, clears: 3, clearRate: 1, bestSeconds: 60, medianSeconds: 60, meanSeconds: 60,
  worstSeconds: 60, lowConfidence: false, latestAttemptId: 1, latest: formation, layouts: [layout], rule: null,
};
const slots = [{ position: 1, boss: 'King Croaker', mapName: 'Open', rule: null }, { position: 2, boss: 'Thalassa', mapName: 'Open', rule: null }];
const attempt = { id: 1, createdAt: '2026-01-05 10:00:00', outcome: 'Win', note: null, boss: 'King Croaker', mapName: 'Open', timeSeconds: 60, bossRule: null, tags: [], battleId: null, battlePosition: null, battleFormationId: null, formation };

const ruleFigures = { attempts: 2, clears: 2, bestSeconds: 30, medianSeconds: 35, worstSeconds: 40, times: [30, 40], rules: ['Boost'] };
let leaderboard: object[];
let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  leaderboard = [composition];
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/reference') return Response.json({ ranks: ['Elite', 'Mythic+'], equipmentLevels: [0, 10], caps: [{ rank: 'Mythic+', minLevel: 0, maxLevel: 10 }] });
      if (url === '/api/bosses') return Response.json([{ name: 'King Croaker', class: null, damageType: null, attempts: 3 }]);
      if (url === '/api/defaults') return Response.json({ 'Supreme Arena': { slots: [], updatedAt: null }, 'Super League': { slots: [], updatedAt: null }, 'Dream Hunt': { slots, updatedAt: null } });
      if (url === '/api/boss-rules') return Response.json([]);
      if (url === '/api/maps') return Response.json([{ name: 'Open', tags: ['Stage'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells, source: 'manual', canRestore: false }]);
      if (url === '/api/heroes') return Response.json([hero('Evie'), hero('Lucca', false)]);
      if (url === '/api/artifacts') return Response.json([{ name: 'Bladestorm', group: 'Season 8' }]);
      if (url === '/api/dream-hunt/attempts/1') return Response.json(attempt);
      if (url.startsWith('/api/dream-hunt/finder')) {
        const params = new URL(url, 'http://x').searchParams;
        return Response.json({ include: params.getAll('include'), exclude: params.getAll('exclude'), rule: 'any', attempts: 3, bosses: [{ boss: 'King Croaker', attempts: 3, compositions: [composition] }] });
      }
      if (url.startsWith('/api/dream-hunt/heroes')) return Response.json(['Evie', 'Lucca']);
      if (url.startsWith('/api/dream-hunt/leaderboard')) return Response.json({ boss: 'King Croaker', rule: 'any', attempts: 3, compositions: leaderboard });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('Finder', () => {
  it('lists, per boss, the teams that hold the included heroes and none of the excluded ones', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Finder' }));
    expect(screen.getByText(/Include or exclude one or more heroes/)).toBeTruthy();
    expect(requests.some((r) => r.url.startsWith('/api/dream-hunt/finder'))).toBe(false);
    await user.type(screen.getByLabelText('Include hero'), 'evi');
    await user.click(await screen.findByRole('button', { name: /Evie/ }));
    const section = within(await screen.findByRole('region', { name: 'Teams against King Croaker' }));
    expect(section.getByRole('button', { name: /Show placements of team 1/ })).toBeTruthy();
    expect(requests.find((r) => r.url.startsWith('/api/dream-hunt/finder'))!.url).toContain('include=Evie');
    await user.type(screen.getByLabelText('Exclude hero'), 'luc');
    await user.click(await screen.findByRole('button', { name: /Lucca/ }));
    expect(requests.at(-1)!.url).toContain('exclude=Lucca');
    expect(screen.getByTitle('Excluded: Lucca')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove Evie' }));
    await user.click(screen.getByRole('button', { name: 'Remove Lucca' }));
    expect(screen.queryByRole('region', { name: 'Teams against King Croaker' })).toBeNull();
  });

  it('offers a hero in one list only, filters live, and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Finder' }));
    await user.type(screen.getByLabelText('Include hero'), 'zzz');
    expect(screen.getByText(/No hero with a recorded fight matches/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Include hero'));
    await user.type(screen.getByLabelText('Include hero'), 'Evie{Enter}');
    await user.type(screen.getByLabelText('Exclude hero'), 'Evie');
    expect(screen.queryByRole('button', { name: /^Evie/ })).toBeNull();
    expect(screen.getByText(/No hero with a recorded fight matches/)).toBeTruthy();
  });
});

describe('Best teams hero filters', () => {
  it('asks the leaderboard for the included and excluded heroes, and offers the heroes of the boss', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Best teams' }));
    await screen.findByRole('button', { name: /Show placements of team 1/ });
    expect(requests.some((r) => r.url.startsWith('/api/dream-hunt/heroes?boss=King+Croaker') || r.url.startsWith('/api/dream-hunt/heroes?boss=King%20Croaker'))).toBe(true);
    await user.type(screen.getByLabelText('Exclude hero'), 'Evie{Enter}');
    await screen.findByTitle('Excluded: Evie');
    const url = requests.filter((r) => r.url.startsWith('/api/dream-hunt/leaderboard')).at(-1)!.url;
    expect(url).toContain('exclude=Evie');
  });
});

describe('Best teams Normal and Rule times', () => {
  async function openBestTeams() {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Best teams' }));
    return screen.findAllByRole('row');
  }

  it('keeps the single line of a team never fought under a Rule', async () => {
    const rows = await openBestTeams();
    expect(within(rows[1]!).queryByTitle(/Under/)).toBeNull();
    expect(within(rows[1]!).queryByText(/Rule only/)).toBeNull();
  });

  it('writes the fights under a Rule beneath the normal ones, and shows their clears as dots on the bar', async () => {
    leaderboard = [{ ...composition, rule: ruleFigures }];
    const row = within((await openBestTeams())[1]!);
    expect(row.getByText('2 under a Rule')).toBeTruthy();
    expect(row.getAllByTitle('Under Boost').length).toBeGreaterThan(0);
    expect(row.getByRole('img', { name: /best 1:00.*under a Rule 30s, 40s/ })).toBeTruthy();
  });

  it('flags a team cleared only under a Rule and writes a dash for its normal figures', async () => {
    leaderboard = [{ ...composition, attempts: 0, clears: 0, clearRate: 0, bestSeconds: null, medianSeconds: null, meanSeconds: null, worstSeconds: null, lowConfidence: true, rule: ruleFigures }];
    const row = within((await openBestTeams())[1]!);
    expect(row.getByText('Rule only')).toBeTruthy();
    expect(row.getAllByText('–').length).toBeGreaterThanOrEqual(3);
    expect(row.getByRole('img', { name: 'under a Rule 30s, 40s' })).toBeTruthy();
  });
});
