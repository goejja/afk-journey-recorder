import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { heroStats, pairReport } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'X']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const record = (mode: string, hero: string, tags: string[] = [], outcome = 'Win') =>
  send('POST', '/api/pvp/fights', {
    mode, mapName: 'Open', outcome, tags,
    formation: { heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null},
    opponent: { heroes: [{ tile: 0, hero: 'X' }] },
  });

describe('filters that take several values', () => {
  beforeEach(async () => {
    await record('Arena', 'A', ['Luna']);
    await record('Supreme Arena', 'B', ['Mia']);
    await record('Guild Duel', 'A', ['Luna', 'Mia'], 'Loss');
  });

  it('lists the PvP records of any of the modes asked, and of all when none is', async () => {
    const modes = async (query: string) => (await json(send('GET', `/api/pvp/fights?${query}`))).map((b: any) => b.mode).sort();
    expect(await modes('mode=Arena&mode=Guild+Duel')).toEqual(['Arena', 'Guild Duel']);
    expect(await modes('mode=Supreme+Arena')).toEqual(['Supreme Arena']);
    expect(await modes('mode=')).toEqual(['Arena', 'Guild Duel', 'Supreme Arena']);
    expect(await modes('')).toEqual(['Arena', 'Guild Duel', 'Supreme Arena']);
  });

  it('lists the records carrying any of the tags asked, ignoring case', async () => {
    const ids = async (query: string) => (await json(send('GET', `/api/pvp/fights?${query}`))).map((b: any) => b.mode).sort();
    expect(await ids('tag=luna')).toEqual(['Arena', 'Guild Duel']);
    expect(await ids('tag=Luna&tag=Mia')).toEqual(['Arena', 'Guild Duel', 'Supreme Arena']);
    expect(await ids('tag=Luna&mode=Supreme+Arena')).toEqual([]); // between filters, all must match
  });

  it('counts the statistics over the modes and tags asked', async () => {
    const games = async (query: string) => (await json(send('GET', `/api/stats/heroes?${query}`))).find((h: any) => h.hero === 'A')?.games;
    expect(await games('mode=Arena')).toBe(1);
    expect(await games('mode=Arena&mode=Guild+Duel')).toBe(2);
    expect(await games('tag=Mia&tag=Luna')).toBe(2);
    expect((heroStats(db, { mode: ['Arena', 'Supreme Arena'] }) as any[]).find((h) => h.hero === 'B').games).toBe(1);
    expect(pairReport(db, { mode: [] }).rows).toBeTruthy(); // an empty list filters nothing
  });
});
