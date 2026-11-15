import type { Migration } from './index.js';

/**
 * 15 -> 16: the pilot Placement Rules are removed (their relations assumed horizontal rows, ADR 0036) and the table accepts `sameRow`.
 * Migration 15 is kept as it ran; a table cannot change its CHECK, so it is rebuilt.
 */
export const migration: Migration = (db) => {
  db.exec(`
    DROP TABLE placement_rule;
    CREATE TABLE placement_rule (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      hero       TEXT NOT NULL,
      relation   TEXT NOT NULL CHECK (relation IN ('behind', 'mirror', 'rearmost', 'sameRow')),
      effect     TEXT NOT NULL CHECK (effect IN ('protects', 'boosts', 'other')),
      wants_role TEXT CHECK (wants_role IN ('Damage dealer', 'Specialist', 'Support', 'Tank')),
      note       TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL CHECK (source IN ('manual')),
      enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      UNIQUE (hero, relation)
    );
  `);
};
