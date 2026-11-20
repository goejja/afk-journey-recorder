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

describe('the Thinning settings', () => {
  it('start at the default distance for Rank Looks, and say what the defaults are', async () => {
    expect(await json(send('GET', '/api/thinning-settings'))).toEqual({ rank: 0.05, defaults: { rank: 0.05 } });
  });

  it('keep a saved distance', async () => {
    const saved = await send('PUT', '/api/thinning-settings', { rank: 0.03 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ rank: 0.03, defaults: { rank: 0.05 } });
    expect(await json(send('GET', '/api/thinning-settings'))).toEqual({ rank: 0.03, defaults: { rank: 0.05 } });
  });

  it('refuse a distance that is not above 0 and at most 0.2, or not a number, keeping the saved one', async () => {
    await send('PUT', '/api/thinning-settings', { rank: 0.03 });
    for (const body of [{ rank: 0 }, { rank: -0.01 }, { rank: 0.21 }, { rank: '0.03' }, { rank: null }, {}, null]) {
      const response = await send('PUT', '/api/thinning-settings', body);
      expect(response.status).toBe(400);
      expect(typeof (await response.json()).error).toBe('string');
    }
    expect((await json(send('GET', '/api/thinning-settings'))).rank).toBe(0.03);
    expect((await send('PUT', '/api/thinning-settings', { rank: 0.2 })).status).toBe(200);
  });
});
