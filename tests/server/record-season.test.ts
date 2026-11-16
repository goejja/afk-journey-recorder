import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { migration as addSeason } from '../../src/db/migrations/020-attempt-season.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { heroStats, playerStats, stageStats } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\",\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'X']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  db.prepare("INSERT INTO boss (name, class) VALUES ('King Croaker', 'Mage')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const seasonOf = (attemptId: number) => db.prepare('SELECT season FROM attempt WHERE id = ?').pluck().get(attemptId) as number;
const makeCurrent = async (season: number) => {
  await send('POST', '/api/seasons', { number: season });
  await send('PUT', '/api/seasons/current', { number: season });
};

const team = (hero = 'A') => ({ heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null });
const fight = (hero = 'A', extra: object = {}) => ({ mapName: 'Open', outcome: 'Win', formation: team(hero), opponent: { heroes: [{ tile: 0, hero: 'X' }] }, ...extra });
const pvp = (extra: object = {}) => send('POST', '/api/pvp/battles', { mode: 'Arena', ...fight(), ...extra });
const group = (extra: object = {}, mode = 'Super League', hero = 'A') => send('POST', '/api/pvp/battle-groups', { mode, fights: [fight(hero)], ...extra });
const dream = () => send('POST', '/api/dream-hunt/attempts', { boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 90, formation: team() });
const stageAttempt = async () => {
  const stage = await json(send('POST', '/api/stages', { season: 7, phase: 0, kind: 'Normal', number: 100, mapName: 'Open' }));
  return json(send('POST', '/api/attempts', { stageId: stage.id, outcome: 'Win', formation: { ...team(), assistHero: 'B' } }));
};

describe('the season a record was played in (ADR 0038)', () => {
  it('is the current season for a Stage, a Dream Hunt and a PvP record, and a stage keeps its own season apart', async () => {
    await makeCurrent(9);
    const stage = await stageAttempt();
    expect(seasonOf(stage.id)).toBe(9);
    expect(stage).toMatchObject({ season: 9, stage: { season: 7 } });
    expect(seasonOf((await json(dream())).id)).toBe(9);
    const arena = await json(pvp());
    expect(arena.season).toBe(9);
    expect(seasonOf(arena.id)).toBe(9);
  });

  it('ignores a season in the body, and keeps it when the record is edited after the current season moved on', async () => {
    const saved = await json(pvp({ season: 3 }));
    expect(saved.season).toBe(8);
    await makeCurrent(9);
    const edited = await json(send('PUT', `/api/pvp/battles/${saved.id}`, fight('B', { mode: 'Arena' })));
    expect(edited.season).toBe(8);
  });

  it('is the Tournament\'s for a fight in a Battle of a Tournament, so a late import keeps its season', async () => {
    const tournament = (await json(send('POST', '/api/tournaments', { number: 1 })))[0];
    expect(tournament.season).toBe(8);
    await makeCurrent(9);
    const created = await json(group({ tournamentId: tournament.id, round: 'Swiss stage' }));
    expect(created.fights[0].season).toBe(8);
    const other = await json(group({}, 'Supreme Arena', 'B'));
    expect(other.fights[0].season).toBe(9);
  });

  it('is the season of the fights a Battle already has for a fight added to it later', async () => {
    const created = await json(send('POST', '/api/pvp/battle-groups', { mode: 'Supreme Arena', fights: [fight('A')] }));
    await makeCurrent(9);
    const edited = await json(send('PUT', `/api/pvp/battle-groups/${created.id}`, { fights: [fight('A'), fight('B')] }));
    expect(edited.fights.map((f: any) => f.season)).toEqual([8, 8]);
  });

  it('puts a new Tournament in the current season whatever the body says', async () => {
    await makeCurrent(9);
    const all = await json(send('POST', '/api/tournaments', { number: 1, season: 3 }));
    expect(all[0]).toMatchObject({ season: 9, number: 1 });
    expect((await send('POST', '/api/tournaments', { number: 1 })).status).toBe(409);
  });
});

describe('the migration that adds the season', () => {
  it('puts 8 on every record and the Tournament\'s season on the fights of its Battles', () => {
    db.exec('DROP INDEX attempt_season; ALTER TABLE attempt DROP COLUMN season');
    db.prepare('INSERT INTO tournament (id, season, number) VALUES (1, 7, 1)').run();
    db.prepare("INSERT INTO battle (id, mode, tournament_id, round) VALUES (1, 'Super League', 1, 'Swiss stage')").run();
    db.prepare("INSERT INTO attempt (id, mode, outcome, battle_id, battle_position) VALUES (1, 'Arena', 'Win', 1, 1)").run();
    db.prepare("INSERT INTO attempt (id, mode, outcome) VALUES (2, 'Dream Hunt', 'Win')").run();
    addSeason(db);
    expect(db.prepare('SELECT id, season FROM attempt ORDER BY id').all()).toEqual([{ id: 1, season: 7 }, { id: 2, season: 8 }]);
  });
});

describe('the played-in filter', () => {
  beforeEach(async () => {
    await pvp({ outcome: 'Win' });
    await makeCurrent(9);
    await pvp({ outcome: 'Loss', formation: team('B') });
    await stageAttempt();
  });

  it('keeps only the records of the seasons given, in every view of sides', () => {
    const heroes = (playedIn?: string[]) => (heroStats(db, { mode: 'Arena', playedIn }) as { hero: string; games: number }[]).filter((h) => h.hero !== 'X').map((h) => [h.hero, h.games]);
    expect(heroes()).toEqual(expect.arrayContaining([['A', 1], ['B', 1]]));
    expect(heroes(['8'])).toEqual([['A', 1]]);
    expect(heroes(['9'])).toEqual([['B', 1]]);
    expect(heroes(['8', '9'])).toHaveLength(2);
    expect(heroes(['7'])).toEqual([]);
  });

  it('keeps the stages played in a season apart from the stage\'s own season', () => {
    expect(stageStats(db, { playedIn: ['9'] })).toHaveLength(1);
    expect(stageStats(db, { playedIn: ['8'] })).toHaveLength(0);
    expect(stageStats(db, { season: 7, playedIn: ['9'] })).toHaveLength(1);
    expect(stageStats(db, { season: 9 })).toHaveLength(0); // no stage of season 9
  });

  it('applies to the Players view and through the API', async () => {
    db.prepare("INSERT INTO attempt_player (attempt_id, side, player_id) SELECT id, 'B', '10000001' FROM attempt WHERE mode = 'Arena'").run();
    expect(playerStats(db, { playedIn: ['8'] })[0]).toMatchObject({ games: 1 });
    expect(playerStats(db, { playedIn: ['7'] })).toEqual([]);
    expect((await json(send('GET', '/api/stats/heroes?mode=Arena&playedIn=9'))).map((h: any) => h.hero).sort()).toEqual(['B', 'X']);
  });
});
