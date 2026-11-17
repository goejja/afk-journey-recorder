import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { storeHeroes } from '../../src/import/store-cards.js';
import { storeReferenceData } from '../../src/import/store-reference.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

const json = { 'content-type': 'application/json' };
const ACTION = { 'x-afk-action': 'app' };
const rosterOf = (profile: number) => db.prepare('SELECT hero_name AS hero, rank FROM roster WHERE profile_id = ? ORDER BY hero_name').all(profile);
const STARTERS = [{ hero: 'Chippy', rank: 'Rare' }, { hero: 'Hammie', rank: 'Rare' }];

beforeEach(() => {
  db = openDb(':memory:');
  storeReferenceData(db, {
    ranks: ['Rare', 'Elite', 'Epic'].map((name, position) => ({ name, position })),
    equipmentLevels: [0],
    rankEquipmentCaps: [],
    artifacts: [],
    phantimals: [],
  });
  for (const [name, tier] of [['Sam', 'S'], ['Chippy', 'R'], ['Hammie', 'R']] as const) {
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES (?, ?, 'Mage', 'Wilder', 'Magic')").run(name, tier);
  }
  app = createApp(db);
});

describe('starting heroes', () => {
  it('puts them on the roster of a new profile, also when it copies a roster without them', async () => {
    const created = await app.request('/api/profiles', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Friend' }) });
    const friend = ((await created.json()) as { id: number }).id;
    expect(rosterOf(friend)).toEqual(STARTERS);
    const copy = await app.request('/api/profiles', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Twin', copyFrom: friend }) });
    expect(rosterOf(((await copy.json()) as { id: number }).id)).toEqual(STARTERS);
  });

  it('puts a starting hero that is imported later on every profile and leaves a row that exists as it is', () => {
    db.prepare("INSERT INTO hero (name, tier) VALUES ('Newbie', NULL)").run();
    db.prepare("INSERT INTO profile (name) VALUES ('Other')").run();
    db.prepare("INSERT INTO roster (profile_id, hero_name, rank) VALUES (1, 'Chippy', 'Epic')").run();
    storeHeroes(db, [{ name: 'Newbie', imagePath: '/x', tier: 'R', class: 'Mage', faction: 'Wilder', damageType: 'Magic' }], () => 'images/x.png');
    expect(db.prepare("SELECT rank FROM roster WHERE profile_id = 1 AND hero_name = 'Chippy'").pluck().get()).toBe('Epic');
    expect(db.prepare("SELECT count(*) FROM roster WHERE hero_name = 'Newbie'").pluck().get()).toBe(2);
  });

  it('refuses to remove one, and removes any other hero', async () => {
    await app.request('/api/roster/Sam', { method: 'PUT', headers: json, body: JSON.stringify({ rank: 'Epic', equipmentLevel: null }) });
    const refused = await app.request('/api/roster/Chippy', { method: 'DELETE', headers: ACTION });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('Chippy is a starting hero and stays on every roster');
    expect((await app.request('/api/roster/Sam', { method: 'DELETE', headers: ACTION })).status).toBe(204);
  });

  it('keeps them when the roster is reset', async () => {
    await app.request('/api/roster/Sam', { method: 'PUT', headers: json, body: JSON.stringify({ rank: 'Epic', equipmentLevel: null }) });
    ensureRows();
    expect((await app.request('/api/roster/reset', { method: 'POST', headers: ACTION })).status).toBe(204);
    expect(rosterOf(1)).toEqual(STARTERS);
  });
});

function ensureRows() {
  db.prepare("INSERT OR IGNORE INTO roster (profile_id, hero_name, rank) VALUES (1, 'Chippy', 'Rare'), (1, 'Hammie', 'Rare')").run();
}

describe('migration 24', () => {
  it('adds the starting heroes to every profile that lacks them and keeps the rows that exist', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'afk-start-')), 'afk.db');
    const first = openDb(path);
    first.prepare("INSERT INTO rank (name, position) VALUES ('Rare', 0), ('Epic', 1)").run();
    first.prepare("INSERT INTO hero (name, tier) VALUES ('Chippy', 'R')").run();
    first.prepare("INSERT INTO profile (name) VALUES ('Other')").run();
    first.prepare("INSERT INTO roster (profile_id, hero_name, rank) VALUES (1, 'Chippy', 'Epic')").run();
    first.prepare("DELETE FROM roster WHERE profile_id = 2").run();
    first.pragma('user_version = 23');
    first.close();
    const db2 = openDb(path);
    expect(db2.prepare("SELECT profile_id AS profile, rank FROM roster WHERE hero_name = 'Chippy' ORDER BY profile_id").all()).toEqual([
      { profile: 1, rank: 'Epic' },
      { profile: 2, rank: 'Rare' },
    ]);
    db2.close();
  });
});
