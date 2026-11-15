import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
let app: Hono;
let db: Database.Database;
let dir: string | undefined;

beforeEach(() => {
  db = openDb(':memory:');
  for (const name of ['Arena I', 'Arena II']) {
    db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES (?, '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(name, JSON.stringify(cells));
  }
  for (const name of ['A', 'X']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  app = createApp(db);
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const fight = (mapName: string, mode = 'Treasure Rush') => ({
  mode, mapName, outcome: 'Win',
  formation: { heroes: [{ tile: 38, hero: 'A' }], phantimal: null, assistHero: null, artifact: null},
  opponent: { heroes: [{ tile: 0, hero: 'X' }] },
});

describe('Treasure Rush fights', () => {
  it('are one fight on Arena I, listed as their own mode', async () => {
    const saved = await send('POST', '/api/pvp/battles', fight('Arena I'));
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ mode: 'Treasure Rush', mapName: 'Arena I' });
    expect(db.prepare("SELECT count(*) FROM v_side WHERE mode = 'Treasure Rush'").pluck().get()).toBe(2);
  });

  it('refuse any other map', async () => {
    const refused = await send('POST', '/api/pvp/battles', fight('Arena II'));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Treasure Rush is fought on Arena I only' });
    expect((await send('POST', '/api/pvp/battles', fight('Arena II', 'Arena'))).status).toBe(201); // the other modes are not locked
  });

  it('have no battle of several teams', async () => {
    expect((await send('POST', '/api/pvp/battle-groups', { mode: 'Treasure Rush', fights: [fight('Arena I')] })).status).toBe(400);
  });

  it('can be planned as a scenario on Arena I only', async () => {
    const plan = (mapName: string) => send('POST', '/api/scenarios', { name: 'Rush', mode: 'Treasure Rush', slots: [{ mapName, mine: [], enemy: [{ tile: 0, hero: 'X' }] }] });
    expect((await plan('Arena I')).status).toBe(201);
    expect((await plan('Arena II')).status).toBe(400);
  });
});
