import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2]', '[0,0]', 'manual'), ('Open', '[\"Stage\"]', '[2]', '[0,0]', 'manual')").run();
  db.prepare("INSERT INTO boss (name) VALUES ('King Croaker'), ('Thalassa')").run();
  db.prepare("INSERT INTO boss_rule (name, description) VALUES ('Berserk', '')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

describe('the weekly setup', () => {
  it('starts empty, with a slot for every team or fight of each mode', async () => {
    const view = await json(send('GET', '/api/defaults'));
    expect(Object.keys(view)).toEqual(['Supreme Arena', 'Super League', 'Guild Duel', 'Dream Hunt']);
    expect(view['Supreme Arena'].slots).toHaveLength(3);
    expect(view['Super League'].slots).toHaveLength(5);
    expect(view['Guild Duel'].slots).toHaveLength(3);
    expect(view['Dream Hunt'].slots).toHaveLength(5);
    expect(view['Dream Hunt'].updatedAt).toBeNull();
  });

  it('saves the maps and rules of a Supreme Arena week, leaving unset teams empty', async () => {
    const slots = [{ mapName: 'Duel', rule: 'Berserk' }, {}, { mapName: 'Duel' }];
    const view = await json(send('PUT', '/api/defaults/Supreme Arena', { slots }));
    expect(view['Supreme Arena'].slots).toEqual([
      { boss: null, mapName: 'Duel', rule: 'Berserk' },
      { boss: null, mapName: null, rule: null },
      { boss: null, mapName: 'Duel', rule: null },
    ]);
    expect(view['Supreme Arena'].updatedAt).not.toBeNull();
    expect(db.prepare("SELECT count(*) FROM weekly_default WHERE mode = 'Supreme Arena'").pluck().get()).toBe(2);
  });

  it('saves the bosses and stage maps of a Dream Hunt week, with a rule on the last fight only', async () => {
    const slots = [{ boss: 'King Croaker', mapName: 'Open' }, { boss: 'Thalassa' }, {}, {}, { boss: 'King Croaker', rule: 'Berserk' }];
    const view = await json(send('PUT', '/api/defaults/Dream Hunt', { slots }));
    expect(view['Dream Hunt'].slots[4]).toEqual({ boss: 'King Croaker', mapName: null, rule: 'Berserk' });
    expect((await send('PUT', '/api/defaults/Dream Hunt', { slots: [{ rule: 'Berserk' }] })).status).toBe(400); // only the fifth fight has a rule
  });

  it('refuses names that do not exist, maps of the wrong kind, a boss outside Dream Hunt, a rule in Super League, and too many teams', async () => {
    const put = (mode: string, slots: unknown[]) => send('PUT', `/api/defaults/${mode}`, { slots });
    expect((await put('Supreme Arena', [{ mapName: 'Nowhere' }])).status).toBe(400);
    expect((await put('Supreme Arena', [{ mapName: 'Open' }])).status).toBe(400); // a Stage map
    expect((await put('Dream Hunt', [{ mapName: 'Duel' }])).status).toBe(400); // an Arena map
    expect((await put('Dream Hunt', [{ boss: 'Nobody' }])).status).toBe(400);
    expect((await put('Supreme Arena', [{ rule: 'Nope' }])).status).toBe(400);
    expect((await put('Supreme Arena', [{ boss: 'Thalassa' }])).status).toBe(400);
    expect((await put('Super League', [{ rule: 'Berserk' }])).status).toBe(400);
    expect((await put('Guild Duel', [{ rule: 'Berserk' }])).status).toBe(400);
    expect((await put('Guild Duel', [{ mapName: 'Duel' }, {}, {}, {}])).status).toBe(400);
    expect((await put('Guild Duel', [{ mapName: 'Duel' }, { mapName: 'Duel' }, {}])).status).toBe(200);
    expect((await put('Supreme Arena', [{}, {}, {}, {}])).status).toBe(400);
    expect((await put('Arena', [])).status).toBe(400);
  });

  it('replaces a mode’s setup when saved again, and clears it', async () => {
    await send('PUT', '/api/defaults/Supreme Arena', { slots: [{ mapName: 'Duel' }, { mapName: 'Duel' }] });
    await send('PUT', '/api/defaults/Supreme Arena', { slots: [{ rule: 'Berserk' }] });
    const view = await json(send('GET', '/api/defaults'));
    expect(view['Supreme Arena'].slots.map((s: any) => s.mapName)).toEqual([null, null, null]);
    expect((await json(send('DELETE', '/api/defaults/Supreme Arena')))['Supreme Arena'].slots.every((s: any) => s.rule === null)).toBe(true);
    expect((await send('DELETE', '/api/defaults/Arena')).status).toBe(404);
  });

  it('forgets a map that is deleted, keeping the rest of the setup', async () => {
    await send('PUT', '/api/defaults/Supreme Arena', { slots: [{ mapName: 'Duel', rule: 'Berserk' }] });
    db.prepare("DELETE FROM map WHERE name = 'Duel'").run();
    expect((await json(send('GET', '/api/defaults')))['Supreme Arena'].slots[0]).toEqual({ boss: null, mapName: null, rule: 'Berserk' });
  });
});
