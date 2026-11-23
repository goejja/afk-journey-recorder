import type { Migration } from './index.js';

/**
 * 33 -> 34: Titan Reaver records (#278), kept apart from `attempt` since a Titan Reaver fight has no win or loss and no reader of the
 * attempts (Statistics, the Win Score, Scenarios, the query CLI, the cleanup of old records) must count it.
 * A Battle (`titan_reaver_battle`) is exactly two fights (`titan_reaver_fight`, `position` 1 and 2), each with the heroes it placed
 * (`titan_reaver_hero`, as `formation_hero`). The Battle names the Season it was played in (never changed, ADR 0038), the Season Phase
 * (which Titan Reaver event) and the Titan Reaver Phase, one level for both teams, a note and one Formation ID for the whole Battle.
 * `damage` is a whole number. The map is always the Open map and is not stored. Tags are on the Battle.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS titan_reaver_battle (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      season       INTEGER NOT NULL CHECK (season >= 1),
      season_phase INTEGER NOT NULL CHECK (season_phase BETWEEN 1 AND 3),
      titan_phase  TEXT NOT NULL CHECK (titan_phase IN ('Charge', 'Clash', 'Conquer')),
      level        INTEGER NOT NULL CHECK (level >= 1),
      note         TEXT,
      formation_id TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS titan_reaver_fight (
      battle_id              INTEGER NOT NULL REFERENCES titan_reaver_battle (id) ON DELETE CASCADE,
      position               INTEGER NOT NULL CHECK (position IN (1, 2)),
      boss_name              TEXT NOT NULL REFERENCES boss (name) ON UPDATE CASCADE,
      damage                 INTEGER NOT NULL CHECK (damage >= 0),
      artifact               TEXT REFERENCES artifact (name) ON UPDATE CASCADE,
      phantimal_name         TEXT REFERENCES phantimal (name) ON UPDATE CASCADE,
      phantimal_tile         INTEGER,
      phantimal_partner_tile INTEGER,
      PRIMARY KEY (battle_id, position)
    );
    CREATE TABLE IF NOT EXISTS titan_reaver_hero (
      battle_id       INTEGER NOT NULL,
      position        INTEGER NOT NULL,
      tile            INTEGER NOT NULL,
      hero_name       TEXT NOT NULL REFERENCES hero (name),
      part            TEXT NOT NULL DEFAULT '',
      rank            TEXT,
      equipment_level INTEGER,
      PRIMARY KEY (battle_id, position, tile),
      FOREIGN KEY (battle_id, position) REFERENCES titan_reaver_fight (battle_id, position) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS titan_reaver_tag (
      battle_id INTEGER NOT NULL REFERENCES titan_reaver_battle (id) ON DELETE CASCADE,
      tag       TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (battle_id, tag)
    );
    CREATE INDEX IF NOT EXISTS titan_reaver_tag_by_tag ON titan_reaver_tag (tag);
  `);
};
