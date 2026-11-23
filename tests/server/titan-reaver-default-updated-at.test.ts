import { describe, expect, it } from 'vitest';
import { migration } from '../../src/db/migrations/037-titan-reaver-default-updated-at.js';
import { openDb } from '../../src/db/open.js';

const columns = (db: ReturnType<typeof openDb>) => db.prepare("SELECT name FROM pragma_table_info('titan_reaver_default')").pluck().all();

describe('migration 37', () => {
  it('adds updated_at to a titan_reaver_default made by the earlier migration 33, keeping its rows', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO boss (name) VALUES ('Aegis')").run();
    db.exec(`
      DROP TABLE titan_reaver_default;
      CREATE TABLE titan_reaver_default (
        position INTEGER PRIMARY KEY CHECK (position BETWEEN 1 AND 6),
        boss     TEXT UNIQUE REFERENCES boss (name) ON UPDATE CASCADE ON DELETE SET NULL
      );
      INSERT INTO titan_reaver_default (position, boss) VALUES (2, 'Aegis');
    `);
    migration(db);
    expect(columns(db)).toEqual(['position', 'boss', 'updated_at']);
    expect(db.prepare('SELECT position, boss, updated_at IS NOT NULL AS stamped FROM titan_reaver_default').all()).toEqual([{ position: 2, boss: 'Aegis', stamped: 1 }]);
  });

  it('leaves a table that has the column alone', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO boss (name) VALUES ('Aegis')").run();
    db.prepare("INSERT INTO titan_reaver_default (position, boss, updated_at) VALUES (1, 'Aegis', '2026-01-01 00:00:00')").run();
    migration(db);
    expect(db.prepare('SELECT updated_at FROM titan_reaver_default').pluck().get()).toBe('2026-01-01 00:00:00');
  });
});
