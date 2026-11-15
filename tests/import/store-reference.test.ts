import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { storeReferenceData } from '../../src/import/store-reference.js';
import { extractReferenceData } from '../../src/import/yaphalla-data.js';
import { chunkA, chunkB } from '../fixtures/yaphalla-chunks.js';

const data = extractReferenceData([chunkA, chunkB]);

describe('storeReferenceData', () => {
  it('stores ranks, equipment levels, caps and artifacts', () => {
    const db = openDb(':memory:');
    storeReferenceData(db, data);
    expect(db.prepare('SELECT count(*) FROM rank').pluck().get()).toBe(15);
    expect(db.prepare('SELECT count(*) FROM equipment_level').pluck().get()).toBe(10);
    expect(db.prepare('SELECT count(*) FROM rank_equipment_cap').pluck().get()).toBe(7);
    expect(db.prepare('SELECT count(*) FROM artifact').pluck().get()).toBe(6);
  });

  it('stores phantimals tagged with their seasons and keeps manual edits', () => {
    const db = openDb(':memory:');
    storeReferenceData(db, data);
    // Yaphalla lists Wedge of Power too, but it is the second part of Wedge of Matter, not a phantimal.
    expect(db.prepare('SELECT count(*) FROM phantimal').pluck().get()).toBe(10);
    expect(db.prepare("SELECT count(*) FROM phantimal WHERE name = 'Wedge of Power'").pluck().get()).toBe(0);
    const seasons = db.prepare("SELECT season FROM phantimal_season WHERE phantimal_name = 'Gervan'").pluck().all();
    expect(seasons).toEqual([8]);

    db.prepare("UPDATE phantimal SET class = 'Tank', source = 'manual' WHERE name = 'Gervan'").run();
    db.prepare("DELETE FROM phantimal_season WHERE phantimal_name = 'Gervan'").run();
    db.prepare("INSERT INTO phantimal_season VALUES ('Gervan', 9)").run();
    storeReferenceData(db, data);
    expect(db.prepare("SELECT class FROM phantimal WHERE name = 'Gervan'").pluck().get()).toBe('Tank');
    expect(db.prepare("SELECT season FROM phantimal_season WHERE phantimal_name = 'Gervan'").pluck().all()).toEqual([9]);
  });

  it('is idempotent', () => {
    const db = openDb(':memory:');
    storeReferenceData(db, data);
    storeReferenceData(db, data);
    expect(db.prepare('SELECT count(*) FROM artifact').pluck().get()).toBe(6);
    expect(db.prepare('SELECT position FROM rank WHERE name = ?').pluck().get('Rare')).toBe(0);
  });

  it('never overwrites a manually edited row', () => {
    const db = openDb(':memory:');
    storeReferenceData(db, data);
    db.prepare("UPDATE rank_equipment_cap SET max_level = 20, source = 'manual' WHERE rank = 'Supreme'").run();
    storeReferenceData(db, data);
    const row = db.prepare("SELECT max_level, source FROM rank_equipment_cap WHERE rank = 'Supreme'").get();
    expect(row).toEqual({ max_level: 20, source: 'manual' });
  });
});
