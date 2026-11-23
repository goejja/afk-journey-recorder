import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;

const BOSSES = ['Aegis', 'Basilisk', 'Cerberus', 'Draugr', 'Eclipse', 'Fenrir'];

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare(`INSERT INTO boss (name) VALUES ${BOSSES.map((b) => `('${b}')`).join(', ')}`).run();
  app = createApp(db);
});

const send = (method: string, body?: unknown) =>
  app.request('/api/titan-reaver/setup', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const full = { bosses: BOSSES };

describe('the Titan Reaver setup', () => {
  it('starts with six empty slots', async () => {
    const view = await json(send('GET'));
    expect(view).toEqual({ bosses: [null, null, null, null, null, null], updatedAt: null });
  });

  it('saves 6 bosses', async () => {
    const view = await json(send('PUT', full));
    expect(view.bosses).toEqual(BOSSES);
    expect(view.updatedAt).toBeTruthy();
    expect(db.prepare('SELECT count(*) FROM titan_reaver_default').pluck().get()).toBe(6);
  });

  it('takes an empty setup', async () => {
    const view = await json(send('PUT', { bosses: [null, null, null, null, null, null] }));
    expect(view.bosses).toEqual([null, null, null, null, null, null]);
    expect(db.prepare('SELECT count(*) FROM titan_reaver_default').pluck().get()).toBe(0);
  });

  it('keeps a slot with no boss in its place', async () => {
    const view = await json(send('PUT', { bosses: [null, 'Basilisk', null, null, null, 'Fenrir'] }));
    expect(view.bosses).toEqual([null, 'Basilisk', null, null, null, 'Fenrir']);
  });

  it('refuses the same boss twice, whether in one Titan Reaver Phase or in two', async () => {
    const same = await send('PUT', { bosses: ['Aegis', 'Aegis', null, null, null, null] });
    expect(same.status).toBe(400);
    expect(((await same.json()) as any).error).toContain('Charge, boss 1 and Charge, boss 2');
    expect((await send('PUT', { bosses: ['Aegis', null, null, null, 'Aegis', null] })).status).toBe(400);
  });

  it('refuses an unknown boss and a wrong number of slots', async () => {
    expect((await send('PUT', { bosses: ['Nobody', null, null, null, null, null] })).status).toBe(400);
    expect((await send('PUT', { bosses: BOSSES.slice(0, 5) })).status).toBe(400);
    expect((await send('PUT', { bosses: [...BOSSES, null] })).status).toBe(400);
    expect((await json(send('GET'))).bosses).toEqual([null, null, null, null, null, null]);
  });

  it('replaces the whole setup when saved again, and clears it', async () => {
    await send('PUT', full);
    const view = await json(send('PUT', { bosses: ['Fenrir', null, null, null, null, null] }));
    expect(view.bosses).toEqual(['Fenrir', null, null, null, null, null]);
    expect((await json(send('DELETE'))).bosses).toEqual([null, null, null, null, null, null]);
    expect(db.prepare('SELECT count(*) FROM titan_reaver_default').pluck().get()).toBe(0);
  });

  it('follows a renamed boss and forgets a deleted one, keeping the rest', async () => {
    await send('PUT', full);
    db.prepare("UPDATE boss SET name = 'Aegis II' WHERE name = 'Aegis'").run();
    db.prepare("DELETE FROM boss WHERE name = 'Basilisk'").run();
    expect((await json(send('GET'))).bosses).toEqual(['Aegis II', null, 'Cerberus', 'Draugr', 'Eclipse', 'Fenrir']);
  });
});
