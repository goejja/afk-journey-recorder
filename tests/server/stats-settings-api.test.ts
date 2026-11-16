import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const PVP = ['Arena', 'Supreme Arena', 'Super League', 'Guild Duel'];
const ALL = ['Stage', 'Dream Hunt', ...PVP, 'Treasure Rush'];

describe('statistics default modes', () => {
  it('start as the PvP modes, and list every mode to choose from', async () => {
    expect(await json(send('GET', '/api/stats-settings'))).toEqual({ modes: PVP, defaults: PVP, available: ALL });
  });

  it('saves a list of modes, in the order of the list of all modes, each once', async () => {
    const saved = await json(send('PUT', '/api/stats-settings', { modes: ['Dream Hunt', 'Arena', 'Arena'] }));
    expect(saved).toMatchObject({ modes: ['Dream Hunt', 'Arena'] });
    expect(await json(send('GET', '/api/stats-settings'))).toMatchObject({ modes: ['Dream Hunt', 'Arena'] });
  });

  it('keeps an empty list as "all modes", which is not the same as never having chosen', async () => {
    expect(await json(send('PUT', '/api/stats-settings', { modes: [] }))).toMatchObject({ modes: [] });
    expect(await json(send('GET', '/api/stats-settings'))).toMatchObject({ modes: [] });
  });

  it('goes back to the PvP modes when reset', async () => {
    await send('PUT', '/api/stats-settings', { modes: ['Stage'] });
    expect(await json(send('DELETE', '/api/stats-settings'))).toMatchObject({ modes: PVP });
    expect(db.prepare('SELECT count(*) FROM stats_setting').pluck().get()).toBe(0);
  });

  it.each([
    ['no list', {}],
    ['a text', { modes: 'Arena' }],
    ['an unknown mode', { modes: ['Arena', 'Raid'] }],
    ['a value that is not text', { modes: [1] }],
  ])('refuses %s', async (_name, body) => {
    expect((await send('PUT', '/api/stats-settings', body)).status).toBe(400);
  });

  it('is not touched by the statistics routes: they still count every mode unless asked', async () => {
    await send('PUT', '/api/stats-settings', { modes: ['Arena'] });
    expect((await send('GET', '/api/stats/heroes')).status).toBe(200);
  });
});

describe('counter rule', () => {
  it('starts as 65% over 5 games, with the defaults listed', async () => {
    expect(await json(send('GET', '/api/counter-rule'))).toEqual({ winRate: 0.65, minGames: 5, defaults: { winRate: 0.65, minGames: 5 } });
  });

  it('saves a rule, and goes back to the defaults without touching the modes', async () => {
    await send('PUT', '/api/stats-settings', { modes: ['Stage'] });
    expect(await json(send('PUT', '/api/counter-rule', { winRate: 0.7, minGames: 8 }))).toMatchObject({ winRate: 0.7, minGames: 8 });
    expect(await json(send('GET', '/api/counter-rule'))).toMatchObject({ winRate: 0.7, minGames: 8 });
    await send('DELETE', '/api/stats-settings');
    expect(await json(send('GET', '/api/counter-rule'))).toMatchObject({ winRate: 0.7, minGames: 8 });

    expect(await json(send('DELETE', '/api/counter-rule'))).toMatchObject({ winRate: 0.65, minGames: 5 });
  });

  it.each([
    ['no values', {}],
    ['a win rate under 50%', { winRate: 0.4, minGames: 5 }],
    ['a win rate over 100%', { winRate: 1.2, minGames: 5 }],
    ['no games', { winRate: 0.65, minGames: 0 }],
    ['a part of a game', { winRate: 0.65, minGames: 2.5 }],
    ['more than 50 games', { winRate: 0.65, minGames: 51 }],
  ])('refuses %s', async (_name, body) => {
    expect((await send('PUT', '/api/counter-rule', body)).status).toBe(400);
  });
});
