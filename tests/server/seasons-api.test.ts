import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
let dir: string | undefined;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

describe('seasons', () => {
  it('starts with season 8 as the current one', async () => {
    expect(await json(send('GET', '/api/seasons'))).toEqual([{ number: 8, current: true, stages: 0, phantimals: 0 }]);
  });

  it('adds a season, refuses a repeat or a bad number, and makes another current', async () => {
    expect((await json(send('POST', '/api/seasons', { number: 9 }))).map((s: any) => s.number)).toEqual([9, 8]);
    expect((await send('POST', '/api/seasons', { number: 9 })).status).toBe(409);
    expect((await send('POST', '/api/seasons', { number: 0 })).status).toBe(400);
    expect((await send('POST', '/api/seasons', { number: 'x' })).status).toBe(400);
    const after = await json(send('PUT', '/api/seasons/current', { number: 9 }));
    expect(after.filter((s: any) => s.current).map((s: any) => s.number)).toEqual([9]);
    expect((await send('PUT', '/api/seasons/current', { number: 4 })).status).toBe(404);
  });

  it('lists a season that stages or phantimals name, and will not remove it or the current one', async () => {
    db.prepare("INSERT INTO phantimal (name, source) VALUES ('Gervan', 'manual')").run();
    db.prepare("INSERT INTO phantimal_season (phantimal_name, season) VALUES ('Gervan', 5)").run();
    expect(await json(send('GET', '/api/seasons'))).toContainEqual({ number: 5, current: false, stages: 0, phantimals: 1 });
    expect((await send('DELETE', '/api/seasons/5')).status).toBe(409);
    expect((await send('DELETE', '/api/seasons/8')).status).toBe(409);
    await send('POST', '/api/seasons', { number: 6 });
    expect((await json(send('DELETE', '/api/seasons/6'))).map((s: any) => s.number)).toEqual([8, 5]);
    expect((await send('DELETE', '/api/seasons/6')).status).toBe(404);
  });
});
