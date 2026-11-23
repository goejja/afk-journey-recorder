import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { normalizeTags } from '../../src/domain/tags.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\",\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'H']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  db.prepare("INSERT INTO boss (name) VALUES ('King Croaker')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const team = (names: string[]) => ({ heroes: names.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null});
const battle = (tags?: unknown) => ({ mode: 'Arena', mapName: 'Open', outcome: 'Win', formation: team(['A']), opponent: { heroes: [{ tile: 0, hero: 'H' }] }, tags });
const fight = (tags?: unknown) => ({ boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 60, formation: team(['A']), tags });

describe('normalizeTags', () => {
  it('trims, collapses spaces, and drops blanks and case-insensitive duplicates', () => {
    expect(normalizeTags(['  Luna ', 'luna', 'A:  Luna', ''])).toEqual({ tags: ['Luna', 'A: Luna'] });
    expect(normalizeTags(undefined)).toEqual({ tags: undefined });
    expect(normalizeTags('x')).toHaveProperty('error');
    expect(normalizeTags(['x'.repeat(41)])).toHaveProperty('error');
  });
});

describe('tags on records', () => {
  it('saves, filters and lists tags on Arena, Dream Hunt and Stage records', async () => {
    expect((await json(send('POST', '/api/pvp/fights', battle(['Luna', 'friend'])))).tags).toEqual(['friend', 'Luna']);
    await send('POST', '/api/pvp/fights', battle(['Other']));
    await send('POST', '/api/dream-hunt/attempts', fight(['mine']));
    const stage = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 1, mapName: 'Open' }));
    await send('POST', '/api/attempts', { stageId: stage.id, formation: team(['A']), tags: ['mine'] });

    expect(await json(send('GET', '/api/pvp/fights?tag=luna'))).toHaveLength(1);
    expect(await json(send('GET', '/api/dream-hunt/attempts?tag=mine'))).toHaveLength(1);
    expect(await json(send('GET', '/api/attempts?tag=mine'))).toHaveLength(1);
    expect(await json(send('GET', '/api/attempts?tag=nope'))).toHaveLength(0);
    expect(await json(send('GET', '/api/tags'))).toEqual([
      { tag: 'friend', count: 1 }, { tag: 'Luna', count: 1 }, { tag: 'mine', count: 2 }, { tag: 'Other', count: 1 },
    ]);
  });

  it('replaces tags on edit, keeps them when the edit sends none, and rejects bad tags', async () => {
    const created = await json(send('POST', '/api/pvp/fights', battle(['Luna'])));
    expect((await json(send('PUT', `/api/pvp/fights/${created.id}`, battle(['Kai'])))).tags).toEqual(['Kai']);
    expect((await json(send('PUT', `/api/pvp/fights/${created.id}`, battle(undefined)))).tags).toEqual(['Kai']);
    expect((await json(send('PUT', `/api/pvp/fights/${created.id}`, battle([])))).tags).toEqual([]);
    expect((await send('POST', '/api/pvp/fights', battle('Luna'))).status).toBe(400);
  });

  it('removes tags with their record and filters the Dream Hunt ranking', async () => {
    const mine = await json(send('POST', '/api/dream-hunt/attempts', fight(['mine'])));
    await send('POST', '/api/dream-hunt/attempts', fight(['friend']));
    const leaderboard = (query: string) => json(send('GET', `/api/dream-hunt/leaderboard?boss=King%20Croaker${query}`));
    expect((await leaderboard('')).attempts).toBe(2);
    expect((await leaderboard('&tag=mine')).attempts).toBe(1);
    await send('DELETE', `/api/attempts/${mine.id}`);
    expect(db.prepare("SELECT count(*) FROM attempt_tag WHERE tag = 'mine'").pluck().get()).toBe(0);
  });
});
