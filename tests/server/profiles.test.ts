import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { profiles, roster, scenario } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
let dir: string | undefined;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  for (const [rank, i] of [['Mythic', 1], ['Mythic+', 2]] as const) db.prepare('INSERT INTO rank (name, position) VALUES (?, ?)').run(rank, i);
  app = createApp(db);
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

describe('profile migration', () => {

  it('starts every new database with one default profile', () => {
    expect(profiles(db)).toEqual([{ name: 'Me', playerId: null, isDefault: true, heroes: 0 }]);
  });
});

describe('profiles API', () => {
  it('creates, renames and lists profiles, keeping names unique', async () => {
    const created = await send('POST', '/api/profiles', { name: ' Adri  Inothns ', playerId: ' 10000004 ' });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: 'Adri Inothns', playerId: '10000004', isDefault: false, heroCount: 0 });
    expect((await send('POST', '/api/profiles', { name: 'adri inothns' })).status).toBe(409); // ignoring case
    expect((await send('POST', '/api/profiles', { name: ' ' })).status).toBe(400);
    expect((await send('POST', '/api/profiles', { name: 'x'.repeat(41) })).status).toBe(400);
    const id = (await json(send('GET', '/api/profiles'))).find((p: any) => p.name === 'Adri Inothns').id;
    expect(await json(send('PUT', `/api/profiles/${id}`, { name: 'Friend' }))).toMatchObject({ name: 'Friend', playerId: '10000004' });
    expect((await send('PUT', `/api/profiles/${id}`, { name: 'Me' })).status).toBe(409);
    expect((await send('PUT', '/api/profiles/999', { name: 'Nobody' })).status).toBe(404);
    expect((await json(send('GET', '/api/profiles'))).map((p: any) => p.name)).toEqual(['Me', 'Friend']); // the default first
  });

  it('copies the heroes of another profile into a new one', async () => {
    await send('PUT', '/api/roster/A', { rank: 'Mythic+', equipmentLevel: null });
    const copy = await json(send('POST', '/api/profiles', { name: 'Twin', copyFrom: 'Me' }));
    expect(copy.heroCount).toBe(1);
    expect(await json(send('GET', `/api/heroes?profile=${copy.id}`))).toContainEqual(expect.objectContaining({ name: 'A', owned: true, rank: 'Mythic+' }));
    expect((await send('POST', '/api/profiles', { name: 'Ghost', copyFrom: 'Nobody' })).status).toBe(404);
  });

  it('keeps exactly one default, moves it on request, and refuses to delete it', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    expect((await send('DELETE', '/api/profiles/1')).status).toBe(409);
    const moved = await json(send('POST', `/api/profiles/${friend.id}/default`));
    expect(moved.map((p: any) => [p.name, p.isDefault])).toEqual([['Friend', true], ['Me', false]]);
    expect(db.prepare('SELECT count(*) FROM profile WHERE is_default = 1').pluck().get()).toBe(1);
    expect((await send('DELETE', '/api/profiles/1')).status).toBe(204); // no longer the default
    expect((await send('DELETE', `/api/profiles/${friend.id}`)).status).toBe(409);
  });

  it('merges a profile into another at the stronger state of each hero, moving its Player ID and default', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend', playerId: '777' }));
    await send('PUT', '/api/roster/A', { rank: 'Mythic', equipmentLevel: null }); // Me
    await send('PUT', '/api/roster/B', { rank: 'Mythic+', equipmentLevel: null });
    await send('PUT', `/api/roster/A?profile=${friend.id}`, { rank: 'Mythic+', equipmentLevel: null });
    await send('PUT', `/api/roster/B?profile=${friend.id}`, { rank: 'Mythic', equipmentLevel: null });
    await send('PUT', `/api/roster/C?profile=${friend.id}`, { rank: 'Mythic', equipmentLevel: null });
    expect((await send('POST', `/api/profiles/${friend.id}/merge`, { into: friend.id })).status).toBe(400);
    expect((await send('POST', `/api/profiles/${friend.id}/merge`, { into: 'Nobody' })).status).toBe(404);
    const merged = await json(send('POST', `/api/profiles/${friend.id}/merge`, { into: 'Me' }));
    expect(merged).toEqual([expect.objectContaining({ name: 'Me', playerId: '777', isDefault: true, heroCount: 3 })]);
    expect(db.prepare('SELECT hero_name, rank FROM roster WHERE profile_id = 1 ORDER BY hero_name').all()).toEqual([{ hero_name: 'A', rank: 'Mythic+' }, { hero_name: 'B', rank: 'Mythic+' }, { hero_name: 'C', rank: 'Mythic' }]);
    expect(db.prepare('SELECT count(*) FROM roster WHERE profile_id = ?').pluck().get(friend.id)).toBe(0);
  });

  it('moves the Round Deployments of the merged profile, the newer set of a Round both have winning whole', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    const tournament = Number(db.prepare('INSERT INTO tournament (season, number) VALUES (1, 1)').run().lastInsertRowid);
    const put = (profile: number, round: string, team: number, at: string) =>
      db.prepare('INSERT INTO round_deployment (tournament_id, round, profile_id, team, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(tournament, round, profile, team, JSON.stringify({ heroes: [] }), at);
    put(friend.id, 'Group stage', 1, '2026-01-01 10:00:00'); // only the merged profile has it: moves
    put(friend.id, 'Group stage', 2, '2026-01-01 10:00:00');
    put(1, 'Swiss stage', 1, '2026-01-01 10:00:00'); // both have it, the merged profile's is newer: its teams 1 and 2 replace the target's 1 and 3
    put(1, 'Swiss stage', 3, '2026-01-01 10:00:00');
    put(friend.id, 'Swiss stage', 1, '2026-02-01 10:00:00');
    put(friend.id, 'Swiss stage', 2, '2026-02-01 10:00:00');
    put(1, 'Top 48', 1, '2026-02-01 10:00:00'); // both have it, the target's is newer: kept as it is
    put(friend.id, 'Top 48', 2, '2026-01-01 10:00:00');
    put(1, 'Top 16', 1, '2026-01-01 10:00:00'); // the same time: the target's is kept
    put(friend.id, 'Top 16', 2, '2026-01-01 10:00:00');

    expect((await send('POST', `/api/profiles/${friend.id}/merge`, { into: 'Me' })).status).toBe(200);
    expect(db.prepare('SELECT round, team FROM round_deployment WHERE profile_id = 1 ORDER BY round, team').all()).toEqual([
      { round: 'Group stage', team: 1 },
      { round: 'Group stage', team: 2 },
      { round: 'Swiss stage', team: 1 },
      { round: 'Swiss stage', team: 2 },
      { round: 'Top 16', team: 1 },
      { round: 'Top 48', team: 1 },
    ]);
    expect(db.prepare('SELECT count(*) FROM round_deployment WHERE profile_id <> 1').pluck().get()).toBe(0);
  });

  it('gives the default to the profile merged into when the default is merged away', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    const merged = await json(send('POST', '/api/profiles/1/merge', { into: friend.id }));
    expect(merged.map((p: any) => [p.name, p.isDefault])).toEqual([['Friend', true]]);
  });

  it('keeps the records of a deleted profile and drops only its heroes', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    await send('PUT', `/api/roster/A?profile=${friend.id}`, { rank: 'Mythic+', equipmentLevel: null });
    expect(db.prepare('SELECT count(*) FROM roster WHERE profile_id = ?').pluck().get(friend.id)).toBe(1);
    expect((await send('DELETE', `/api/profiles/${friend.id}`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM roster WHERE profile_id = ?').pluck().get(friend.id)).toBe(0);
    expect((await send('DELETE', `/api/profiles/${friend.id}`)).status).toBe(404);
  });
});

