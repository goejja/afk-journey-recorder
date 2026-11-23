import type { Migration } from './index.js';

/**
 * 34 -> 35: the current Season Phase is stored (#284). `season.phase` (1 to 3) is the Season Phase the Season is at: Stages and the
 * Titan Reaver form open on it, and a stage attempt or a Titan Reaver Battle of the Season raises it, never lowers it. Each existing
 * Season starts on the highest Phase of its cleared stages (a stage row of that Season that has an attempt) and of its Titan Reaver Battles, by the rule Stages
 * show them under: an Apex stage by its own Phase, a Normal stage by its number in blocks of 300, a Phantisomal one in blocks of 600, at most 3.
 */
export const migration: Migration = (db) => {
  db.exec(`
    ALTER TABLE season ADD COLUMN phase INTEGER NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 3);
    UPDATE season SET phase = MAX(
      COALESCE((
        SELECT MAX(MIN(3, MAX(1, CASE
                 WHEN s.kind LIKE 'Apex%' THEN s.phase
                 WHEN s.kind = 'Normal' THEN (s.number + 299) / 300
                 ELSE (s.number + 599) / 600 END)))
        FROM stage s
        WHERE s.season = season.number AND EXISTS (SELECT 1 FROM stage_attempt sa WHERE sa.stage_id = s.id)), 1),
      COALESCE((SELECT MAX(b.season_phase) FROM titan_reaver_battle b WHERE b.season = season.number), 1));
  `);
};
