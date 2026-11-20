import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/open.js';
import { defaultPlayerId, defaultProfileId, listProfiles, setDefaultProfile } from '../../src/db/profiles.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
});

const addProfile = (name: string, playerId: string | null = null) => Number(db.prepare('INSERT INTO profile (name, player_id) VALUES (?, ?)').run(name, playerId).lastInsertRowid);

describe('defaultPlayerId', () => {
  it('is null while the default profile has no Player ID, and the Player ID once it has one', () => {
    expect(defaultPlayerId(db)).toBeNull();
    db.prepare('UPDATE profile SET player_id = ? WHERE is_default = 1').run('12345678');
    expect(defaultPlayerId(db)).toBe('12345678');
  });

  it('ignores the Player ID of a profile that is not the default', () => {
    addProfile('Friend', '222');
    expect(defaultPlayerId(db)).toBeNull();
  });
});

describe('setDefaultProfile', () => {
  it('moves the default to the profile, leaving exactly one', () => {
    const friend = addProfile('Friend', '222');
    setDefaultProfile(db, friend);
    expect(defaultProfileId(db)).toBe(friend);
    expect(db.prepare('SELECT count(*) FROM profile WHERE is_default = 1').pluck().get()).toBe(1);
    expect(defaultPlayerId(db)).toBe('222');
  });
});

describe('listProfiles', () => {
  it('lists the default first, then by name, with the hero count of each roster', () => {
    const zed = addProfile('Zed');
    const amy = addProfile('Amy', '111');
    db.prepare("INSERT OR IGNORE INTO hero (name) VALUES ('A'), ('B')").run();
    db.prepare("INSERT INTO roster (profile_id, hero_name) VALUES (?, 'A'), (?, 'B')").run(amy, amy);
    const rows = listProfiles(db);
    expect(rows.map((p) => p.name)).toEqual(['Me', 'Amy', 'Zed']);
    expect(rows.map((p) => p.isDefault)).toEqual([true, false, false]);
    expect(rows.find((p) => p.id === amy)).toMatchObject({ playerId: '111', heroCount: 2 });
    expect(rows.find((p) => p.id === zed)?.heroCount).toBe(0);
  });
});
