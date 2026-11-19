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
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  db.prepare("INSERT INTO rank (name, position) VALUES ('Mythic+', 0)").run();
  db.prepare('INSERT INTO equipment_level (level) VALUES (10)').run();
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B', 'C']) db.prepare("INSERT INTO roster (hero_name, rank, equipment_level) VALUES (?, 'Mythic+', 10)").run(name);
  db.prepare("INSERT INTO enemy (name, category) VALUES ('Grunt', 'Common')").run();
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Season 8')").run();
  db.prepare("INSERT INTO phantimal (name) VALUES ('Gervan'), ('Aurelian')").run();
  db.prepare("INSERT INTO phantimal_season VALUES ('Gervan', 8), ('Aurelian', 7)").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

const createStage = (extra: object = {}) =>
  send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 100, mapName: 'Open', ...extra });
const formation = (extra: object = {}) => ({
  heroes: [{ tile: 38, hero: 'A' }, { tile: 39, hero: 'B' }],
  phantimal: null,
  assistHero: 'C',
  artifact: 'Bladestorm',
  
  ...extra,
});
const attempt = (stageId: number, extra: object = {}) =>
  send('POST', '/api/attempts', { stageId, formation: formation(), ...extra });

describe('stages', () => {
  it('creates a stage once and finds it again by identity', async () => {
    const first = await createStage();
    expect(first.status).toBe(201);
    const second = await createStage({ mapName: undefined });
    expect(second.status).toBe(200);
    expect((await json(second)).id).toBe((await json(await createStage())).id);
  });

  it('keeps Apex stages of different phases apart', async () => {
    const one = await json(createStage({ kind: 'Apex Normal', phase: 1, number: 30 }));
    const two = await json(createStage({ kind: 'Apex Normal', phase: 2, number: 30 }));
    expect(one.id).not.toBe(two.id);
  });

  it('keeps enemies and heroes with a count, the same one counted several times', async () => {
    const stage = await json(createStage());
    const enemies = [{ enemy: 'Grunt', count: 3 }, { hero: 'A', count: 2 }];
    const saved = await json(send('PUT', `/api/stages/${stage.id}`, { mapName: 'Open', enemies }));
    expect(saved.enemies).toEqual([
      { enemy: 'Grunt', hero: null, count: 3 },
      { enemy: null, hero: 'A', count: 2 },
    ]);
    for (const bad of [{ enemy: 'Grunt', hero: 'A', count: 1 }, { count: 1 }, { hero: 'Nobody', count: 1 }, { enemy: 'Nobody', count: 1 }, { enemy: 'Grunt' }, { enemy: 'Grunt', count: 0 }]) {
      expect((await send('PUT', `/api/stages/${stage.id}`, { mapName: 'Open', enemies: [bad] })).status).toBe(400);
    }
  });

  it('rejects invalid identities and unknown maps', async () => {
    expect((await createStage({ kind: 'Apex Normal', phase: 0 })).status).toBe(400);
    expect((await createStage({ number: 2701 })).status).toBe(400);
    expect((await createStage({ number: 7, mapName: 'Nope' })).status).toBe(400);
    expect((await createStage({ number: 8, mapName: undefined })).status).toBe(400);
  });

  it('replaces the Stage Enemies on each save and keeps them when a save is refused', async () => {
    const stage = await json(createStage());
    await send('PUT', `/api/stages/${stage.id}`, { mapName: 'Open', enemies: [{ enemy: 'Grunt', count: 2 }] });
    expect((await send('PUT', `/api/stages/${stage.id}`, { mapName: 'Open', enemies: [{ enemy: 'Ghost', count: 1 }] })).status).toBe(400);
    expect((await json(send('GET', `/api/stages/${stage.id}`))).enemies).toEqual([{ enemy: 'Grunt', hero: null, count: 2 }]);
    await send('PUT', `/api/stages/${stage.id}`, { mapName: 'Open', enemies: [] });
    expect((await json(send('GET', `/api/stages/${stage.id}`))).enemies).toEqual([]);
  });

  it('refuses to change the map once the stage has attempts', async () => {
    const stage = await json(createStage());
    await attempt(stage.id);
    db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Other', '[]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
    expect((await send('PUT', `/api/stages/${stage.id}`, { mapName: 'Other', enemies: [] })).status).toBe(409);
  });
});

