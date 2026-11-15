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
  attempts: 3, clears: 3, bestSeconds: 60, medianSeconds: 60, worstSeconds: 60, lowConfidence: false, latestAttemptId: 1,
};
const composition = {
  key: 'evie', heroes: ['Evie'], artifact: 'Bladestorm', attempts: 3, clears: 3, clearRate: 1, bestSeconds: 60, medianSeconds: 60, meanSeconds: 60,
  worstSeconds: 60, lowConfidence: false, latestAttemptId: 1, latest: formation, layouts: [layout],
};
const slots = [{ position: 1, boss: 'King Croaker', mapName: 'Open', rule: null }, { position: 2, boss: 'Thalassa', mapName: 'Open', rule: null }];
const attempt = { id: 1, createdAt: '2026-01-05 10:00:00', outcome: 'Win', note: null, boss: 'King Croaker', mapName: 'Open', timeSeconds: 60, bossRule: null, tags: [], battleId: null, battlePosition: null, battleFormationId: null, formation };

let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
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
        const heroes = new URL(url, 'http://x').searchParams.getAll('hero');
        return Response.json({ heroes, rule: 'any', attempts: 3, bosses: [{ boss: 'King Croaker', attempts: 3, compositions: [composition] }] });
      }
      if (url.startsWith('/api/dream-hunt/leaderboard')) return Response.json({ boss: 'King Croaker', rule: 'any', attempts: 3, compositions: [composition] });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('Finder', () => {
  it('lists, per boss, the teams holding every hero asked for, offering any hero', async () => {
    const user = userEvent.setup();
    render(<DreamHuntPage />);
    await user.click(await screen.findByRole('tab', { name: 'Finder' }));
    expect(screen.getByText(/Add one or more heroes/)).toBeTruthy();
    expect(requests.some((r) => r.url.startsWith('/api/dream-hunt/finder'))).toBe(false);
    await user.type(screen.getByLabelText('Add hero'), 'Nobody{Enter}');
    expect(screen.getByText(/"Nobody" is not a hero/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Add hero'));
    await user.type(screen.getByLabelText('Add hero'), 'Evie{Enter}');
    const section = within(await screen.findByRole('region', { name: 'Teams against King Croaker' }));
    expect(section.getByRole('button', { name: /Show placements of team 1/ })).toBeTruthy();
    expect(requests.find((r) => r.url.startsWith('/api/dream-hunt/finder'))!.url).toContain('hero=Evie');
    await user.click(screen.getByRole('button', { name: 'Remove Evie' }));
    expect(screen.queryByRole('region', { name: 'Teams against King Croaker' })).toBeNull();
  });
});
