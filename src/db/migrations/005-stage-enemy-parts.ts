import type { Migration } from './index.js';

/**
 * 4 -> 5: a stage's enemy hero can be a part of a Pair Hero or a Summon, as every other placed Unit can (ADR 0028).
 */
export const migration: Migration = (db) => {
  db.exec("ALTER TABLE stage_enemy ADD COLUMN part TEXT NOT NULL DEFAULT ''");
};
