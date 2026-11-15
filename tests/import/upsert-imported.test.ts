import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { upsertImported } from '../../src/import/upsert.js';

describe('upsertImported', () => {
  const statement = (db: ReturnType<typeof openDb>) => upsertImported(db, 'boss', ['name', 'name'], [['class', 'class'], ['damage_type', 'damageType']]);

  it('inserts a row and refreshes it while it is the importer\'s', () => {
    const db = openDb(':memory:');
    const upsert = statement(db);
    upsert.run({ name: 'King Croaker', class: 'Mage', damageType: 'Magic' });
    upsert.run({ name: 'King Croaker', class: 'Warrior', damageType: 'Physical' });
    expect(db.prepare("SELECT class, damage_type AS damageType, source FROM boss WHERE name = 'King Croaker'").get()).toEqual({ class: 'Warrior', damageType: 'Physical', source: 'import' });
  });

  it('leaves a row the player added or edited by hand alone', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO boss (name, class, damage_type, source) VALUES ('King Croaker', 'Mage', 'Magic', 'manual')").run();
    statement(db).run({ name: 'King Croaker', class: 'Warrior', damageType: 'Physical' });
    expect(db.prepare("SELECT class, source FROM boss WHERE name = 'King Croaker'").get()).toEqual({ class: 'Mage', source: 'manual' });
  });
});
