import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { dreamHuntBest, heroStats, pairReport, roster, runSelect, stageHistory, summary } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\",\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'X', 'Y', 'Z']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  for (const name of ['A', 'B', 'C']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  db.prepare("INSERT INTO boss (name) VALUES ('King Croaker')").run();
  app = createApp(db);
});

const post = (url: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const side = (names: string[]) => names.map((hero, i) => ({ tile: 38 + i, hero }));
const enemySide = (names: string[]) => ({ heroes: names.map((hero, i) => ({ tile: i, hero })) });
const battle = (a: string[], b: string[], outcome: 'Win' | 'Loss', extra: object = {}) =>
  post('/api/pvp/fights', {
    mode: 'Arena', mapName: 'Open', outcome, formation: { heroes: side(a), phantimal: null, assistHero: null, artifact: null}, opponent: enemySide(b), ...extra,
  });

describe('queries', () => {
  it('counts hero results from both sides of an Arena battle', async () => {
    await battle(['A', 'B'], ['X', 'Y'], 'Win'); // A and B won, X and Y lost
    await battle(['A', 'C'], ['X', 'Z'], 'Loss'); // A and C lost, X and Z won
    const stats = Object.fromEntries((heroStats(db) as any[]).map((r) => [r.hero, [r.games, r.wins]]));
    expect(stats).toMatchObject({ A: [2, 1], B: [1, 1], C: [1, 0], X: [2, 1], Y: [1, 0], Z: [1, 1] });
    expect((heroStats(db, { minGames: 2 }) as any[]).map((r) => r.hero).sort()).toEqual(['A', 'X']);
  });

  it('counts pairs fielded together on one side, never across sides', async () => {
    await battle(['A', 'B'], ['X', 'Y'], 'Win');
    const pairs = (pairReport(db).rows as any[]).map((r) => `${r.heroA}${r.heroB}:${r.wins}/${r.games}`).sort();
    expect(pairs).toEqual(['AB:1/1', 'XY:0/1']);
  });

  it('filters by the Arena mode and by tag', async () => {
    await battle(['A'], ['X'], 'Win', { mode: 'Supreme Arena', tags: ['Luna'] });
    await battle(['B'], ['Y'], 'Win');
    expect((heroStats(db, { mode: 'Supreme Arena' }) as any[]).map((r) => r.hero).sort()).toEqual(['A', 'X']);
    expect((heroStats(db, { tag: 'luna' }) as any[]).map((r) => r.hero).sort()).toEqual(['A', 'X']);
    expect((summary(db).records as any[]).map((r) => [r.mode, r.records])).toEqual([['Arena', 1], ['Supreme Arena', 1]]);
  });

  it('shows each side of a battle from its own point of view in v_side and v_side_hero', async () => {
    await battle(['A', 'B'], ['X'], 'Win', { tags: ['Luna'] });
    const sides = db.prepare('SELECT side, won, mode FROM v_side ORDER BY side').all();
    expect(sides).toEqual([{ side: 'A', won: 1, mode: 'Arena' }, { side: 'B', won: 0, mode: 'Arena' }]);
    const heroes = db.prepare('SELECT side, hero FROM v_side_hero ORDER BY side, hero').all();
    expect(heroes).toEqual([{ side: 'A', hero: 'A' }, { side: 'A', hero: 'B' }, { side: 'B', hero: 'X' }]);
  });

  it('shows a stage with its attempts, and ranks Dream Hunt compositions', async () => {
    const stage = await (await post('/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 5, mapName: 'Open' })).json();
    await post('/api/attempts', { stageId: stage.id, formation: { heroes: side(['A']), phantimal: null, assistHero: null, artifact: null} });
    const history = stageHistory(db, { season: 8, kind: 'Normal', number: 5 });
    expect(history.attempts).toHaveLength(1);
    expect((history.attempts[0] as any).heroes).toEqual([{ name: 'A' }]); // no rank or equipment: a stage record keeps none (ADR 0041)
    expect(stageHistory(db, { season: 8, kind: 'Normal', number: 6 }).stage).toBeNull();

    for (const timeSeconds of [60, 90]) {
      await post('/api/dream-hunt/attempts', { boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds, formation: { heroes: side(['A', 'B']), phantimal: null, assistHero: null, artifact: null} });
    }
    const best = dreamHuntBest(db, 'King Croaker');
    expect(best.compositions[0]).toMatchObject({ heroes: ['A', 'B'], attempts: 2, clears: 2, bestSeconds: 60, worstSeconds: 90, lowConfidence: true });
  });

  it('lists the roster and runs only a single SELECT', () => {
    expect((roster(db) as any[]).map((r) => r.hero)).toEqual(['A', 'B', 'C']);
    expect(runSelect(db, 'SELECT count(*) AS n FROM hero;')).toEqual([{ n: 6 }]);
    expect(() => runSelect(db, 'DELETE FROM hero')).toThrow(/single SELECT/);
    expect(() => runSelect(db, 'SELECT 1; DELETE FROM hero')).toThrow(/single SELECT/);
    expect(() => runSelect(db, 'WITH x AS (SELECT 1) DELETE FROM hero')).toThrow(/single SELECT/);
    expect(runSelect(db, "SELECT 'a;b' AS s")).toEqual([{ s: 'a;b' }]);
    expect(runSelect(db, 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000) SELECT i FROM n')).toHaveLength(500);
  });
});
