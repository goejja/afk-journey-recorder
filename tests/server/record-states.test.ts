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
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'H']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const [rank, i] of [['Mythic', 1], ['Mythic+', 2]] as const) db.prepare('INSERT INTO rank (name, position) VALUES (?, ?)').run(rank, i);
  for (const level of [0, 5, 10]) db.prepare('INSERT INTO equipment_level (level) VALUES (?)').run(level);
  for (const rank of ['Mythic', 'Mythic+']) db.prepare('INSERT INTO rank_equipment_cap (rank, min_level, max_level) VALUES (?, 0, 10)').run(rank);
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const fight = async () =>
  json(
    send('POST', '/api/pvp/battles', {
      mode: 'Arena', mapName: 'Duel', outcome: 'Win',
      formation: { heroes: [{ tile: 38, hero: 'A', rank: 'Mythic', equipmentLevel: 0 }, { tile: 39, hero: 'B', rank: 'Mythic', equipmentLevel: 0 }], phantimal: null, assistHero: null, artifact: null},
      opponent: { heroes: [{ tile: 0, hero: 'H', rank: 'Mythic', equipmentLevel: 0 }] },
    }),
  );

describe('correcting the states a record stored', () => {
  it('sets the rank and equipment of the named heroes on one side and leaves the others and the other side alone', async () => {
    const saved = await fight();
    const res = await send('POST', '/api/records/hero-states', { attemptIds: [saved.id], side: 'A', heroes: [{ hero: 'A', rank: 'Mythic+', equipmentLevel: 10 }, { hero: 'H', rank: 'Mythic+', equipmentLevel: 10 }] });
    expect(await res.json()).toEqual({ corrected: 1 }); // H is on Side B, not on the side asked
    const after = (await json(send('GET', '/api/pvp/battles')))[0];
    expect(after.formation.heroes.map((h: any) => [h.name, h.rank, h.equipmentLevel])).toEqual([['A', 'Mythic+', 10], ['B', 'Mythic', 0]]);
    expect(after.opponent.heroes[0]).toMatchObject({ name: 'H', rank: 'Mythic', equipmentLevel: 0 });
  });

  it('corrects Side B too', async () => {
    const saved = await fight();
    await send('POST', '/api/records/hero-states', { attemptIds: [saved.id], side: 'B', heroes: [{ hero: 'H', rank: 'Mythic+', equipmentLevel: 5 }] });
    expect((await json(send('GET', '/api/pvp/battles')))[0].opponent.heroes[0]).toMatchObject({ rank: 'Mythic+', equipmentLevel: 5 });
  });

  it('refuses a state the rules do not allow, an unknown record and a bad request, and changes nothing', async () => {
    const saved = await fight();
    const bad = await send('POST', '/api/records/hero-states', { attemptIds: [saved.id], side: 'A', heroes: [{ hero: 'A', rank: 'Nonsense', equipmentLevel: null }] });
    expect(bad.status).toBe(400);
    expect((await send('POST', '/api/records/hero-states', { attemptIds: [999], side: 'A', heroes: [{ hero: 'A', rank: 'Mythic+', equipmentLevel: null }] })).status).toBe(404);
    expect((await send('POST', '/api/records/hero-states', { attemptIds: [saved.id], side: 'C', heroes: [{ hero: 'A', rank: null, equipmentLevel: null }] })).status).toBe(400);
    expect((await send('POST', '/api/records/hero-states', { attemptIds: [], side: 'A', heroes: [{ hero: 'A', rank: null, equipmentLevel: null }] })).status).toBe(400);
    expect((await json(send('GET', '/api/pvp/battles')))[0].formation.heroes[0]).toMatchObject({ rank: 'Mythic', equipmentLevel: 0 });
  });
});
