import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO boss (name, class, damage_type, image_path, source) VALUES ('King Croaker', 'Mage', 'Magic', 'images/bosses/King Croaker.png', 'import'), ('Doomscourge', 'Warrior', 'Magic', NULL, 'import')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const list = async () => (await (await send('GET', '/api/bosses')).json()) as any[];
const error = async (response: Response) => ((await response.json()) as { error: string }).error;

/** One of each thing that can use a boss. */
function useBoss(name: string) {
  const attempt = db.prepare("INSERT INTO attempt (mode, outcome) VALUES ('Dream Hunt', 'Win')").run().lastInsertRowid;
  db.prepare("INSERT OR IGNORE INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[]', '[]', '[]', 'manual')").run();
  db.prepare("INSERT INTO dream_hunt_attempt (attempt_id, boss_name, map_name) VALUES (?, ?, 'Open')").run(attempt, name);
  db.prepare("INSERT INTO weekly_default (mode, position, boss) VALUES ('Dream Hunt', 1, ?)").run(name);
  db.prepare('INSERT INTO titan_reaver_default (position, boss) VALUES (1, ?)').run(name);
  const battle = db.prepare("INSERT INTO titan_reaver_battle (season, season_phase, titan_phase, level) VALUES (1, 1, 'Charge', 600)").run().lastInsertRowid;
  db.prepare('INSERT INTO titan_reaver_fight (battle_id, position, boss_name, damage) VALUES (?, 1, ?, 1)').run(battle, name);
}

describe('the bosses API', () => {
  it('lists the bosses with where they come from, the Dream Hunt attempts that fought them and what uses them', async () => {
    expect(await list()).toEqual([
      { name: 'Doomscourge', class: 'Warrior', damageType: 'Magic', source: 'import', handMade: false, attempts: 0, usedBy: '', uses: 0 },
      { name: 'King Croaker', class: 'Mage', damageType: 'Magic', source: 'import', handMade: false, attempts: 0, usedBy: '', uses: 0 },
    ]);
    useBoss('King Croaker');
    expect((await list()).find((b) => b.name === 'King Croaker')).toMatchObject({ attempts: 1, uses: 4, usedBy: '1 Dream Hunt record, 1 Titan Reaver fight, 1 Weekly default slot, 1 Titan Reaver setup slot' });
  });

  it('adds a boss as the player’s own, trimmed, with a class and damage type or neither', async () => {
    const created = await send('POST', '/api/bosses', { name: ' Gloomwing ', class: 'Rogue', damageType: 'Physical' });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: 'Gloomwing', class: 'Rogue', damageType: 'Physical', source: 'manual', handMade: true });
    expect(db.prepare("SELECT image_path FROM boss WHERE name = 'Gloomwing'").pluck().get()).toBeNull();
    expect((await send('POST', '/api/bosses', { name: 'Bare' })).status).toBe(201);
    expect(await list()).toContainEqual(expect.objectContaining({ name: 'Bare', class: null, damageType: null }));
  });

  it('refuses a name that is empty or taken (whatever its case), and a class or damage type the game lacks', async () => {
    expect(await error(await send('POST', '/api/bosses', { name: '  ' }))).toBe('A boss name cannot be empty');
    const taken = await send('POST', '/api/bosses', { name: 'king croaker' });
    expect(taken.status).toBe(409);
    expect(await error(taken)).toBe('A boss named "king croaker" already exists');
    expect(await error(await send('POST', '/api/bosses', { name: 'X', class: 'Wizard' }))).toMatch(/Class must be one of/);
    expect(await error(await send('POST', '/api/bosses', { name: 'X', damageType: 'Fire' }))).toBe('Damage type must be Physical or Magic');
  });

  it('edits the class and damage type, makes the boss the player’s own, and never renames it', async () => {
    const saved = await send('PUT', '/api/bosses/Doomscourge', { name: 'Renamed', class: 'Tank', damageType: 'Physical' });
    expect(await saved.json()).toMatchObject({ name: 'Doomscourge', class: 'Tank', damageType: 'Physical', source: 'manual' });
    expect(await list()).not.toContainEqual(expect.objectContaining({ name: 'Renamed' }));
    // saving what it already is leaves it as imported
    await send('PUT', '/api/bosses/King Croaker', { name: 'King Croaker', class: 'Mage', damageType: 'Magic' });
    expect((await list()).find((b) => b.name === 'King Croaker')!.source).toBe('import');
    expect((await send('PUT', '/api/bosses/Nobody', { name: 'Nobody' })).status).toBe(404);
  });

  it('deletes a boss nothing uses, and refuses one that is used, saying what uses it', async () => {
    useBoss('King Croaker');
    const refused = await send('DELETE', '/api/bosses/King Croaker');
    expect(refused.status).toBe(409);
    expect(await error(refused)).toBe('King Croaker is used by 1 Dream Hunt record, 1 Titan Reaver fight, 1 Weekly default slot, 1 Titan Reaver setup slot, so it cannot be deleted');
    expect((await send('DELETE', '/api/bosses/Doomscourge')).status).toBe(204);
    expect((await list()).map((b) => b.name)).toEqual(['King Croaker']);
    expect((await send('DELETE', '/api/bosses/Doomscourge')).status).toBe(404);
  });

  it('refuses a delete for a weekly default alone, which the schema would only empty', async () => {
    db.prepare("INSERT INTO weekly_default (mode, position, boss) VALUES ('Dream Hunt', 1, 'Doomscourge')").run();
    expect(await error(await send('DELETE', '/api/bosses/Doomscourge'))).toBe('Doomscourge is used by 1 Weekly default slot, so it cannot be deleted');
  });
});
