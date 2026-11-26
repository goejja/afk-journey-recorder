import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const uses = async (name: string) => (await send('GET', `/api/maps/${encodeURIComponent(name)}/uses`)).json() as Promise<any>;
const attempt = (mode: string, at: string) => Number(db.prepare("INSERT INTO attempt (mode, outcome, created_at) VALUES (?, 'Win', ?)").run(mode, at).lastInsertRowid);

beforeEach(() => {
  db = openDb(':memory:');
  const cells = JSON.stringify(Array(TILE_COUNT).fill(0));
  for (const name of ['Open', 'Walls both sides', 'Arena I']) {
    db.prepare("INSERT OR IGNORE INTO map (name, tags, row_lengths, cells, source) VALUES (?, '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(name, cells);
  }
  db.prepare("INSERT INTO boss (name, class) VALUES ('King Croaker', 'Mage')").run();
  app = createApp(db);
});

describe('what uses a map', () => {
  it('counts the records of each mode, and the stages they sit on', async () => {
    const stage = Number(db.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (8, 0, 'Normal', 12, 'Walls both sides')").run().lastInsertRowid);
    db.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (8, 0, 'Normal', 13, 'Walls both sides')").run();
    db.prepare('INSERT INTO stage_attempt (attempt_id, stage_id) VALUES (?, ?)').run(attempt('Stage', '2026-11-01 10:00:00'), stage);
    db.prepare('INSERT INTO stage_attempt (attempt_id, stage_id) VALUES (?, ?)').run(attempt('Stage', '2026-11-01 11:00:00'), stage);
    db.prepare("INSERT INTO dream_hunt_attempt (attempt_id, boss_name, map_name) VALUES (?, 'King Croaker', 'Walls both sides')").run(attempt('Dream Hunt', '2026-11-02 10:00:00'));
    for (const at of ['2026-11-03 10:00:00', '2026-11-04 10:00:00']) db.prepare("INSERT INTO arena_attempt (attempt_id, mode, map_name) VALUES (?, 'Arena', 'Walls both sides')").run(attempt('Arena', at));
    const scenario = Number(db.prepare("INSERT INTO scenario (name, mode) VALUES ('Rival', 'Arena')").run().lastInsertRowid);
    db.prepare("INSERT INTO scenario_slot (scenario_id, position, map_name) VALUES (?, 1, 'Walls both sides')").run(scenario);

    expect(await uses('Walls both sides')).toEqual({ stages: { stages: 2, records: 2 }, arena: 2, ideas: 0, dreamHunt: 1, titanReaver: 0, scenarios: 1 });
    expect(await uses('Open')).toEqual({ stages: { stages: 0, records: 0 }, arena: 0, ideas: 0, dreamHunt: 0, titanReaver: 0, scenarios: 0 });
  });

  it('answers 404 for an unknown map', async () => {
    expect((await send('GET', '/api/maps/Nowhere/uses')).status).toBe(404);
  });
});

describe('the Open map', () => {
  it('is never deleted, even when nothing uses it', async () => {
    const response = await send('DELETE', '/api/maps/Open');
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/never deleted/);
    expect(db.prepare("SELECT count(*) FROM map WHERE name = 'Open'").pluck().get()).toBe(1);
  });

  it('never has its stages moved off it', async () => {
    db.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (8, 0, 'Normal', 12, 'Open')").run();
    expect((await send('POST', '/api/maps/Open/move-stages', { to: 'Walls both sides' })).status).toBe(409);
    expect(db.prepare("SELECT count(*) FROM stage WHERE map_name = 'Open'").pluck().get()).toBe(1);
  });
});

describe('deleting a map that is used', () => {
  it('refuses with a 409 that names the uses and points to Used by, and keeps the map', async () => {
    const stage = Number(db.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (8, 0, 'Normal', 12, 'Walls both sides')").run().lastInsertRowid);
    db.prepare('INSERT INTO stage_attempt (attempt_id, stage_id) VALUES (?, ?)').run(attempt('Stage', '2026-11-01 10:00:00'), stage);
    db.prepare("INSERT INTO arena_attempt (attempt_id, mode, map_name) VALUES (?, 'Arena', 'Walls both sides')").run(attempt('Arena', '2026-11-03 10:00:00'));
    const response = await send('DELETE', '/api/maps/Walls%20both%20sides');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Walls both sides is used by 1 stage, 1 PvP record, so it cannot be deleted; see Used by' });
    expect(db.prepare("SELECT count(*) FROM map WHERE name = 'Walls both sides'").pluck().get()).toBe(1);
  });

  it('deletes an unused map', async () => {
    expect((await send('DELETE', '/api/maps/Walls%20both%20sides')).status).toBe(204);
  });
});

describe('moving the stages of a map', () => {
  it('points them at the other map, after which the map can be deleted', async () => {
    db.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (8, 0, 'Normal', 12, 'Walls both sides'), (8, 0, 'Normal', 13, 'Walls both sides')").run();
    const response = await send('POST', '/api/maps/Walls%20both%20sides/move-stages', { to: 'Open' });
    expect(await response.json()).toEqual({ moved: 2 });
    expect(db.prepare("SELECT count(*) FROM stage WHERE map_name = 'Open'").pluck().get()).toBe(2);
    expect((await send('DELETE', '/api/maps/Walls%20both%20sides')).status).toBe(204);
  });

  it('moves only stages: a PvP record on the map keeps blocking the delete', async () => {
    db.prepare("INSERT INTO arena_attempt (attempt_id, mode, map_name) VALUES (?, 'Arena', 'Walls both sides')").run(attempt('Arena', '2026-11-03 10:00:00'));
    await send('POST', '/api/maps/Walls%20both%20sides/move-stages', { to: 'Open' });
    expect((await send('DELETE', '/api/maps/Walls%20both%20sides')).status).toBe(409);
  });

  it('refuses an unknown map, itself, and a body without a target', async () => {
    expect((await send('POST', '/api/maps/Walls%20both%20sides/move-stages', { to: 'Nowhere' })).status).toBe(404);
    expect((await send('POST', '/api/maps/Nowhere/move-stages', { to: 'Open' })).status).toBe(404);
    expect((await send('POST', '/api/maps/Arena%20I/move-stages', { to: 'Arena I' })).status).toBe(409);
    expect((await send('POST', '/api/maps/Arena%20I/move-stages', {})).status).toBe(400);
  });
});
