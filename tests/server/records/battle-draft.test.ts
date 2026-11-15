import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../../src/db/open.js';
import type { HeroStateRules } from '../../../src/domain/hero-state.js';
import type { ImportPlayer } from '../../../src/domain/roster-import.js';
import { draftOf } from '../../../src/server/records/battle-draft.js';

const rules: HeroStateRules = { ranks: ['Mythic'], equipmentLevels: [0, 10], caps: [] };
let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
});

const player = (name: string | null): ImportPlayer => ({ name, tiles: [] });
const sideA = (name: string) => draftOf(db, rules, 'Arena', [player(name), player('Other')], null).sideA;

describe('the Profile a picture’s player name resolves to', () => {
  it('is the one with that name when no Seen name says otherwise', () => {
    db.prepare("INSERT INTO profile (name) VALUES ('Мокка')").run();
    expect(sideA('Мокка').profile).toMatchObject({ name: 'Мокка' });
    expect(sideA('Mokka').profile?.name).toBe('Мокка'); // look-alike letters fold
  });

  it('is the one a Seen name was resolved to before, whatever its own name is (ADR 0021)', () => {
    const id = Number(db.prepare("INSERT INTO profile (name) VALUES ('Traveler')").run().lastInsertRowid);
    db.prepare("INSERT INTO profile_name (folded, profile_id, name) VALUES ('mokka', ?, 'Мокка')").run(id);
    expect(sideA('Мокка').profile).toMatchObject({ id, name: 'Traveler' });
    expect(sideA('MOKKA').profile?.id).toBe(id);
  });

  it('is none when neither the name nor a Seen name fits', () => {
    expect(sideA('Nobody').profile).toBeNull();
  });
});
