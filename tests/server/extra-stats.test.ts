import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(async () => {
  db = openDb(':memory:');
  for (const name of ['Open', 'Other']) db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES (?, '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(name, JSON.stringify(cells));
  for (const name of ['A', 'B', 'X']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Season 8')").run();
  db.prepare("INSERT INTO boss_rule (name, description) VALUES ('Berserk', '')").run();
  app = createApp(db);
  const side = (units: [string, number][], artifact: string | null = null) => ({ heroes: units.map(([hero, tile]) => ({ tile, hero })), phantimal: null, assistHero: null, artifact});
  const fight = (mode: string, mapName: string, outcome: string, mine: [string, number][], enemy: [string, number][], extra: Record<string, unknown> = {}, artifact: string | null = null) =>
    send('POST', '/api/pvp/fights', { mode, mapName, outcome, formation: side(mine, artifact), opponent: { heroes: enemy.map(([hero, tile]) => ({ tile, hero })) }, ...extra });
  await fight('Arena', 'Open', 'Win', [['A', 44], ['B', 38]], [['X', 0]], {}, 'Bladestorm');
  await fight('Arena', 'Open', 'Loss', [['A', 38]], [['X', 0]], {}, 'Bladestorm');
  await fight('Supreme Arena', 'Other', 'Win', [['B', 43]], [['X', 4]], { rule: 'Berserk' });
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

describe('artifact, map, row and pick rate statistics', () => {
  it('gives the win rate of each artifact from the side that used it', async () => {
    expect(await json(send('GET', '/api/stats/artifacts'))).toEqual([{ artifact: 'Bladestorm', games: 2, wins: 1, winRate: 0.5 }]);
    expect(await json(send('GET', '/api/stats/artifacts?mode=Supreme+Arena'))).toEqual([]);
  });

  it('gives the win rate of each map from Side A, since counting both sides would always give half', async () => {
    expect(await json(send('GET', '/api/stats/maps'))).toEqual([
      { map: 'Open', games: 2, wins: 1, winRate: 0.5 },
      { map: 'Other', games: 1, wins: 1, winRate: 1 },
    ]);
    expect(await json(send('GET', '/api/stats/maps?mode=Arena'))).toEqual([{ map: 'Open', games: 2, wins: 1, winRate: 0.5 }]);
  });

  it('gives the win rate of a hero by game row, reading Side B from its own point of view', async () => {
    expect(await json(send('GET', '/api/stats/heroes/A/rows'))).toEqual([
      { row: 1, games: 1, wins: 0, winRate: 0 }, // tile 38 is in the back game row
      { row: 2, games: 1, wins: 1, winRate: 1 }, // tile 44
    ]);
    expect(await json(send('GET', '/api/stats/heroes/X/rows'))).toEqual([
      { row: 2, games: 2, wins: 1, winRate: 0.5 }, // tile 0 turned over is tile 44
      { row: 3, games: 1, wins: 0, winRate: 0 }, // tile 4 turned over is tile 40
    ]);
  });

  it('gives each hero a pick rate: its share of all sides in the filter', async () => {
    const heroes = await json(send('GET', '/api/stats/heroes'));
    expect(Object.fromEntries(heroes.map((h: any) => [h.hero, h.pickRate]))).toEqual({ A: 0.333, B: 0.333, X: 0.5 });
    const arena = await json(send('GET', '/api/stats/heroes?mode=Arena'));
    expect(Object.fromEntries(arena.map((h: any) => [h.hero, h.pickRate]))).toEqual({ A: 0.5, B: 0.25, X: 0.5 });
  });
});
