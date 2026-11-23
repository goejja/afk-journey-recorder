import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'X']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const battle = (extra: Record<string, unknown> = {}) => ({
  mode: 'Arena', mapName: 'Open', outcome: 'Win',
  formation: { heroes: [{ tile: 38, hero: 'A' }], phantimal: null, assistHero: null, artifact: null},
  opponent: { heroes: [{ tile: 0, hero: 'X' }] },
  ...extra,
});

describe('Player ID of one side', () => {
  it('saves a Player ID per side, and leaves a side alone when it is not sent', async () => {
    const created = await json(send('POST', '/api/pvp/fights', battle({ playerIdA: '10000002', playerIdB: '10000003' })));
    expect(created).toMatchObject({ playerIdA: '10000002', playerIdB: '10000003' });
    const updated = await json(send('PUT', `/api/pvp/fights/${created.id}`, battle({ playerIdB: '11111111' })));
    expect(updated).toMatchObject({ playerIdA: '10000002', playerIdB: '11111111' });
    const cleared = await json(send('PUT', `/api/pvp/fights/${created.id}`, battle({ playerIdA: null })));
    expect(cleared).toMatchObject({ playerIdA: null, playerIdB: '11111111' });
  });

  it('has no Player ID on a side that was never given one', async () => {
    expect(await json(send('POST', '/api/pvp/fights', battle()))).toMatchObject({ playerIdA: null, playerIdB: null });
  });

  it('trims the ID, and treats empty text as none', async () => {
    const created = await json(send('POST', '/api/pvp/fights', battle({ playerIdA: ' 123 ', playerIdB: '  ' })));
    expect(created).toMatchObject({ playerIdA: '123', playerIdB: null });
  });

  it('refuses a Player ID that is not text', async () => {
    expect((await send('POST', '/api/pvp/fights', battle({ playerIdA: { id: 1 } }))).status).toBe(400);
  });

  it('removes the IDs with the record', async () => {
    const { id } = await json(send('POST', '/api/pvp/fights', battle({ playerIdA: '123' })));
    await send('DELETE', `/api/attempts/${id}`);
    expect(db.prepare('SELECT count(*) FROM attempt_player').pluck().get()).toBe(0);
  });

  it('carries the IDs of every team of a battle group', async () => {
    const team = (hero: string, tile: number, enemy: string, enemyTile: number) => ({
      ...battle({ playerIdA: '123', playerIdB: '456' }),
      mode: undefined,
      formation: { heroes: [{ tile, hero }], phantimal: null, assistHero: null, artifact: null},
      opponent: { heroes: [{ tile: enemyTile, hero: enemy }] },
    });
    const created = await json(send('POST', '/api/pvp/battles', { mode: 'Supreme Arena', fights: [team('A', 38, 'X', 0)] }));
    expect(created.fights[0]).toMatchObject({ playerIdA: '123', playerIdB: '456' });
  });
});
