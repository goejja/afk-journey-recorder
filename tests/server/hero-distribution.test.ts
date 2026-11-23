import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { heroDistribution } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'X']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  db.prepare("INSERT OR IGNORE INTO rank (name, position) VALUES ('Rare', 0), ('Mythic+', 1), ('Supreme', 2)").run();
  for (const level of [0, 5, 10]) db.prepare('INSERT OR IGNORE INTO equipment_level (level) VALUES (?)').run(level);
  db.prepare("INSERT OR REPLACE INTO rank_equipment_cap (rank, min_level, max_level) VALUES ('Mythic+', NULL, 10), ('Supreme', NULL, 15)").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
/** One fight with hero A on Side A (in the state given) and hero X on Side B. */
const fight = (extra: Record<string, unknown>, a: { rank?: string; equipmentLevel?: number } = {}, x: { rank?: string; equipmentLevel?: number } = {}, mode = 'Arena') =>
  send('POST', '/api/pvp/fights', {
    mode, mapName: 'Open', outcome: 'Win',
    formation: { heroes: [{ tile: 38, hero: 'A', ...a }], phantimal: null, assistHero: null, artifact: null},
    opponent: { heroes: [{ tile: 0, hero: 'X', ...x }] },
    ...extra,
  });
const dist = (hero: string, query = '') => json(send('GET', `/api/stats/heroes/${hero}/distribution${query}`));

describe('rank and equipment of a hero across Players', () => {
  beforeEach(async () => {
    await fight({ playerIdA: '111' }, { rank: 'Mythic+', equipmentLevel: 5 });
    await fight({ playerIdA: '111' }, { rank: 'Supreme', equipmentLevel: 10 }); // later: this one counts for 111
    await fight({ playerIdA: '222' }, { rank: 'Supreme', equipmentLevel: 10 }, {}, 'Supreme Arena');
    await fight({ playerIdA: '333' }, { rank: 'Mythic+', equipmentLevel: 5 });
    await fight({ playerIdA: '444' }); // no rank known
    await fight({ playerIdA: '555' }, { rank: 'Mythic+', equipmentLevel: 5 });
    await fight({ playerIdA: '555' }); // later, but without a rank: the earlier known one counts
    await fight({}, { rank: 'Rare' }); // nobody is known behind the side
  });

  it('counts each Player once, from their latest record that has a rank, highest rank first', async () => {
    expect(await dist('A')).toEqual({
      hero: 'A',
      players: 5,
      unknown: 1,
      cells: [
        { rank: 'Supreme', equipmentLevel: 10, players: 2 },
        { rank: 'Mythic+', equipmentLevel: 5, players: 2 },
      ],
    });
  });

  it('follows the mode filter', async () => {
    expect(await dist('A', '?mode=Arena')).toMatchObject({ players: 4, cells: [{ rank: 'Supreme', equipmentLevel: 10, players: 1 }, { rank: 'Mythic+', equipmentLevel: 5, players: 2 }] });
  });

  it('reads the hero on Side B too, and keeps a rank with no equipment as such', async () => {
    await fight({ playerIdB: '666' }, {}, { rank: 'Rare' });
    expect(await dist('X')).toEqual({ hero: 'X', players: 1, unknown: 0, cells: [{ rank: 'Rare', equipmentLevel: null, players: 1 }] });
  });

  it('says so for a hero no Player fielded', async () => {
    expect(await dist('Nobody')).toEqual({ hero: 'Nobody', players: 0, unknown: 0, cells: [] });
    expect(heroDistribution(db, 'Nobody').players).toBe(0);
  });
});

describe('searching the battles by Player', () => {
  it('matches part of a Player ID or of the name of the Profile that has it, on either side', async () => {
    db.prepare("INSERT INTO profile (name, player_id) VALUES ('Luna', '987654')").run();
    await fight({ playerIdA: '111' });
    await fight({ playerIdB: '987654' });
    await fight({});
    const ids = async (player: string) => (await json(send('GET', `/api/pvp/fights?player=${player}`))).length;
    expect(await ids('111')).toBe(1);
    expect(await ids('lun')).toBe(1); // the Profile's name, found through its Player ID
    expect(await ids('9876')).toBe(1);
    expect(await ids('nobody')).toBe(0);
    expect(await ids('')).toBe(3);
  });
});