describe('the player ID of a profile', () => {
  it('is optional, trimmed, and shown by the profile list and the query layer', async () => {
    const created = await json(send('POST', '/api/profiles', { name: 'Friend', playerId: '  12345678 ' }));
    expect(created.playerId).toBe('12345678');
    expect((await json(send('GET', '/api/profiles'))).map((p: any) => p.playerId)).toEqual([null, '12345678']);
    expect((profiles(db) as any[]).map((p) => p.playerId)).toEqual([null, '12345678']);
    const cleared = await json(send('PUT', `/api/profiles/${created.id}`, { playerId: '   ' }));
    expect(cleared.playerId).toBeNull();
  });

  it('is kept when only the name changes, and changed by the player ID alone', async () => {
    const created = await json(send('POST', '/api/profiles', { name: 'Friend', playerId: 'X1' }));
    expect((await json(send('PUT', `/api/profiles/${created.id}`, { name: 'Buddy' }))).playerId).toBe('X1');
    expect((await json(send('PUT', `/api/profiles/${created.id}`, { playerId: 'X2' }))).playerId).toBe('X2');
  });

  it('is unique among profiles, ignoring case, but a profile may keep its own', async () => {
    const first = await json(send('POST', '/api/profiles', { name: 'Friend', playerId: 'abc' }));
    expect((await send('POST', '/api/profiles', { name: 'Other', playerId: 'ABC' })).status).toBe(409);
    const other = await json(send('POST', '/api/profiles', { name: 'Other' }));
    expect((await send('PUT', `/api/profiles/${other.id}`, { playerId: 'Abc' })).status).toBe(409);
    expect((await send('PUT', `/api/profiles/${first.id}`, { playerId: 'ABC', name: 'Friend 2' })).status).toBe(200);
    expect((await send('POST', '/api/profiles', { name: 'Third' })).status).toBe(201); // several without one is fine
  });

  it('is refused when it is not text or too long, and is not copied with the heroes', async () => {
    expect((await send('POST', '/api/profiles', { name: 'Bad', playerId: ['1'] })).status).toBe(400);
    expect((await send('POST', '/api/profiles', { name: 'Bad', playerId: 'x'.repeat(41) })).status).toBe(400);
    const source = await json(send('POST', '/api/profiles', { name: 'Source', playerId: '77' }));
    const copy = await json(send('POST', '/api/profiles', { name: 'Copy', copyFrom: source.id }));
    expect(copy.playerId).toBeNull();
  });
});

