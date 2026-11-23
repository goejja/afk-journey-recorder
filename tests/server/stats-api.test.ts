import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\",\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'H']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const team = (names: string[]) => ({ heroes: names.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null});

describe('stats', () => {
  it('gives hero and pair win rates from both Arena sides, and the summary', async () => {
    await send('POST', '/api/pvp/fights', { mode: 'Arena', mapName: 'Open', outcome: 'Win', formation: team(['A', 'B']), opponent: { heroes: [{ tile: 0, hero: 'H' }] } });
    const heroes = await json(send('GET', '/api/stats/heroes?mode=Arena'));
    expect(Object.fromEntries(heroes.map((h: any) => [h.hero, [h.games, h.wins]]))).toEqual({ A: [1, 1], B: [1, 1], H: [1, 0] });
    expect((await json(send('GET', '/api/stats/heroes?min=2'))).length).toBe(0);
    expect(await json(send('GET', '/api/stats/pairs'))).toEqual([{ heroA: 'A', heroB: 'B', games: 1, wins: 1, winRate: 1 }]);
    expect((await json(send('GET', '/api/stats/summary'))).records).toMatchObject([{ mode: 'Arena', records: 1, wins: 1 }]);
  });

  it('gives win rates of heroes fielded three together on one side, never across the two sides', async () => {
    await send('POST', '/api/pvp/fights', { mode: 'Arena', mapName: 'Open', outcome: 'Win', formation: team(['A', 'B', 'H']), opponent: { heroes: [{ tile: 0, hero: 'H' }, { tile: 1, hero: 'A' }] } });
    await send('POST', '/api/pvp/fights', { mode: 'Supreme Arena', mapName: 'Open', outcome: 'Loss', formation: team(['A', 'B', 'H']), opponent: { heroes: [{ tile: 0, hero: 'A' }] } });
    expect(await json(send('GET', '/api/stats/trios'))).toEqual([{ heroA: 'A', heroB: 'B', heroC: 'H', games: 2, wins: 1, winRate: 0.5 }]);
    expect(await json(send('GET', '/api/stats/trios?mode=Arena'))).toEqual([{ heroA: 'A', heroB: 'B', heroC: 'H', games: 1, wins: 1, winRate: 1 }]);
    expect(await json(send('GET', '/api/stats/trios?min=3'))).toEqual([]);
  });
});
