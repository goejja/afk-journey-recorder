import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
let tournament: number;
let profile: number;

beforeEach(() => {
  db = openDb(':memory:');
  for (const name of ['A', 'B', 'C']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Crown', 'Pre-Season')").run();
  db.prepare("INSERT INTO phantimal (name) VALUES ('Orson')").run();
  tournament = Number(db.prepare('INSERT INTO tournament (season, number) VALUES (8, 2)').run().lastInsertRowid);
  profile = Number(db.prepare("INSERT INTO profile (name, player_id) VALUES ('Dom', 'P1')").run().lastInsertRowid);
  app = createApp(db);
});

const url = (round = 'Group stage', extra = '') => `/api/tournaments/${tournament}/rounds/${encodeURIComponent(round)}/deployments${extra}`;
const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const hero = (name: string, tile: number) => ({ tile, hero: name, part: '', rank: 'Mythic', equipmentLevel: 10 });
const teams = (...made: unknown[]) => ({ teams: [...made, ...Array(5 - made.length).fill(null)] });

describe('Round Deployments', () => {
  it('saves the teams of a Profile for one Round and lists them back', async () => {
    const saved = await send('PUT', url('Group stage', `/${profile}`), teams({ heroes: [hero('A', 38)], phantimal: { name: 'Orson', tile: 39 }, artifact: 'Crown' }, { heroes: [hero('B', 40)], phantimal: null, artifact: null }));
    expect(saved.status).toBe(200);
    const listed = await json(send('GET', url()));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ profileId: profile, name: 'Dom', playerId: 'P1' });
    expect(listed[0].teams.map((t: any) => t && t.heroes.map((h: any) => h.hero))).toEqual([['A'], ['B'], null, null, null]);
    expect(await json(send('GET', url('Swiss stage')))).toEqual([]);
  });

  it('keeps a team whose tiles are not known yet', async () => {
    const open = { heroes: [{ ...hero('A', 0), tile: null }], phantimal: { name: 'Orson', tile: null }, artifact: 'Crown' };
    expect((await send('PUT', url('Group stage', `/${profile}`), teams(open))).status).toBe(200);
    const [only] = await json(send('GET', url()));
    expect(only.teams[0].heroes[0].tile).toBeNull();
    expect(only.teams[0].phantimal.tile).toBeNull();
  });

  it('replaces the earlier teams of the Profile and can remove them', async () => {
    await send('PUT', url('Group stage', `/${profile}`), teams({ heroes: [hero('A', 38)], phantimal: null, artifact: null }, { heroes: [hero('B', 40)], phantimal: null, artifact: null }));
    await send('PUT', url('Group stage', `/${profile}`), teams({ heroes: [hero('C', 38)], phantimal: null, artifact: null }));
    const [only] = await json(send('GET', url()));
    expect(only.teams.map((t: any) => t && t.heroes[0].hero)).toEqual(['C', null, null, null, null]);
    expect((await send('DELETE', url('Group stage', `/${profile}`))).status).toBe(204);
    expect(await json(send('GET', url()))).toEqual([]);
  });

  it('refuses a hero on two teams, unknown names, a wrong number of teams and malformed teams, saving nothing', async () => {
    const put = (body: unknown) => send('PUT', url('Group stage', `/${profile}`), body);
    expect((await json(put(teams({ heroes: [hero('A', 38)], phantimal: null, artifact: null }, { heroes: [hero('A', 40)], phantimal: null, artifact: null })))).error).toMatch(/A is on teams 1 and 2/);
    expect((await json(put(teams({ heroes: [hero('Nobody', 38)], phantimal: null, artifact: null })))).error).toMatch(/unknown hero Nobody/);
    expect((await json(put(teams({ heroes: [hero('A', 38)], phantimal: null, artifact: 'Lost' })))).error).toMatch(/unknown artifact/);
    expect((await put({ teams: [null] })).status).toBe(400);
    expect((await put(teams({ heroes: 'A' }))).status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM round_deployment').pluck().get()).toBe(0);
  });

  it('refuses an unknown Round, Tournament or Profile', async () => {
    expect((await send('GET', url('Top 4'))).status).toBe(400);
    expect((await send('GET', '/api/tournaments/999/rounds/Finals/deployments')).status).toBe(404);
    expect((await send('PUT', url('Finals', '/999'), teams())).status).toBe(404);
  });

  it('confirms several Profiles in one transaction, or none of them', async () => {
    const other = Number(db.prepare("INSERT INTO profile (name, player_id) VALUES ('Rover', 'P2')").run().lastInsertRowid);
    const entries = (a: unknown, b: unknown) => ({ entries: [{ profileId: profile, teams: a }, { profileId: other, teams: b }] });
    const list = (...made: unknown[]) => [...made, ...Array(5 - made.length).fill(null)];
    expect((await send('PUT', url(), entries(list({ heroes: [hero('A', 38)], phantimal: null, artifact: null }), list({ heroes: [hero('B', 40)], phantimal: null, artifact: null })))).status).toBe(200);
    const listed = await json(send('GET', url()));
    expect(listed.map((e: any) => [e.profileId, e.teams[0].heroes[0].hero])).toEqual(expect.arrayContaining([[profile, 'A'], [other, 'B']]));
    // the second Profile is refused, so the first is not written either
    const refused = entries(list({ heroes: [hero('C', 38)], phantimal: null, artifact: null }), list({ heroes: [hero('Nobody', 40)], phantimal: null, artifact: null }));
    expect((await send('PUT', url(), refused)).status).toBe(400);
    expect((await json(send('GET', url()))).find((e: any) => e.profileId === profile).teams[0].heroes[0].hero).toBe('A');
    // one Profile cannot be written twice in one request
    const twice = entries(list(), list());
    expect((await send('PUT', url(), { entries: [twice.entries[0], twice.entries[0]] })).status).toBe(400);
  });

  it('moves a Deployment to another Profile, replacing what that Profile had (a repair)', async () => {
    const other = Number(db.prepare("INSERT INTO profile (name) VALUES ('Rover')").run().lastInsertRowid);
    await send('PUT', url('Group stage', `/${profile}`), teams({ heroes: [hero('A', 38)], phantimal: null, artifact: null }));
    await send('PUT', url('Group stage', `/${other}`), teams({ heroes: [hero('C', 40)], phantimal: null, artifact: null }));
    const moved = await send('POST', url('Group stage', `/${profile}/move`), { to: other });
    expect(moved.status).toBe(200);
    expect((await json(moved)).teams[0].heroes[0].hero).toBe('A');
    const listed = await json(send('GET', url()));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ profileId: other, name: 'Rover' });
    expect((await send('POST', url('Group stage', `/${other}/move`), { to: other })).status).toBe(400);
    expect((await send('POST', url('Group stage', `/${other}/move`), { to: 999 })).status).toBe(404);
  });

  it('is removed with its Profile', () => {
    db.prepare("INSERT INTO round_deployment (tournament_id, round, profile_id, team, content) VALUES (?, 'Finals', ?, 1, '{}')").run(tournament, profile);
    db.prepare('DELETE FROM profile WHERE id = ?').run(profile);
    expect(db.prepare('SELECT count(*) FROM round_deployment').pluck().get()).toBe(0);
  });
});