describe('a roster per profile', () => {
  it('edits, lists and resets the roster of the profile asked for, the default otherwise', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    await send('PUT', '/api/roster/A', { rank: 'Mythic', equipmentLevel: null });
    await send('PUT', `/api/roster/A?profile=${friend.id}`, { rank: 'Mythic+', equipmentLevel: null });
    await send('PUT', `/api/roster/B?profile=Friend`, { rank: 'Mythic', equipmentLevel: null }); // by name
    const owned = async (query = '') => (await json(send('GET', `/api/heroes${query}`))).filter((h: any) => h.owned).map((h: any) => [h.name, h.rank]);
    expect(await owned()).toEqual([['A', 'Mythic']]);
    expect(await owned(`?profile=${friend.id}`)).toEqual([['A', 'Mythic+'], ['B', 'Mythic']]);
    expect((await send('GET', '/api/heroes?profile=Nobody')).status).toBe(404);
    expect((await send('PUT', '/api/roster/C?profile=Nobody', { rank: null })).status).toBe(404);
    await send('DELETE', '/api/roster/A?profile=Friend');
    expect(await owned(`?profile=${friend.id}`)).toEqual([['B', 'Mythic']]);
    await send('POST', `/api/roster/reset?profile=${friend.id}`);
    expect(await owned(`?profile=${friend.id}`)).toEqual([]);
    expect(await owned()).toEqual([['A', 'Mythic']]); // the other profile is untouched
  });

  it('has the Dream Hunt form check ownership against the default profile, and the Stage form take any hero', async () => {
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    await send('PUT', `/api/roster/B?profile=${friend.id}`, { rank: 'Mythic', equipmentLevel: null });
    await send('PUT', '/api/roster/A', { rank: 'Mythic', equipmentLevel: null });
    db.prepare("INSERT INTO boss (name, class) VALUES ('King Croaker', 'Mage')").run();
    const fight = (hero: string) => ({ boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 90, formation: { heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null } });
    expect((await send('POST', '/api/dream-hunt/attempts', fight('A'))).status).toBe(201);
    expect((await send('POST', '/api/dream-hunt/attempts', fight('B'))).status).toBe(400); // B is only in Friend's roster
    const stage = await json(send('POST', '/api/stages', { season: 8, kind: 'Normal', number: 1, mapName: 'Open' }));
    const record = (hero: string) => ({ stageId: stage.id, formation: { heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null } });
    expect((await send('POST', '/api/attempts', record('B'))).status).toBe(201); // a stage record keeps no hero state, so any hero will do
  });
});