describe('attempts', () => {
  it('records an attempt with no hero state, whatever the roster holds (ADR 0041)', async () => {
    const stage = await json(createStage());
    const created = await json(attempt(stage.id, { note: ' first try ' }));
    expect(created).toMatchObject({
      note: 'first try',
      buffLevel: null,
      formation: {
        artifact: 'Bladestorm',
        heroes: [
          { tile: 38, name: 'A', rank: null, equipmentLevel: null },
          { tile: 39, name: 'B', rank: null, equipmentLevel: null },
        ],
        assist: { name: 'C', rank: null, equipmentLevel: null },
      },
    });
    expect(db.prepare("SELECT count(*) FROM formation_hero WHERE rank IS NOT NULL OR equipment_level IS NOT NULL").pluck().get()).toBe(0);
  });

  it('rejects the rank or equipment of a hero, or of the assist hero', async () => {
    const stage = await json(createStage());
    const heroes = (extra: object) => [{ tile: 38, hero: 'A', ...extra }];
    for (const bad of [
      formation({ heroes: heroes({ rank: 'Mythic+' }) }),
      formation({ heroes: heroes({ equipmentLevel: 10 }) }),
      formation({ heroes: heroes({ rank: null }) }),
      formation({ assistRank: 'Mythic+' }),
      formation({ assistEquipmentLevel: 10 }),
    ]) {
      const response = await attempt(stage.id, { formation: bad });
      expect(response.status).toBe(400);
      expect((await json(response)).error).toBe('A stage record does not keep the rank or equipment of a hero');
    }
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(0);
  });

  it('stores a buff level for Apex stages (default 0) and none for other kinds', async () => {
    const apex = await json(createStage({ kind: 'Apex Normal', phase: 1, number: 5 }));
    expect((await json(attempt(apex.id))).buffLevel).toBe(0);
    expect((await json(attempt(apex.id, { buffLevel: 12 }))).buffLevel).toBe(12);
    expect((await attempt(apex.id, { buffLevel: -1 })).status).toBe(400);
    const normal = await json(createStage({ number: 6 }));
    expect((await json(attempt(normal.id, { buffLevel: 9 }))).buffLevel).toBeNull();
  });

  it('allows a phantimal only on Phantisomal kinds, from that season', async () => {
    const withGervan = formation({ phantimal: { tile: 40, name: 'Gervan' } });
    const normal = await json(createStage());
    expect((await attempt(normal.id, { formation: withGervan })).status).toBe(400);

    const phanti = await json(createStage({ kind: 'Phantisomal', number: 3 }));
    const created = await json(attempt(phanti.id, { formation: withGervan }));
    expect(created.formation.phantimal).toEqual({ name: 'Gervan', tile: 40 });
    const wrongSeason = formation({ phantimal: { tile: 40, name: 'Aurelian' } });
    expect((await attempt(phanti.id, { formation: wrongSeason })).status).toBe(400);
  });

  it('accepts any known hero, not only the roster, and rejects an unknown hero, an outcome and unknown stages', async () => {
    const stage = await json(createStage());
    expect((await attempt(stage.id, { formation: formation({ heroes: [{ tile: 38, hero: 'D' }] }) })).status).toBe(201); // D is not on the roster
    expect((await attempt(stage.id, { formation: formation({ heroes: [{ tile: 38, hero: 'Nobody' }] }) })).status).toBe(400);
    expect((await attempt(stage.id, { outcome: 'Loss' })).status).toBe(400);
    expect((await attempt(stage.id, { outcome: 'Win' })).status).toBe(400);
    expect((await attempt(9999)).status).toBe(404);
  });

  it('filters, lists newest first, and deletes with the formation', async () => {
    const stage = await json(createStage());
    await attempt(stage.id, { note: 'first' });
    await attempt(stage.id, { note: 'second' });
    const all = await json(send('GET', '/api/attempts'));
    expect(all.map((a: any) => a.note)).toEqual(['second', 'first']);
    expect(all[0]).not.toHaveProperty('outcome');
    expect(db.prepare("SELECT DISTINCT outcome FROM attempt").pluck().all()).toEqual(['Win']);
    expect(await json(send('GET', '/api/attempts?kind=Phantisomal'))).toHaveLength(0);

    expect((await send('DELETE', `/api/attempts/${all[0].id}`)).status).toBe(204);
    expect(await json(send('GET', '/api/attempts'))).toHaveLength(1);
    expect(db.prepare('SELECT count(*) FROM formation').pluck().get()).toBe(1);
    expect(db.prepare('SELECT count(*) FROM formation_hero').pluck().get()).toBe(2);
  });

  it('serves the artifact and enemy lists', async () => {
    expect(await json(send('GET', '/api/artifacts'))).toEqual([{ name: 'Bladestorm', group: 'Season 8', source: 'import', uses: 0 }]);
    expect((await json(send('GET', '/api/enemies')))[0]).toMatchObject({ name: 'Grunt', category: 'Common', uses: 0 });
  });

  it('counts on how many stages each enemy stands', async () => {
    for (const number of [100, 101]) {
      const stage = await json(createStage({ number }));
      await send('PUT', `/api/stages/${stage.id}`, { mapName: 'Open', enemies: [{ enemy: 'Grunt', count: 1 }] });
    }
    expect((await json(send('GET', '/api/enemies')))[0]).toMatchObject({ name: 'Grunt', uses: 2 });
  });
});

