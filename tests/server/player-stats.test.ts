import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { formationGroups, formationStats, playerIds, playerStats } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'H']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const team = (names: string[]) => ({ heroes: names.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null});
const fight = (mode: string, outcome: 'Win' | 'Loss', mine: string[], extra: Record<string, unknown>) =>
  send('POST', '/api/pvp/fights', { mode, mapName: 'Open', outcome, formation: team(mine), opponent: { heroes: [{ tile: 0, hero: 'H' }] }, ...extra });

describe('player statistics', () => {
  beforeEach(async () => {
    db.prepare("INSERT INTO profile (name, player_id) VALUES ('Luna', '222')").run();
    await fight('Arena', 'Win', ['A', 'B'], { playerIdA: '111', playerIdB: '222' });
    await fight('Supreme Arena', 'Loss', ['A'], { playerIdA: '111' });
    await fight('Arena', 'Win', ['A'], {}); // nobody is known behind either side
  });

  it('gives each Player the record of their own side, named by their Profile when one has the ID', async () => {
    const players = await json(send('GET', '/api/stats/players'));
    expect(players.map((p: any) => [p.playerId, p.name, p.games, p.wins, p.winRate, p.modes])).toEqual([
      ['111', null, 2, 1, 0.5, ['Arena', 'Supreme Arena']],
      ['222', 'Luna', 1, 0, 0, ['Arena']],
    ]);
  });

  it('lists the formations each Player fielded, most used first, ignoring positions', async () => {
    await fight('Arena', 'Loss', ['B', 'A'], { playerIdA: '111' });
    const [first, second] = await json(send('GET', '/api/stats/players'));
    expect(first.formations).toEqual([
      { heroes: ['A', 'B'], games: 2, wins: 1, winRate: 0.5 },
      { heroes: ['A'], games: 1, wins: 0, winRate: 0 },
    ]);
    expect(second.formations).toEqual([{ heroes: ['H'], games: 1, wins: 0, winRate: 0 }]);
  });

  it('filters by mode and by a minimum number of games', async () => {
    expect((await json(send('GET', '/api/stats/players?mode=Arena'))).map((p: any) => [p.playerId, p.games])).toEqual([['111', 1], ['222', 1]]);
    expect((await json(send('GET', '/api/stats/players?min=2'))).map((p: any) => p.playerId)).toEqual(['111']);
  });

  it('names a Player whose Profile was deleted by the bare ID', () => {
    db.prepare("DELETE FROM profile WHERE name = 'Luna'").run();
    expect(playerStats(db).find((p) => p.playerId === '222')).toMatchObject({ name: null });
  });
});

describe('filtering statistics by Player', () => {
  beforeEach(async () => {
    db.prepare("INSERT INTO profile (name, player_id) VALUES ('Luna', '222')").run();
    await fight('Arena', 'Win', ['A', 'B'], { playerIdA: '111', playerIdB: '222' });
    await fight('Supreme Arena', 'Loss', ['A'], { playerIdA: '111' });
  });

  const byHero = (rows: any[]) => Object.fromEntries(rows.map((h) => [h.hero, [h.games, h.wins]]));

  it('keeps only the sides of the chosen Players', async () => {
    expect(byHero(await json(send('GET', '/api/stats/heroes?player=111')))).toEqual({ A: [2, 1], B: [1, 1] });
    expect(byHero(await json(send('GET', '/api/stats/heroes?player=222')))).toEqual({ H: [1, 0] });
    expect(byHero(await json(send('GET', '/api/stats/heroes?player=111&player=222')))).toEqual({ A: [2, 1], B: [1, 1], H: [1, 0] });
  });

  it('works for groups, artifacts, maps, rules, rows and the distribution, and the pick rate counts the Player’s sides only', async () => {
    expect(await json(send('GET', '/api/stats/pairs?player=111'))).toEqual({ rows: [{ heroA: 'A', heroB: 'B', games: 1, wins: 1, winRate: 1 }], total: 1 });
    expect(await json(send('GET', '/api/stats/maps?player=222'))).toEqual([]); // Side B only: maps count Side A
    expect(await json(send('GET', '/api/stats/maps?player=111'))).toEqual([{ map: 'Open', games: 2, wins: 1, winRate: 0.5 }]);
    expect((await json(send('GET', '/api/stats/heroes/H/rows?player=111'))).length).toBe(0);
    expect((await json(send('GET', '/api/stats/heroes/H/distribution?player=222'))).players).toBe(1);
    const heroes = await json(send('GET', '/api/stats/heroes?player=111'));
    expect(Object.fromEntries(heroes.map((h: any) => [h.hero, h.pickRate]))).toEqual({ A: 1, B: 0.5 });
  });

  it('lists the Players with their names, to choose from', () => {
    expect(playerIds(db, ['Luna', '111', 'Nobody'])).toEqual(['222', '111', 'Nobody']); // a Profile name stands for its Player ID
  });
});