describe('the Seen names of a profile', () => {
  it('remembers a spelling against a Profile and lists it', async () => {
    const created = await json(send('POST', '/api/profiles', { name: 'Traveler' }));
    const names = await json(send('POST', `/api/profiles/${created.id}/names`, { name: ' Мокка ' }));
    expect(names).toEqual(['Мокка']);
    expect((await json(send('GET', '/api/profiles'))).find((p: any) => p.id === created.id).seenNames).toEqual(['Мокка']);
  });

  it('refuses a spelling another Profile uses, as a name or as a Seen name', async () => {
    const traveler = await json(send('POST', '/api/profiles', { name: 'Traveler' }));
    const other = await json(send('POST', '/api/profiles', { name: 'Other' }));
    expect((await send('POST', `/api/profiles/${traveler.id}/names`, { name: 'Other' })).status).toBe(409);
    expect((await send('POST', `/api/profiles/${traveler.id}/names`, { name: 'Mokka' })).status).toBe(201);
    expect((await send('POST', `/api/profiles/${other.id}/names`, { name: 'Мокка' })).status).toBe(409);
    expect((await send('POST', '/api/profiles', { name: 'Мокка' })).status).toBe(409); // a profile cannot shadow a Seen name
  });

  it('goes with the profile when two are merged', async () => {
    const traveler = await json(send('POST', '/api/profiles', { name: 'Traveler' }));
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    await send('POST', `/api/profiles/${traveler.id}/names`, { name: 'Мокка' });
    const merged = await json(send('POST', `/api/profiles/${traveler.id}/merge`, { into: friend.id }));
    expect(merged.find((p: any) => p.id === friend.id)).toEqual(expect.objectContaining({ seenNames: expect.arrayContaining(['Мокка']) }));
    expect(db.prepare('SELECT profile_id AS profileId FROM profile_name').all()).toEqual([{ profileId: friend.id }, { profileId: friend.id }]);
  });

  it('is removed with its profile', async () => {
    const traveler = await json(send('POST', '/api/profiles', { name: 'Traveler' }));
    await send('POST', `/api/profiles/${traveler.id}/names`, { name: 'Мокка' });
    expect((await send('DELETE', `/api/profiles/${traveler.id}`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM profile_name').pluck().get()).toBe(0);
  });
});

describe('profiles in the query layer', () => {
  it('reads the default profile unless told another by name', async () => {
    await send('PUT', '/api/roster/A', { rank: 'Mythic', equipmentLevel: null });
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend', playerId: '222' }));
    await send('PUT', `/api/roster/B?profile=${friend.id}`, { rank: 'Mythic+', equipmentLevel: null });
    expect((roster(db) as any[]).map((r) => r.hero)).toEqual(['A']);
    expect((roster(db, 'Friend') as any[]).map((r) => r.hero)).toEqual(['B']);
    expect(() => roster(db, 'Nobody')).toThrow(/Unknown profile/);
    expect(profiles(db)).toEqual([
      { name: 'Me', playerId: null, isDefault: true, heroes: 1 },
      { name: 'Friend', playerId: '222', isDefault: false, heroes: 1 },
    ]);
  });

  it('offers a scenario the free heroes of the profile asked for', async () => {
    const created = { id: Number(db.prepare("INSERT INTO scenario (name, mode) VALUES ('S', 'Arena')").run().lastInsertRowid) };
    db.prepare("INSERT INTO scenario_slot (scenario_id, position, map_name) VALUES (?, 1, 'Open')").run(created.id);
    await send('PUT', '/api/roster/A', { rank: 'Mythic', equipmentLevel: null });
    const friend = await json(send('POST', '/api/profiles', { name: 'Friend' }));
    await send('PUT', `/api/roster/C?profile=${friend.id}`, { rank: 'Mythic', equipmentLevel: null });
    expect(scenario(db, created.id)!.freeRosterHeroes.map((h: any) => h.name)).toEqual(['A']);
    expect(scenario(db, created.id, 'Friend')!.freeRosterHeroes.map((h: any) => h.name)).toEqual(['C']);
  });
});
