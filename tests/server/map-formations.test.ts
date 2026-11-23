import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const names = (prefix: string) => [0, 1, 2].map((i) => `${prefix}${i}`);

beforeEach(() => {
  db = openDb(':memory:');
  for (const name of ['Open', 'Other']) db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES (?, '[\"Arena\",\"Supreme Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(name, JSON.stringify(cells));
  for (const prefix of 'ABCDEFGHIJKLMNOP') for (const name of names(prefix)) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  app = createApp(db);
});

const send = (url: string, body?: unknown) =>
  app.request(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const battle = (mine: string, enemy: string, outcome: 'Win' | 'Loss', mapName = 'Open', mode = 'Arena') =>
  send('/api/pvp/fights', {
    mode,
    mapName,
    outcome,
    formation: { heroes: names(mine).map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null },
    opponent: { heroes: names(enemy).map((hero, i) => ({ tile: i, hero })) },
  });
const play = async (mine: string, enemy: string, results: ('Win' | 'Loss')[], mapName = 'Open', mode = 'Arena') => {
  for (const outcome of results) await battle(mine, enemy, outcome, mapName, mode);
};
const coreOf = (group: any) => group.core.map((h: any) => h.hero);

describe('map formations', () => {
  it('counts both sides of each record, each with its own result, and ranks by win rate then records', async () => {
    await play('A', 'B', ['Win', 'Win', 'Win', 'Loss']); // A 3-1, B 1-3
    await play('C', 'D', ['Win', 'Loss', 'Loss']); // C 1-2, D 2-1
    const groups = await json(send('/api/stats/map-formations?map=Open'));
    expect(groups.map((g: any) => [coreOf(g)[0], g.games, g.wins])).toEqual([
      ['A0', 4, 3],
      ['D0', 3, 2],
      ['C0', 3, 1],
      ['B0', 4, 1],
    ]);
    expect(groups[0]).toMatchObject({ winRate: 0.75 });
  });

  it('leaves out groups with fewer than 3 records and keeps the 5 best', async () => {
    await play('A', 'B', ['Win', 'Win']); // two records each: not listed
    for (const [i, [mine, enemy]] of ['CD', 'EF', 'GH', 'IJ', 'KL', 'MN'].map((p) => [...p]).entries()) await play(mine!, enemy!, i % 2 === 0 ? ['Win', 'Win', 'Loss'] : ['Win', 'Win', 'Win']);
    const groups = await json(send('/api/stats/map-formations?map=Open'));
    expect(groups).toHaveLength(5);
    expect(groups.every((g: any) => g.games >= 3)).toBe(true);
    expect(groups.map(coreOf).flat()).not.toContain('A0');
  });

  it('reads only the map asked for and the filters given', async () => {
    await play('A', 'B', ['Win', 'Win', 'Win']);
    await play('C', 'D', ['Win', 'Win', 'Win'], 'Other');
    await play('E', 'F', ['Win', 'Win', 'Win'], 'Open', 'Supreme Arena');
    expect((await json(send('/api/stats/map-formations?map=Open&mode=Arena'))).map((g: any) => coreOf(g)[0]).sort()).toEqual(['A0', 'B0']);
    expect((await json(send('/api/stats/map-formations?map=Other'))).map((g: any) => coreOf(g)[0]).sort()).toEqual(['C0', 'D0']);
    expect(await json(send('/api/stats/map-formations?map=Open&mode=Guild+Duel'))).toEqual([]);
  });

  it('needs a map', async () => {
    expect((await send('/api/stats/map-formations')).status).toBe(400);
  });
});
