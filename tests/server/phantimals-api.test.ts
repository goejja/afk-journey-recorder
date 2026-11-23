import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { PAIR_PHANTIMALS } from '../../src/domain/units.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;

beforeEach(() => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO phantimal (name, faction, class, source) VALUES ('Gervan', 'Lightbearer', 'Mage', 'import')").run();
  db.prepare("INSERT INTO phantimal_season VALUES ('Gervan', 8)").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const list = async () => (await (await send('GET', '/api/phantimals')).json()) as any[];

describe('phantimals API', () => {
  it('lists phantimals with their season tags', async () => {
    expect(await list()).toEqual([
      { name: 'Gervan', part: null, faction: 'Lightbearer', class: 'Mage', seasons: [8], source: 'import' },
    ]);
  });

  it('creates a phantimal tagged with several seasons', async () => {
    const response = await send('POST', '/api/phantimals', { name: ' Newcomer ', faction: 'Wilder', class: 'Tank', seasons: [9, 8, 9] });
    expect(response.status).toBe(201);
    expect((await list()).find((p) => p.name === 'Newcomer')).toMatchObject({ seasons: [8, 9], source: 'manual' });
  });

  it('rejects invalid and duplicate phantimals', async () => {
    expect((await send('POST', '/api/phantimals', { name: '', seasons: [] })).status).toBe(400);
    expect((await send('POST', '/api/phantimals', { name: 'X', seasons: ['8'] })).status).toBe(400);
    expect((await send('POST', '/api/phantimals', { name: 'Gervan', seasons: [] })).status).toBe(409);
  });

  it('editing the season tags makes an import the player\'s own', async () => {
    const response = await send('PUT', '/api/phantimals/Gervan', { name: 'Gervan', faction: 'Lightbearer', class: 'Mage', seasons: [8, 9] });
    expect(await response.json()).toMatchObject({ seasons: [8, 9], source: 'manual' });
  });

  it('leaves an import untouched when saved without changes', async () => {
    const response = await send('PUT', '/api/phantimals/Gervan', { name: 'Gervan', faction: 'Lightbearer', class: 'Mage', seasons: [8] });
    expect(await response.json()).toMatchObject({ source: 'import' });
  });

  it('renames a phantimal and keeps its season tags', async () => {
    await send('PUT', '/api/phantimals/Gervan', { name: 'Gervan II', faction: 'Lightbearer', class: 'Mage', seasons: [8] });
    expect(await list()).toMatchObject([{ name: 'Gervan II', seasons: [8] }]);
  });

  it('deletes a phantimal and its season tags', async () => {
    expect((await send('DELETE', '/api/phantimals/Gervan')).status).toBe(204);
    expect(await list()).toEqual([]);
  });

  describe('second part', () => {
    it('is declared, renamed with its phantimal and removed with it', async () => {
      expect((await send('POST', '/api/phantimals', { name: 'Twin', seasons: [], part: 'Twin shadow' })).status).toBe(201);
      expect((await list()).find((p) => p.name === 'Twin')).toMatchObject({ part: 'Twin shadow' });
      expect(PAIR_PHANTIMALS.Twin).toBe('Twin shadow');
      await send('PUT', '/api/phantimals/Twin', { name: 'Twins', seasons: [] });
      expect((await list()).find((p) => p.name === 'Twins')).toMatchObject({ part: 'Twin shadow' });
      expect(PAIR_PHANTIMALS.Twins).toBe('Twin shadow');
      await send('PUT', '/api/phantimals/Twins', { name: 'Twins', seasons: [], part: null });
      expect((await list()).find((p) => p.name === 'Twins')).toMatchObject({ part: null });
      await send('PUT', '/api/phantimals/Twins', { name: 'Twins', seasons: [], part: 'Shade' });
      await send('DELETE', '/api/phantimals/Twins');
      expect(PAIR_PHANTIMALS.Twins).toBeUndefined();
    });

    it('cannot take the name of a hero, a phantimal or another unit', async () => {
      expect((await send('POST', '/api/phantimals', { name: 'A', seasons: [], part: 'gervan' })).status).toBe(409);
      expect((await send('POST', '/api/phantimals', { name: 'B', seasons: [], part: 'Wedge of Power' })).status).toBe(409);
      expect((await send('POST', '/api/phantimals', { name: 'laser turret', seasons: [] })).status).toBe(409);
    });

    it('cannot change once a record uses the phantimal', async () => {
      const db = openDb(':memory:');
      db.prepare("INSERT INTO phantimal (name, source) VALUES ('Used', 'manual')").run();
      db.prepare("INSERT INTO attempt (id, mode, outcome) VALUES (1, 'Arena', 'Win')").run();
      db.prepare("INSERT INTO formation (attempt_id, phantimal_name, phantimal_tile) VALUES (1, 'Used', 30)").run();
      const used = createApp(db);
      const put = (body: unknown) => used.request('/api/phantimals/Used', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const refused = await put({ name: 'Used', seasons: [], part: 'Used shade' });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toMatch(/1 records/);
      expect((await put({ name: 'Used', faction: 'Wilder', seasons: [] })).status).toBe(200);
      expect(await (await used.request('/api/phantimals/Used/usage')).json()).toEqual({ records: 1, deployments: 0, placements: 1 });
    });
  });
});
