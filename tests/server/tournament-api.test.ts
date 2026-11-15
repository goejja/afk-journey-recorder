import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'X']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const fight = (hero: string) => ({
  mapName: 'Open', outcome: 'Win',
  formation: { heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null },
  opponent: { heroes: [{ tile: 0, hero: 'X' }] },
});
const group = (extra: Record<string, unknown> = {}, mode = 'Super League', hero = 'A') => send('POST', '/api/pvp/battle-groups', { mode, fights: [fight(hero)], ...extra });
const makeTournament = async (season = 8, number = 2) => (await json(send('POST', '/api/tournaments', { season, number })))[0].id as number;

describe('Tournaments', () => {
  it('lists the latest first and refuses a repeated number in a Season', async () => {
    await makeTournament(8, 1);
    await makeTournament(8, 2);
    const listed = await json(send('GET', '/api/tournaments'));
    expect(listed.map((t: any) => [t.season, t.number])).toEqual([[8, 2], [8, 1]]);
    expect((await send('POST', '/api/tournaments', { season: 8, number: 2 })).status).toBe(409);
    expect((await send('POST', '/api/tournaments', { season: 8, number: 0 })).status).toBe(400);
    expect((await send('POST', '/api/tournaments', { season: 8, number: 3, startDate: 'soon' })).status).toBe(400);
  });

  it('lists the Rounds that have Battles, in playing order', async () => {
    const id = await makeTournament();
    await group({ tournamentId: id, round: 'Swiss stage' });
    await group({ tournamentId: id, round: 'Group stage' }, 'Super League', 'B');
    expect((await json(send('GET', '/api/tournaments')))[0].rounds).toEqual(['Group stage', 'Swiss stage']);
  });
});

describe('the Tournament and Round of a Super League battle', () => {
  it('saves them with the battle, reads them back and filters on them', async () => {
    const id = await makeTournament();
    const created = await json(group({ tournamentId: id, round: 'Swiss stage' }));
    expect(created.fights[0]).toMatchObject({ tournamentId: id, round: 'Swiss stage' });
    await group({ tournamentId: id, round: 'Group stage' }, 'Super League', 'B');
    const swiss = await json(send('GET', `/api/pvp/battles?tournament=${id}&round=Swiss%20stage`));
    expect(swiss).toHaveLength(1);
    expect(await json(send('GET', `/api/tournaments`))).toMatchObject([{ id, battles: 2 }]);
  });

  it('leaves both empty when the body names neither', async () => {
    const created = await json(group());
    expect(created.fights[0]).toMatchObject({ tournamentId: null, round: null });
  });

  it('refuses a Round without a Tournament, an unknown name, an unknown Tournament and other modes', async () => {
    const id = await makeTournament();
    expect((await group({ round: 'Swiss stage' })).status).toBe(400);
    expect((await group({ tournamentId: id, round: 'Top 4' })).status).toBe(400);
    expect((await group({ tournamentId: 999, round: 'Top 16' })).status).toBe(400);
    expect((await group({ tournamentId: id, round: 'Finals' }, 'Supreme Arena')).status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM battle').pluck().get()).toBe(0);
  });

  it('keeps them when an edit does not mention them, and changes them when it does', async () => {
    const id = await makeTournament();
    const created = await json(group({ tournamentId: id, round: 'Group stage' }));
    const edited = await json(send('PUT', `/api/pvp/battle-groups/${created.id}`, { fights: [fight('B')] }));
    expect(edited.fights[0]).toMatchObject({ tournamentId: id, round: 'Group stage' });
    const moved = await json(send('PUT', `/api/pvp/battle-groups/${created.id}`, { fights: [fight('B')], tournamentId: id, round: 'Top 48' }));
    expect(moved.fights[0].round).toBe('Top 48');
    const cleared = await json(send('PUT', `/api/pvp/battle-groups/${created.id}`, { fights: [fight('B')], tournamentId: null, round: null }));
    expect(cleared.fights[0]).toMatchObject({ tournamentId: null, round: null });
  });
});
