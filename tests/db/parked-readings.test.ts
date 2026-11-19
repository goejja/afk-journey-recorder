import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { migration } from '../../src/db/migrations/029-parked-readings.js';

describe('parked readings (migration 29)', () => {
  it('gives a new database the table of parked readings and a review source for hero examples', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO hero (name) VALUES ('Evie')").run();
    db.prepare("INSERT INTO hero_example (hero_name, file, source) VALUES ('Evie', 'a.png', 'review')").run();
    expect(() => db.prepare("INSERT INTO hero_example (hero_name, file, source) VALUES ('Evie', 'b.png', 'elsewhere')").run()).toThrow();
    db.prepare("INSERT INTO parked_reading (kind, side, read_hero, candidates, file, version, vector) VALUES ('difference', 'A', 'Zed', '[\"Fay\"]', '1.png', 1, ?)").run(Buffer.alloc(4));
    expect(() => db.prepare("INSERT INTO parked_reading (kind, side, file, version, vector) VALUES ('other', 'A', '2.png', 1, ?)").run(Buffer.alloc(4))).toThrow();
    expect(() => db.prepare("INSERT INTO parked_reading (kind, side, file, version, vector) VALUES ('unsure', 'C', '3.png', 1, ?)").run(Buffer.alloc(4))).toThrow();
    db.close();
  });

  it('keeps the hero examples and their stored features when it rebuilds the table', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));
    db.exec("ALTER TABLE hero_example ADD COLUMN source TEXT CHECK (source IN ('roster', 'battle', 'offline'))");
    db.exec('CREATE TABLE hero_example_feature (look_id INTEGER PRIMARY KEY REFERENCES hero_example(id) ON DELETE CASCADE, version INTEGER NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, vector BLOB NOT NULL)');
    db.prepare("INSERT INTO hero (name) VALUES ('Evie')").run();
    db.prepare("INSERT INTO hero_example (id, hero_name, file, source) VALUES (7, 'Evie', '7.png', 'battle'), (8, 'Evie', '8.png', NULL)").run();
    db.prepare('INSERT INTO hero_example_feature (look_id, version, size, mtime, vector) VALUES (7, 1, 10, 1.5, ?)').run(Buffer.alloc(4));
    db.pragma('foreign_keys = OFF'); // as the runner does for this version
    migration(db);
    db.pragma('foreign_keys = ON');
    expect(db.prepare('SELECT id, hero_name, file, source FROM hero_example ORDER BY id').all()).toEqual([
      { id: 7, hero_name: 'Evie', file: '7.png', source: 'battle' },
      { id: 8, hero_name: 'Evie', file: '8.png', source: null },
    ]);
    expect(db.prepare('SELECT look_id FROM hero_example_feature').pluck().all()).toEqual([7]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    // a deleted example still takes its stored features with it
    db.prepare('DELETE FROM hero_example WHERE id = 7').run();
    expect(db.prepare('SELECT count(*) FROM hero_example_feature').pluck().get()).toBe(0);
  });
});
