import type { Migration } from './index.js';

/**
 * 22 -> 23: a Placement Rule can name one more place, `adjacentFrontmost` (the frontmost unit next to the hero: Hepler, ADR 0036, task #40). The CHECK of the table changes, so it is rebuilt with its rules kept.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE placement_rule_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      hero       TEXT NOT NULL,
      relation   TEXT NOT NULL CHECK (relation IN ('behind', 'mirror', 'rearmost', 'sameRow', 'farthest', 'front', 'frontmost', 'daimon', 'adjacentRearmost', 'behindOrNearest', 'adjacentFrontmost')),
      effect     TEXT NOT NULL CHECK (effect IN ('protects', 'boosts', 'other')),
      wants_role TEXT CHECK (wants_role IN ('Damage dealer', 'Specialist', 'Support', 'Tank')),
      note       TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL CHECK (source IN ('manual')),
      enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      UNIQUE (hero, relation)
    );
    INSERT INTO placement_rule_new (id, hero, relation, effect, wants_role, note, source, enabled)
      SELECT id, hero, relation, effect, wants_role, note, source, enabled FROM placement_rule;
    DROP TABLE placement_rule;
    ALTER TABLE placement_rule_new RENAME TO placement_rule;
  `);
};
