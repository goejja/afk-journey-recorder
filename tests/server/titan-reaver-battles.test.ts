import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  db.prepare("INSERT INTO boss (name) VALUES ('Aegis'), ('Basilisk'), ('Cerberus')").run();
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Season 8'), ('Frostbite', 'Season 8')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

const team = (names: string[], artifact: string | null = 'Bladestorm') => ({ heroes: names.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact });
const battle = (extra: object = {}) => ({
  seasonPhase: 2,
  titanPhase: 'Clash',
  level: 800,
  note: '',
  fights: [
    { boss: 'Aegis', damage: 1_200_000_000, formation: team(['A', 'B', 'C']) },
    { boss: 'Basilisk', damage: 800_000_000, formation: team(['D', 'E', 'F'], 'Frostbite') },
  ],
  ...extra,
});
const create = (extra: object = {}) => send('POST', '/api/titan-reaver/battles', battle(extra));

describe('saving a Titan Reaver Battle', () => {
  it('saves two fights as one record, with the total, the season it was played in and its heroes on their tiles', async () => {
    const response = await create({ note: ' second try ', tags: ['Test', 'test', 'Stun'] });
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved).toMatchObject({ season: 8, seasonPhase: 2, titanPhase: 'Clash', level: 800, note: 'second try', tags: ['Stun', 'Test'], total: 2_000_000_000, formationId: null });
    expect(saved.fights.map((f: any) => [f.position, f.boss, f.damage])).toEqual([[1, 'Aegis', 1_200_000_000], [2, 'Basilisk', 800_000_000]]);
    expect(saved.fights[0].formation.heroes).toEqual([
      { tile: 38, name: 'A', part: '', rank: null, equipmentLevel: null },
      { tile: 39, name: 'B', part: '', rank: null, equipmentLevel: null },
      { tile: 40, name: 'C', part: '', rank: null, equipmentLevel: null },
    ]);
    expect(saved.fights[1].formation.artifact).toBe('Frostbite');
  });

  it('reads it back by id and in the list, newest first, filtered by Season Phase, Titan Reaver Phase and tag', async () => {
    const first = await (await create({ tags: ['one'] })).json();
    const second = await (await create({ seasonPhase: 1, titanPhase: 'Charge', level: 600, tags: ['two'] })).json();
    expect(await json(send('GET', `/api/titan-reaver/battles/${first.id}`))).toMatchObject({ id: first.id, titanPhase: 'Clash' });
    expect((await json(send('GET', '/api/titan-reaver/battles'))).map((b: any) => b.id)).toEqual([second.id, first.id]);
    expect((await json(send('GET', '/api/titan-reaver/battles?seasonPhase=2'))).map((b: any) => b.id)).toEqual([first.id]);
    expect((await json(send('GET', '/api/titan-reaver/battles?titanPhase=Charge'))).map((b: any) => b.id)).toEqual([second.id]);
    expect((await json(send('GET', '/api/titan-reaver/battles?tag=two'))).map((b: any) => b.id)).toEqual([second.id]);
    expect((await send('GET', '/api/titan-reaver/battles/9999')).status).toBe(404);
  });

  it('filters the list by the Season it was played in', async () => {
    const old = await (await create()).json();
    db.prepare('UPDATE titan_reaver_battle SET season = 7 WHERE id = ?').run(old.id);
    const current = await (await create()).json();
    expect((await json(send('GET', '/api/titan-reaver/battles?season=8'))).map((b: any) => b.id)).toEqual([current.id]);
    expect((await json(send('GET', '/api/titan-reaver/battles?season=7'))).map((b: any) => b.id)).toEqual([old.id]);
    expect((await json(send('GET', '/api/titan-reaver/battles'))).map((b: any) => b.id)).toEqual([current.id, old.id]);
  });

  it('limits the level by the Season Phase: 600, 900 and 1200', async () => {
    expect((await create({ seasonPhase: 1, titanPhase: 'Charge', level: 600 })).status).toBe(201);
    expect((await create({ seasonPhase: 1, titanPhase: 'Charge', level: 601 })).status).toBe(400);
    expect((await create({ seasonPhase: 2, level: 900 })).status).toBe(201);
    expect((await create({ seasonPhase: 2, level: 901 })).status).toBe(400);
    expect((await create({ seasonPhase: 3, titanPhase: 'Conquer', level: 1200 })).status).toBe(201);
    expect((await create({ seasonPhase: 3, titanPhase: 'Conquer', level: 1201 })).status).toBe(400);
    expect((await create({ level: 0 })).status).toBe(400);
    expect((await create({ seasonPhase: 4 })).status).toBe(400);
    expect((await create({ titanPhase: 'Charging' })).status).toBe(400);
  });

  it('wants exactly two fights, against two different bosses, with a whole damage number', async () => {
    const one = battle().fights.slice(0, 1);
    expect((await create({ fights: one })).status).toBe(400);
    const same = battle().fights.map((f) => ({ ...f, boss: 'Aegis' }));
    expect(((await (await create({ fights: same })).json()) as any).error).toMatch(/two different bosses/);
    const half = battle().fights.map((f) => ({ ...f, damage: 1.5 }));
    expect((await create({ fights: half })).status).toBe(400);
    const negative = battle().fights.map((f) => ({ ...f, damage: -1 }));
    expect((await create({ fights: negative })).status).toBe(400);
    const nobody = battle().fights.map((f, i) => (i === 0 ? { ...f, boss: 'Nobody' } : f));
    expect((await create({ fights: nobody })).status).toBe(404);
  });

  it('refuses a hero or an Artifact used by both teams, an assist hero, and a hero outside the roster', async () => {
    const heroShared = battle().fights.map((f, i) => (i === 1 ? { ...f, formation: team(['C', 'E', 'F'], 'Frostbite') } : f));
    expect(((await (await create({ fights: heroShared })).json()) as any).error).toMatch(/C is in both fights/);
    const artifactShared = battle().fights.map((f, i) => (i === 1 ? { ...f, formation: team(['D', 'E', 'F'], 'Bladestorm') } : f));
    expect(((await (await create({ fights: artifactShared })).json()) as any).error).toMatch(/Bladestorm is in both fights.*Artifact/);
    const assist = battle().fights.map((f, i) => (i === 0 ? { ...f, formation: { ...team(['A', 'B', 'C']), assistHero: 'D' } } : f));
    expect(((await (await create({ fights: assist })).json()) as any).error).toMatch(/no assist hero/);
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Z');
    const stranger = battle().fights.map((f, i) => (i === 0 ? { ...f, formation: team(['A', 'B', 'Z']) } : f));
    expect((await create({ fights: stranger })).status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM titan_reaver_battle').pluck().get()).toBe(0);
  });

  it('says so when the Open map is missing', async () => {
    db.prepare("DELETE FROM map WHERE name = 'Open'").run();
    expect(((await (await create()).json()) as any).error).toMatch(/Open map is missing/);
  });
});

