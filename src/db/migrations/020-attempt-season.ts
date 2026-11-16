import type { Migration } from './index.js';

/**
 * 19 -> 20: every record says the season it was played in (`attempt.season`, ADR 0038), the same for Stage, Dream Hunt and PvP records
 * and apart from a stage's own season. Every record made so far was played in season 8; a fight in a Battle of a Tournament takes the
 * Tournament's season, which is also 8 today. The column has a default only because SQLite needs one to add it: the server always
 * names the season when it saves a record.
 */
export const migration: Migration = (db) => {
  db.exec(`
    ALTER TABLE attempt ADD COLUMN season INTEGER NOT NULL DEFAULT 8 CHECK (season >= 1);
    UPDATE attempt SET season = (SELECT t.season FROM battle b JOIN tournament t ON t.id = b.tournament_id WHERE b.id = attempt.battle_id)
      WHERE battle_id IN (SELECT id FROM battle WHERE tournament_id IS NOT NULL);
    CREATE INDEX attempt_season ON attempt (season);
  `);
};