describe('formation statistics', () => {
  beforeEach(async () => {
    await fight('Arena', 'Win', ['A', 'B'], { playerIdA: '111' });
    await fight('Arena', 'Loss', ['B', 'A'], { playerIdA: '222' });
    await fight('Supreme Arena', 'Win', ['A'], { playerIdA: '111' });
  });

  it('counts a formation as its set of heroes over both sides, whatever the positions', async () => {
    const rows = formationStats(db, {}) as any[];
    expect(rows.map((r: any) => [r.heroes, r.games, r.wins])).toEqual([
      [['H'], 3, 1],
      [['A', 'B'], 2, 1],
      [['A'], 1, 1],
    ]);
  });

  it('keeps only one Player\'s sides with the player filter, and applies a minimum', async () => {
    expect((formationStats(db, { player: ['111'] }) as any[]).map((r: any) => [r.heroes, r.games])).toEqual([[['A'], 1], [['A', 'B'], 1]]);
    expect((formationStats(db, { minGames: 2 }) as any[]).length).toBe(2);
  });
});

describe('formation groups', () => {
  beforeEach(async () => {
    for (const name of ['C', 'D', 'E', 'F']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
    await fight('Arena', 'Win', ['A', 'B', 'C', 'D'], { playerIdA: '111' });
    await fight('Arena', 'Win', ['D', 'C', 'B', 'A'], { playerIdA: '111' });
    await fight('Arena', 'Loss', ['A', 'B', 'C', 'E'], { playerIdA: '111' });
    await fight('Arena', 'Win', ['A', 'B', 'E', 'F'], { playerIdA: '222' });
  });

  it('groups formations that differ by one hero into a core with variants, and leaves others apart', async () => {
    const groups = formationGroups(db, { player: ['111'] }) as any[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ games: 3, wins: 2 });
    expect(groups[0].core.map((c: any) => c.hero)).toEqual(['A', 'B', 'C']);
    expect(groups[0].flex).toEqual([{ hero: 'D', share: 0.667 }, { hero: 'E', share: 0.333 }]);
    expect(groups[0].variants.map((v: any) => [v.flex, v.games, v.wins])).toEqual([
      [['D'], 2, 2],
      [['E'], 1, 0],
    ]);
  });

  it('keeps a formation two heroes away as its own group, and applies a minimum to the group', async () => {
    const groups = formationGroups(db, {}) as any[];
    expect(groups.map((g: any) => [g.core.map((c: any) => c.hero), g.games])).toEqual([[['A', 'B', 'C'], 3], [['H'], 4], [['A', 'B', 'E', 'F'], 1]].sort((a: any, b: any) => b[1] - a[1]));
    expect((formationGroups(db, { minGames: 3 }) as any[]).length).toBe(2);
  });
});

describe('leaving out the default profile', () => {
  beforeEach(async () => {
    db.prepare('UPDATE profile SET player_id = ? WHERE is_default = 1').run('111');
    await fight('Arena', 'Win', ['A', 'B'], { playerIdA: '111', playerIdB: '222' });
    await fight('Arena', 'Loss', ['A'], { playerIdA: '111', playerIdB: '222' });
  });

  it('drops the sides of the default profile\'s Player ID from every statistic', async () => {
    expect((await json(send('GET', '/api/stats/players?excludeDefault=true'))).map((p: any) => p.playerId)).toEqual(['222']);
    expect((await json(send('GET', '/api/stats/heroes?excludeDefault=true'))).map((h: any) => [h.hero, h.games])).toEqual([['H', 2]]);
    expect((formationStats(db, { excludeDefault: true }) as any[]).map((f: any) => f.heroes)).toEqual([['H']]);
    expect((await json(send('GET', '/api/stats/players'))).map((p: any) => p.playerId)).toEqual(['111', '222']);
  });
});
