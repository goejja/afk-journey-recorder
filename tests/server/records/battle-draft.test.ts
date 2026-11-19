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

describe('what the Agent was unsure of (ADR 0040)', () => {
  const tile = (key: string, hero: string | null, over: object = {}) => ({ key, crop: '0.a', index: 0, hero, candidates: [] as string[], rank: null, confident: true, rankConfident: false, notOwned: false, stars: null, ...over });
  const draft = (tiles: ReturnType<typeof tile>[]) => draftOf(db, rules, 'Arena', [{ name: 'Me', tiles }, player('Other')], null).sideA;

  it('marks a hero it named without being sure, and keeps the guesses for a tile it could not name', () => {
    const side = draft([tile('a', 'Evie'), tile('b', 'Zed', { confident: false }), tile('c', null, { candidates: ['Fay', 'Nara'] }), tile('d', null)]);
    expect(side.heroes).toEqual([
      { tile: 'a', hero: 'Evie', rank: null, equipmentLevel: null },
      { tile: 'b', hero: 'Zed', rank: null, equipmentLevel: null, unsure: true, candidates: [] },
    ]);
    expect(side.unread).toEqual(['c', 'd']);
    expect(side.unreadCandidates).toEqual({ c: ['Fay', 'Nara'] });
  });

  it('says nothing of guesses when there are none', () => {
    expect(draft([tile('a', null)]).unreadCandidates).toBeUndefined();
  });
});
