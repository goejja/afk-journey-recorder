import type { Migration } from './index.js';

/**
 * 16 -> 17: a Super League Tournament has Semi-Finals between the Top 16 and the Finals. The Rounds are in the CHECK of two tables, which
 * SQLite can only change by rebuilding them; `battle` is pointed at by `attempt`, so this migration runs with foreign keys off (see
 * REBUILDS_TABLES) and the views, which read `battle`, are dropped first (they are made again each time the database opens).
 */
export const migration: Migration = (db) => {
  const rounds = "'Group stage', 'Swiss stage', 'Top 48', 'Top 16', 'Semi-Finals', 'Finals'";
  db.exec(`
    DROP VIEW IF EXISTS v_side;
    DROP VIEW IF EXISTS v_side_hero;
    DROP VIEW IF EXISTS v_import_accuracy;
    DROP VIEW IF EXISTS v_import_skip_rate;

    CREATE TABLE round_deployment_new (
      tournament_id INTEGER NOT NULL REFERENCES tournament (id) ON DELETE CASCADE,
      round         TEXT NOT NULL CHECK (round IN (${rounds})),
      profile_id    INTEGER NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      team          INTEGER NOT NULL CHECK (team BETWEEN 1 AND 5),
      content       TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tournament_id, round, profile_id, team)
    );
    INSERT INTO round_deployment_new (tournament_id, round, profile_id, team, content, updated_at)
      SELECT tournament_id, round, profile_id, team, content, updated_at FROM round_deployment;
    DROP TABLE round_deployment;
    ALTER TABLE round_deployment_new RENAME TO round_deployment;

    CREATE TABLE battle_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      mode             TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      formation_id     TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE,
      opp_formation_id TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE,
      tournament_id    INTEGER REFERENCES tournament (id) ON DELETE RESTRICT,
      round            TEXT CHECK (round IN (${rounds}))
    );
    INSERT INTO battle_new (id, mode, created_at, formation_id, opp_formation_id, tournament_id, round)
      SELECT id, mode, created_at, formation_id, opp_formation_id, tournament_id, round FROM battle;
    DROP TABLE battle;
    ALTER TABLE battle_new RENAME TO battle;
  `);
};