describe('editing and deleting a Titan Reaver Battle', () => {
  it('replaces both fights and the tags, keeps the season it was played in, and re-checks the level when the Season Phase changes', async () => {
    const saved = await (await create({ tags: ['old'] })).json();
    db.prepare('INSERT INTO season (number, is_current) VALUES (9, 0)').run();
    db.prepare('UPDATE season SET is_current = 0 WHERE is_current = 1').run();
    db.prepare('UPDATE season SET is_current = 1 WHERE number = 9').run();
    const fights = battle().fights.map((f, i) => ({ ...f, damage: i === 0 ? 5 : 7 }));
    const edited = await json(send('PUT', `/api/titan-reaver/battles/${saved.id}`, battle({ tags: ['new'], note: 'edited', fights })));
    expect(edited).toMatchObject({ id: saved.id, season: 8, tags: ['new'], note: 'edited', total: 12 });
    expect((await send('PUT', `/api/titan-reaver/battles/${saved.id}`, battle({ seasonPhase: 1, level: 800 }))).status).toBe(400);
    expect((await send('PUT', '/api/titan-reaver/battles/9999', battle())).status).toBe(404);
    expect(db.prepare('SELECT count(*) FROM titan_reaver_hero WHERE battle_id = ?').pluck().get(saved.id)).toBe(6);
  });

  it('keeps a hero who has left the roster when the Battle is edited', async () => {
    const saved = await (await create()).json();
    db.prepare("DELETE FROM roster WHERE hero_name = 'A'").run();
    expect((await send('PUT', `/api/titan-reaver/battles/${saved.id}`, battle())).status).toBe(200);
  });

  it('deletes the whole Battle, both fights, their heroes and tags', async () => {
    const saved = await (await create({ tags: ['x'] })).json();
    expect((await send('DELETE', `/api/titan-reaver/battles/${saved.id}`)).status).toBe(204);
    expect((await send('DELETE', `/api/titan-reaver/battles/${saved.id}`)).status).toBe(404);
    for (const table of ['titan_reaver_battle', 'titan_reaver_fight', 'titan_reaver_hero', 'titan_reaver_tag']) expect(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
  });

  it('keeps a used boss from being deleted', async () => {
    await create();
    expect(() => db.prepare("DELETE FROM boss WHERE name = 'Aegis'").run()).toThrow();
  });
});

describe('what a Titan Reaver Battle shares with the rest of the app', () => {
  it('counts in the tags of Admin > Tags, renames and removes with them', async () => {
    await create({ tags: ['Stun'] });
    await send('POST', '/api/dream-hunt/attempts', { boss: 'Aegis', mapName: 'Open', outcome: 'Win', timeSeconds: 40, tags: ['Stun'], formation: team(['A', 'B', 'C']) });
    expect(await json(send('GET', '/api/tags'))).toEqual([{ tag: 'Stun', count: 2 }]);
    expect(await json(send('PUT', '/api/tags/Stun', { name: 'Freeze' }))).toEqual({ name: 'Freeze', records: 2 });
    expect((await json(send('GET', '/api/titan-reaver/battles')))[0].tags).toEqual(['Freeze']);
    expect(await json(send('DELETE', '/api/tags/Freeze'))).toEqual({ removed: 2 });
    expect((await json(send('GET', '/api/titan-reaver/battles')))[0].tags).toEqual([]);
  });

  it('keeps one Formation ID for both teams, counts it in the library, and forgets it when the code is deleted', async () => {
    const saved = await (await create({ formationId: 'ab12cd34' })).json();
    expect(saved.formationId).toBe('AB12CD34');
    const library = await json(send('GET', '/api/formation-ids'));
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ code: 'AB12CD34', records: 1, maps: ['Open'] });
    expect(library[0].deployment.teams).toHaveLength(2);
    expect((await create({ formationId: 'AB12CD34', fights: battle().fights.map((f, i) => (i === 0 ? { ...f, formation: team(['A', 'B', 'D']) } : f)) })).status).toBe(400);
    expect((await send('DELETE', '/api/formation-ids/AB12CD34')).status).toBeLessThan(300);
    expect((await json(send('GET', `/api/titan-reaver/battles/${saved.id}`))).formationId).toBeNull();
  });

  it('is not counted as an attempt: Statistics, the cleanup and the record lists never see it', async () => {
    await create();
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(0);
    expect(await json(send('GET', '/api/dream-hunt/attempts'))).toEqual([]);
  });
});
