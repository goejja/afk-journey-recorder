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
  for (const name of ['A', 'H']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run('A');
  db.prepare("INSERT INTO boss (name) VALUES ('King Croaker')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const team = { heroes: [{ tile: 38, hero: 'A' }], phantimal: null, assistHero: null, artifact: null};
const battle = (mode: string, tags: string[] = []) =>
  json(send('POST', '/api/pvp/fights', { mode, mapName: 'Open', outcome: 'Win', formation: team, opponent: { heroes: [{ tile: 0, hero: 'H' }] }, tags }));
const age = (id: number, days: number) => db.prepare("UPDATE attempt SET created_at = datetime('now', ?) WHERE id = ?").run(`-${days} days`, id);

describe('cleanup', () => {
  it('previews and removes more records than SQLite has variables for', async () => {
    const insert = db.prepare("INSERT INTO attempt (mode, outcome, created_at) VALUES ('Dream Hunt', 'Win', datetime('now', ?))");
    db.transaction(() => {
      for (let i = 0; i < 33000; i++) insert.run(`-${100 + (i % 5)} days`);
    })();
    const preview = await json(send('POST', '/api/cleanup/preview', { olderThanDays: 30 }));
    expect(preview.count).toBe(33000);
    expect(preview.oldest < preview.newest).toBe(true);
    expect(await json(send('POST', '/api/cleanup/delete', { olderThanDays: 30, expectedCount: 33000 }))).toEqual({ deleted: 33000 });
  });

  it('previews nothing without a date range', async () => {
    expect(await json(send('POST', '/api/cleanup/preview', { olderThanDays: 30 }))).toEqual({ count: 0, oldest: null, newest: null });
  });

  it('previews and removes records older than an age in one mode only', async () => {
    const oldArena = await battle('Arena');
    const oldSupreme = await battle('Supreme Arena');
    const recent = await battle('Arena');
    age(oldArena.id, 90);
    age(oldSupreme.id, 90);
    age(recent.id, 10);

    const preview = await json(send('POST', '/api/cleanup/preview', { mode: 'Arena', olderThanDays: 30 }));
    expect(preview.count).toBe(1);
    expect((await json(send('POST', '/api/cleanup/preview', { olderThanDays: 30 }))).count).toBe(2);

    const removed = await json(send('POST', '/api/cleanup/delete', { mode: 'Arena', olderThanDays: 30, expectedCount: 1 }));
    expect(removed).toEqual({ deleted: 1 });
    expect((await json(send('GET', '/api/pvp/fights'))).map((b: any) => b.id).sort()).toEqual([oldSupreme.id, recent.id].sort());
    expect(db.prepare('SELECT count(*) FROM formation').pluck().get()).toBe(2); // the removed record's rows went with it
    expect(db.prepare('SELECT count(*) FROM arena_opponent_hero').pluck().get()).toBe(2);
  });

  it('can limit the removal to a tag', async () => {
    const mine = await battle('Arena', ['mine']);
    const theirs = await battle('Arena', ['Luna']);
    age(mine.id, 60);
    age(theirs.id, 60);
    await send('POST', '/api/cleanup/delete', { olderThanDays: 30, tag: 'luna', expectedCount: 1 });
    expect((await json(send('GET', '/api/pvp/fights'))).map((b: any) => b.id)).toEqual([mine.id]);
  });

  it('removes nothing unless the confirmed count still matches', async () => {
    const old = await battle('Arena');
    age(old.id, 60);
    expect((await send('POST', '/api/cleanup/delete', { olderThanDays: 30, expectedCount: 5 })).status).toBe(409);
    expect((await send('POST', '/api/cleanup/delete', { olderThanDays: 30 })).status).toBe(400);
    expect(await json(send('GET', '/api/pvp/fights'))).toHaveLength(1);
  });

  it('refuses a request without an age or with an unknown mode', async () => {
    expect((await send('POST', '/api/cleanup/preview', { mode: 'Arena' })).status).toBe(400);
    expect((await send('POST', '/api/cleanup/preview', { olderThanDays: 0 })).status).toBe(400);
    expect((await send('POST', '/api/cleanup/preview', { mode: 'Chess', olderThanDays: 5 })).status).toBe(400);
  });

  it('handles Stage and Dream Hunt records too', async () => {
    const stage = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 1, mapName: 'Open' }));
    const a = await json(send('POST', '/api/attempts', { stageId: stage.id, formation: team }));
    const b = await json(send('POST', '/api/dream-hunt/attempts', { boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 60, formation: team }));
    age(a.id, 100);
    age(b.id, 100);
    expect((await json(send('POST', '/api/cleanup/preview', { mode: 'Stage', olderThanDays: 30 }))).count).toBe(1);
    expect((await json(send('POST', '/api/cleanup/preview', { mode: 'Dream Hunt', olderThanDays: 30 }))).count).toBe(1);
  });

  it('compacts the database', async () => {
    const result = await json(send('POST', '/api/cleanup/optimize'));
    expect(result.bytesBefore).toBeGreaterThan(0);
    expect(result.bytesAfter).toBeGreaterThan(0);
  });
});
