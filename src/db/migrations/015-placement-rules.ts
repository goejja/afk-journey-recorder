import type { Migration } from './index.js';

/**
 * 14 -> 15: Placement Rules (ADR 0036): where a hero's skill puts its effect. Like the hints they name heroes, not rows, so they carry
 * no foreign key. The code that first ran this migration seeded a pilot of six heroes, which migration 16 removes again; the player edits the rules in Admin > Units, and a rule can be switched off.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE placement_rule (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      hero       TEXT NOT NULL,
      relation   TEXT NOT NULL CHECK (relation IN ('behind', 'mirror', 'rearmost')),
      effect     TEXT NOT NULL CHECK (effect IN ('protects', 'boosts', 'other')),
      wants_role TEXT CHECK (wants_role IN ('Damage dealer', 'Specialist', 'Support', 'Tank')),
      note       TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL CHECK (source IN ('manual')),
      enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      UNIQUE (hero, relation)
    );
  `);
};
