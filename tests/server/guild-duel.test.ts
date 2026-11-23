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
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'X']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  app = createApp(db);
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const fight = (hero: string, extra: Record<string, unknown> = {}) => ({
  mapName: 'Open', outcome: 'Win',
  formation: { heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null},
  opponent: { heroes: [{ tile: 0, hero: 'X' }] },
  ...extra,
});
const group = (fights: unknown[], mode = 'Guild Duel') => send('POST', '/api/pvp/battles', { mode, fights });

describe('Guild Duel battles', () => {
  it('saves three teams as one battle and keeps the Union Level of each side on every fight', async () => {
    const created = await json(group([fight('A', { unionLevel: 42, opponentUnionLevel: 38 }), fight('B', { unionLevel: 42, opponentUnionLevel: 38 }), fight('C', { unionLevel: 42, opponentUnionLevel: 38 })]));
    expect(created.fights.map((f: any) => [f.mode, f.battlePosition, f.unionLevel, f.opponentUnionLevel])).toEqual([
      ['Guild Duel', 1, 42, 38], ['Guild Duel', 2, 42, 38], ['Guild Duel', 3, 42, 38],
    ]);
  });

  it('leaves an unknown Union Level empty, and refuses more than three teams', async () => {
    const created = await json(group([fight('A', { unionLevel: 10 })]));
    expect(created.fights[0]).toMatchObject({ unionLevel: 10, opponentUnionLevel: null });
    expect((await group([fight('A'), fight('B'), fight('C'), fight('X')])).status).toBe(400);
  });

  it('refuses a Union Level outside 0 to 100 or not whole, and one outside Guild Duel', async () => {
    for (const bad of [-1, 101, 4.5, '7']) expect((await group([fight('A', { unionLevel: bad })])).status).toBe(400);
    expect((await group([fight('A', { opponentUnionLevel: 101 })])).status).toBe(400);
    expect((await group([fight('A', { unionLevel: 0, opponentUnionLevel: 100 })])).status).toBe(201);
    expect((await group([fight('A', { unionLevel: 5 })], 'Supreme Arena')).status).toBe(400);
    expect((await send('POST', '/api/pvp/fights', { ...fight('A', { unionLevel: 5 }), mode: 'Arena' })).status).toBe(400);
  });

  it('allows no rule, and a hero on one team only', async () => {
    db.prepare("INSERT INTO boss_rule (name) VALUES ('Berserk')").run();
    expect((await group([fight('A', { rule: 'Berserk' })])).status).toBe(400);
    expect((await group([fight('A'), fight('A')])).status).toBe(400);
  });

  it('can be edited, changing the Union Level', async () => {
    const created = await json(group([fight('A', { unionLevel: 10 }), fight('B', { unionLevel: 10 })]));
    const edited = await json(send('PUT', `/api/pvp/battles/${created.id}`, { fights: [fight('A', { unionLevel: 11, opponentUnionLevel: 9 }), fight('B', { unionLevel: 11, opponentUnionLevel: 9 })] }));
    expect(edited.fights.map((f: any) => [f.unionLevel, f.opponentUnionLevel])).toEqual([[11, 9], [11, 9]]);
  });

  it('appears in the list filter, the query statistics and a scenario', async () => {
    await group([fight('A')]);
    expect(await json(send('GET', '/api/pvp/fights?mode=Guild Duel'))).toHaveLength(1);
    expect(db.prepare("SELECT count(*) FROM v_side WHERE mode = 'Guild Duel'").pluck().get()).toBe(2);
    const scenario = await send('POST', '/api/scenarios', {
      name: 'Duel', mode: 'Guild Duel', note: '',
      slots: ['X', 'A', 'B'].map((hero, i) => ({ mapName: 'Open', rule: null, mine: [], enemy: [{ tile: i, hero, rank: null, equipmentLevel: null }] })),
    });
    expect(await json(scenario)).toMatchObject({ mode: 'Guild Duel' });
  });
});
