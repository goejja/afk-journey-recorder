import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const MAP = "INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')";

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare(MAP).run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
    db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
    db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  }
  db.prepare("INSERT INTO boss (name) VALUES ('Aegis'), ('Basilisk')").run();
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Season 8'), ('Frostbite', 'Season 8')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const phaseNow = async () => (await json(send('GET', '/api/seasons'))).find((s: any) => s.current).phase as number;
const gridPhase = async () => (await json(send('GET', '/api/stage-grid'))).phase as number;

const team = (names: string[], artifact: string | null = 'Bladestorm') => ({ heroes: names.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact });
const clear = async (stage: { season: number; phase: number; kind: string; number: number }) => {
  const found = await json(send('POST', '/api/stages', { ...stage, mapName: 'Open' }));
  return send('POST', '/api/attempts', { stageId: found.id, formation: team(['A']) });
};
const titanBattle = (seasonPhase: number) =>
  send('POST', '/api/titan-reaver/battles', {
    seasonPhase,
    titanPhase: 'Charge',
    level: 500,
    note: '',
    fights: [
      { boss: 'Aegis', damage: 1000, formation: team(['A', 'B', 'C']) },
      { boss: 'Basilisk', damage: 900, formation: team(['D', 'E', 'F'], 'Frostbite') },
    ],
  });
const setup = () => send('PUT', '/api/titan-reaver/setup', { bosses: ['Aegis', null, null, null, null, null] });
const setupBosses = async () => (await json(send('GET', '/api/titan-reaver/setup'))).bosses.filter(Boolean).length as number;

describe('the current Season Phase', () => {
  it('starts at 1, on the Seasons and on the Stages grid', async () => {
    expect(await phaseNow()).toBe(1);
    expect(await gridPhase()).toBe(1);
  });

  it('is raised by a cleared stage of any kind, by the Phase Stages show it under, and never lowered', async () => {
    await clear({ season: 8, phase: 0, kind: 'Normal', number: 5 });
    expect(await phaseNow()).toBe(1);
    await clear({ season: 8, phase: 0, kind: 'Normal', number: 301 });
    expect(await phaseNow()).toBe(2);
    await clear({ season: 8, phase: 0, kind: 'Phantisomal', number: 10 });
    expect(await phaseNow()).toBe(2);
    await clear({ season: 8, phase: 3, kind: 'Apex Normal', number: 1 });
    expect(await phaseNow()).toBe(3);
    expect(await gridPhase()).toBe(3);
    await clear({ season: 8, phase: 0, kind: 'Normal', number: 1 });
    expect(await phaseNow()).toBe(3);
  });

  it('is raised by a stage attempt edited onto a later stage', async () => {
    const saved = await json(await clear({ season: 8, phase: 0, kind: 'Normal', number: 5 }));
    const later = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 650, mapName: 'Open' }));
    await send('PUT', `/api/attempts/${saved.id}`, { stageId: later.id, formation: team(['A']) });
    expect(await phaseNow()).toBe(3);
  });

  it('ignores a stage of another Season', async () => {
    await clear({ season: 7, phase: 0, kind: 'Normal', number: 650 });
    expect(await phaseNow()).toBe(1);
  });

  it('is raised by a Titan Reaver Battle of the current Season, never lowered by one', async () => {
    expect((await titanBattle(2)).status).toBe(201);
    expect(await phaseNow()).toBe(2);
    await titanBattle(1);
    expect(await phaseNow()).toBe(2);
  });

  it('is set by hand, lowering included, and a change empties the Titan Reaver setup', async () => {
    await setup();
    expect((await send('PUT', '/api/seasons/current/phase', { phase: 2 })).status).toBe(200);
    expect(await phaseNow()).toBe(2);
    expect(await setupBosses()).toBe(0);
    await setup();
    await send('PUT', '/api/seasons/current/phase', { phase: 2 });
    expect(await setupBosses()).toBe(1); // the same Phase changes nothing
    await send('PUT', '/api/seasons/current/phase', { phase: 1 });
    expect(await phaseNow()).toBe(1);
    expect(await setupBosses()).toBe(0);
  });

  it('refuses a Season Phase that is not 1, 2 or 3', async () => {
    for (const phase of [0, 4, 1.5, 'x', null]) expect((await send('PUT', '/api/seasons/current/phase', { phase })).status).toBe(400);
    expect(await phaseNow()).toBe(1);
  });

  it('empties the Titan Reaver setup when a record advances it, and keeps it when a record does not', async () => {
    await setup();
    await clear({ season: 8, phase: 0, kind: 'Normal', number: 5 });
    expect(await setupBosses()).toBe(1);
    await clear({ season: 8, phase: 0, kind: 'Normal', number: 301 });
    expect(await setupBosses()).toBe(0);
  });

  it('empties the Titan Reaver setup when another Season becomes the current one, and each Season keeps its own Phase', async () => {
    await send('PUT', '/api/seasons/current/phase', { phase: 3 });
    await setup();
    await send('PUT', '/api/seasons/current', { number: 8 });
    expect(await setupBosses()).toBe(1); // the same Season
    await send('POST', '/api/seasons', { number: 9 });
    await send('PUT', '/api/seasons/current', { number: 9 });
    expect(await setupBosses()).toBe(0);
    expect(await phaseNow()).toBe(1);
    await send('PUT', '/api/seasons/current', { number: 8 });
    expect(await phaseNow()).toBe(3);
  });
});

