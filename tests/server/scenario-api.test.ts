import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { saveEstimate } from '../../src/db/scenario-estimate.js';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { scenario, scenarios } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'X', 'Y', 'Z']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B', 'C']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  db.prepare("INSERT INTO boss_rule (name) VALUES ('Berserk')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const slot = (mine: string[], enemy: string[], extra: object = {}) => ({
  mapName: 'Duel',
  mine: mine.map((hero, i) => ({ tile: 38 + i, hero })),
  enemy: enemy.map((hero, i) => ({ tile: i, hero })),
  ...extra,
});
const scenarioBody = (slots: unknown[], extra: object = {}) => ({ name: 'Rival', mode: 'Supreme Arena', slots, ...extra });

describe('scenarios', () => {
  it('saves a scenario with pinned heroes and the enemy teams, and lists it', async () => {
    const created = await send('POST', '/api/scenarios', scenarioBody([slot(['A'], ['X', 'Y']), slot([], ['Z'])], { note: ' hard one ' }));
    expect(created.status).toBe(201);
    const saved = await created.json();
    expect(saved).toMatchObject({ name: 'Rival', mode: 'Supreme Arena', note: 'hard one', estimate: null });
    expect(saved.slots[0].mine.map((h: any) => h.name)).toEqual(['A']);
    expect(saved.slots[0].enemy.map((h: any) => h.name)).toEqual(['X', 'Y']);
    expect(saved.slots[1].mine).toEqual([]);
    expect(await json(send('GET', '/api/scenarios'))).toHaveLength(1);
  });

  it('refuses invalid scenarios', async () => {
    const post = (body: unknown) => send('POST', '/api/scenarios', body);
    expect((await post(scenarioBody([slot(['X'], ['Y'])]))).status).toBe(400); // X is not in the roster
    expect((await post(scenarioBody([slot(['A'], ['X']), slot(['A'], ['Y'])]))).status).toBe(400); // A on two teams
    expect((await post(scenarioBody([slot([], ['X']), slot([], ['X'])]))).status).toBe(400); // enemy X twice
    expect((await post(scenarioBody([slot([], ['X'], { mapName: 'Open' })]))).status).toBe(400); // not an Arena map
    expect((await post(scenarioBody([slot([], [])]))).status).toBe(400); // no enemy
    expect((await post(scenarioBody([slot([], ['X']), slot([], ['Y']), slot([], ['Z']), slot([], ['A'])]))).status).toBe(400); // too many teams
    expect((await post(scenarioBody([slot([], ['X'], { rule: 'Berserk' })], { mode: 'Arena' }))).status).toBe(400); // rule outside Supreme Arena
    expect((await post(scenarioBody([slot([], ['X'])], { name: ' ' }))).status).toBe(400);
  });

  it('edits a scenario in place and removes it with its heroes', async () => {
    const created = await json(send('POST', '/api/scenarios', scenarioBody([slot(['A'], ['X'])])));
    const edited = await json(send('PUT', `/api/scenarios/${created.id}`, scenarioBody([slot(['B'], ['Y', 'Z'])], { name: 'Renamed' })));
    expect(edited).toMatchObject({ id: created.id, name: 'Renamed' });
    expect(edited.slots[0].mine.map((h: any) => h.name)).toEqual(['B']);
    expect((await send('PUT', '/api/scenarios/999', scenarioBody([slot([], ['X'])]))).status).toBe(404);
    expect((await send('DELETE', `/api/scenarios/${created.id}`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM scenario_hero').pluck().get()).toBe(0);
  });

  it('lists the agent estimate saved on a scenario', async () => {
    const created = await json(send('POST', '/api/scenarios', scenarioBody([slot([], ['X'])])));
    expect(saveEstimate(db, created.id, ' Try A, B. 4 similar battles. ')).toBeNull();
    const [listed] = await json(send('GET', '/api/scenarios'));
    expect(listed.estimate).toBe('Try A, B. 4 similar battles.');
    expect(listed.estimateAt).toBeTruthy();
  });

  it('gives the agent pinned heroes with roster state, the enemy, and the roster heroes still free', async () => {
    db.prepare("UPDATE roster SET rank = NULL").run();
    const created = await json(send('POST', '/api/scenarios', scenarioBody([slot(['A'], ['X', 'Y']), slot(['B'], ['Z'])])));
    const read = scenario(db, created.id) as any;
    expect(read.slots[0].pinned.map((h: any) => h.name)).toEqual(['A']);
    expect(read.slots[0].enemy.map((h: any) => h.name)).toEqual(['X', 'Y']);
    expect(read.slots[0].playerTiles).toContain(38);
    expect(read.freeRosterHeroes.map((h: any) => h.name)).toEqual(['C']);
    expect(scenario(db, 999)).toBeNull();
    expect((scenarios(db) as any[])[0]).toMatchObject({ id: created.id, hasEstimate: 0 });
  });
});