describe('a range of stages cleared by one formation', () => {
  const range = (extra: object = {}) =>
    send('POST', '/api/attempts/range', { season: 8, phase: 0, kind: 'Normal', from: 100, to: 103, mapName: 'Open', formation: formation(), ...extra });

  it('saves one clear per stage, with the same formation, creating the stages it lacks', async () => {
    await createStage({ number: 101 });
    const res = await range();
    expect(res.status).toBe(201);
    const { attempts } = await res.json();
    expect(attempts.map((a: any) => a.stage.number)).toEqual([100, 101, 102, 103]);
    expect(db.prepare("SELECT DISTINCT outcome FROM attempt").pluck().all()).toEqual(['Win']);
    expect(attempts.every((a: any) => a.formation.heroes.map((h: any) => h.name).join() === 'A,B')).toBe(true);
    // the first stage is the record the formation was set on; each stage after it is a copy
    expect(attempts.map((a: any) => a.tags)).toEqual([[], ['AFK range'], ['AFK range'], ['AFK range']]);
    expect(db.prepare('SELECT count(*) FROM stage').pluck().get()).toBe(4); // 101 was found, not duplicated
  });

  it('keeps the other tags on every stage, and does not let the first stage carry AFK range', async () => {
    const { attempts } = await json(range({ tags: ['mine', 'afk  RANGE'] }));
    expect(attempts.map((a: any) => [...a.tags].sort())).toEqual([['mine'], ['AFK range', 'mine'], ['AFK range', 'mine'], ['AFK range', 'mine']]);
  });

  it('saves a range of one stage untagged', async () => {
    const { attempts } = await json(range({ from: 100, to: 100 }));
    expect(attempts.map((a: any) => a.tags)).toEqual([[]]);
  });

  it('refuses a range that says its last stage was lost', async () => {
    expect((await range({ lastLost: true })).status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(0);
  });

  it('keeps the buff level of an Apex range on every stage', async () => {
    const { attempts } = await json(range({ kind: 'Apex Normal', phase: 2, from: 30, to: 31, buffLevel: 4 }));
    expect(attempts.map((a: any) => [a.stage.phase, a.buffLevel])).toEqual([[2, 4], [2, 4]]);
  });

  it('refuses a bad range, and a stage the formation does not fit, and saves nothing', async () => {
    expect((await range({ from: 104, to: 100 })).status).toBe(400);
    expect((await range({ from: 1, to: 60 })).status).toBe(400); // too many stages
    expect((await range({ kind: 'Normal', phase: 2 })).status).toBe(400); // a Normal stage has no phase
    expect((await range({ mapName: 'Nowhere' })).status).toBe(400);
    const wide = await send('POST', '/api/maps', { name: 'Narrow', tags: ['Stage'], cells: Array.from({ length: TILE_COUNT }, (_, i) => (i === 38 ? TILE.PLAYER : TILE.OPEN)) });
    expect(wide.status).toBeLessThan(300);
    const stage = await json(createStage({ number: 102, mapName: 'Narrow' })); // stage 102 has a map where tile 39 is not a player tile
    expect(stage.mapName).toBe('Narrow');
    const res = await range();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Stage 102:/);
    expect(db.prepare('SELECT count(*) FROM stage_attempt').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM stage').pluck().get()).toBe(1); // 100 and 101 created inside the failed range are gone
  });

  it('names the Formation ID on every stage, once in the library', async () => {
    const { attempts } = await json(range({ formation: { ...formation(), formationId: 'a1b2c3d4' } }));
    expect(attempts.map((a: any) => a.formation.formationId)).toEqual(Array(4).fill('A1B2C3D4'));
    expect(db.prepare('SELECT count(*) FROM formation_id').pluck().get()).toBe(1);
  });
});

describe('changing the kind of recorded stages', () => {
  const range = (extra: object = {}) =>
    send('POST', '/api/attempts/range', { season: 8, phase: 0, kind: 'Normal', from: 100, to: 102, mapName: 'Open', formation: formation(), ...extra });
  const change = (extra: object = {}) =>
    send('POST', '/api/stages/change-kind', { season: 8, phase: 0, kind: 'Normal', newKind: 'Phantisomal', from: 100, to: 102, ...extra });

  it('turns a range of Normal stages into Phantisomal ones, attempts included', async () => {
    await range();
    const res = await change();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stages: 3, attempts: 3 });
    const kinds = (await json(send('GET', '/api/attempts'))).map((a: any) => a.stage.kind);
    expect(kinds).toEqual(['Phantisomal', 'Phantisomal', 'Phantisomal']);
    expect(db.prepare("SELECT count(*) FROM stage WHERE kind = 'Normal'").pluck().get()).toBe(0);
  });

  it('skips stages that do not exist and leaves other stages alone', async () => {
    await range({ from: 100, to: 101 });
    const res = await change({ from: 101, to: 105 });
    expect(await res.json()).toEqual({ stages: 1, attempts: 1 });
    const numbers = (await json(send('GET', '/api/attempts'))).map((a: any) => `${a.stage.kind} ${a.stage.number}`).sort();
    expect(numbers).toEqual(['Normal 100', 'Phantisomal 101']);
  });

  it('moves the attempts onto a stage of the right kind that already exists', async () => {
    await range({ from: 100, to: 100 });
    await createStage({ kind: 'Phantisomal', number: 100 });
    const res = await change({ from: 100, to: 100 });
    expect(await res.json()).toEqual({ stages: 1, attempts: 1 });
    expect(db.prepare('SELECT count(*) FROM stage').pluck().get()).toBe(1);
    expect((await json(send('GET', '/api/attempts')))[0].stage.kind).toBe('Phantisomal');
  });

  it('refuses a merge that would lose enemies, and changes nothing', async () => {
    await range({ from: 100, to: 101 });
    await createStage({ kind: 'Phantisomal', number: 101 });
    const old = await json(send('GET', '/api/stages?kind=Normal&number=101'));
    await send('PUT', `/api/stages/${old[0].id}`, { mapName: 'Open', enemies: [{ enemy: 'Grunt', count: 1 }] });
    const res = await change({ from: 100, to: 101 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/enemies/);
    expect((await json(send('GET', '/api/attempts'))).map((a: any) => a.stage.kind)).toEqual(['Normal', 'Normal']);
  });

  it('keeps a phantimal out of a kind that does not take it', async () => {
    await range({ from: 100, to: 100, kind: 'Phantisomal', formation: formation({ phantimal: { name: 'Gervan', tile: 40 } }) });
    const res = await change({ kind: 'Phantisomal', newKind: 'Normal', from: 100, to: 100 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/phantimal/);
  });

  it('only changes within a family, and to another kind', async () => {
    expect((await change({ newKind: 'Apex Normal', phase: 0 })).status).toBe(400);
    expect((await change({ newKind: 'Normal' })).status).toBe(400);
    expect((await change({ from: 5, to: 1 })).status).toBe(400);
  });
});

describe('the Stages grid', () => {
  it('lists each kind, phase and number once across seasons, cleared when the current season has an attempt', async () => {
    const [now, before, shell] = [
      await json(createStage({ number: 5 })),
      await json(createStage({ number: 5, season: 7 })), // the same box, an earlier season
      await json(createStage({ number: 6 })), // saved with no attempt: not a record
    ];
    const old = await json(createStage({ number: 7, season: 7 }));
    const apex = await json(createStage({ kind: 'Apex Normal', phase: 2, number: 5 }));
    for (const stage of [now, before, old]) await attempt(stage.id);
    await attempt(apex.id, { buffLevel: 3 });
    expect(shell.id).toBeGreaterThan(0);

    const { season, boxes } = await json(send('GET', '/api/stage-grid'));
    expect(season).toBe(8);
    expect(boxes).toEqual([
      { kind: 'Apex Normal', phase: 2, number: 5, state: 'cleared', newestSeason: 8 },
      { kind: 'Normal', phase: 0, number: 5, state: 'cleared', newestSeason: 8 },
      { kind: 'Normal', phase: 0, number: 7, state: 'older', newestSeason: 7 },
    ]);
  });

  it('reads the attempts of one box across seasons, newest first', async () => {
    const seven = await json(createStage({ number: 5, season: 7 }));
    const eight = await json(createStage({ number: 5 }));
    const other = await json(createStage({ number: 6 }));
    await attempt(seven.id, { note: 'old' });
    await attempt(eight.id, { note: 'new' });
    await attempt(other.id, { note: 'elsewhere' });
    const found = await json(send('GET', '/api/attempts?kind=Normal&number=5'));
    expect(found.map((a: any) => [a.note, a.stage.season])).toEqual([['new', 8], ['old', 7]]);
  });
});