describe('the Season Phase and the stages and Seasons that already exist', () => {
  it('is raised when changing the kind of a cleared stage moves it to a later Phase', async () => {
    await clear({ season: 8, phase: 0, kind: 'Phantisomal', number: 400 });
    expect(await phaseNow()).toBe(1);
    const changed = await send('POST', '/api/stages/change-kind', { season: 8, kind: 'Phantisomal', newKind: 'Normal', from: 400, to: 400 });
    expect(changed.status).toBe(200);
    expect(await phaseNow()).toBe(2); // Normal 400 is in the second block of 300
  });

  it('starts a Season that stages already name on the Phase of those stages when it is made current', async () => {
    await clear({ season: 9, phase: 3, kind: 'Apex Normal', number: 1 });
    await clear({ season: 10, phase: 0, kind: 'Normal', number: 301 });
    expect(await phaseNow()).toBe(1); // neither is the current Season
    await send('PUT', '/api/seasons/current', { number: 9 });
    expect(await phaseNow()).toBe(3);
    await send('PUT', '/api/seasons/current', { number: 10 });
    expect(await phaseNow()).toBe(2);
  });
});

describe('migration 35: the Season Phase of existing Seasons', () => {
  it('starts each Season on the highest Phase of its cleared stages and Titan Reaver Battles, and on 1 with none', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'afk-phase-')), 'afk.db');
    const old = openDb(path);
    old.prepare(MAP).run(JSON.stringify(cells));
    old.prepare('INSERT INTO hero (name) VALUES (?)').run('A');
    old.prepare('INSERT INTO season (number) VALUES (7)').run();
    old.prepare('INSERT INTO season (number) VALUES (6)').run();
    const cleared = (season: number, phase: number, kind: string, number: number) => {
      const stage = Number(old.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (?, ?, ?, ?, 'Open')").run(season, phase, kind, number).lastInsertRowid);
      const attempt = Number(old.prepare("INSERT INTO attempt (mode, outcome, season) VALUES ('Stage', 'Win', ?)").run(season).lastInsertRowid);
      old.prepare('INSERT INTO stage_attempt (attempt_id, stage_id) VALUES (?, ?)').run(attempt, stage);
    };
    old.prepare('INSERT INTO season (number) VALUES (5)').run();
    old.prepare("INSERT INTO titan_reaver_battle (season, season_phase, titan_phase, level) VALUES (5, 3, 'Charge', 500)").run();
    cleared(8, 0, 'Normal', 301);
    cleared(7, 0, 'Phantisomal', 1300);
    old.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (6, 3, 'Apex Normal', 1, 'Open')").run(); // no attempt: not cleared
    old.exec('ALTER TABLE hero DROP COLUMN hand_made; ALTER TABLE boss DROP COLUMN hand_made; ALTER TABLE season DROP COLUMN phase');
    old.pragma('user_version = 34');
    old.close();
    const reopened = openDb(path);
    expect(reopened.prepare('SELECT number, phase FROM season ORDER BY number').all()).toEqual([
      { number: 5, phase: 3 }, // a Titan Reaver Battle counts too
      { number: 6, phase: 1 },
      { number: 7, phase: 3 },
      { number: 8, phase: 2 },
    ]);
  });
});
