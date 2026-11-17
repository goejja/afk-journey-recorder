import type Database from 'better-sqlite3';

/** The tier of the starting heroes (Chippy and Hammie): every player has them from the start, at the lowest rank. */
export const STARTING_TIER = 'R';

/**
 * Puts every starting hero on the roster of a profile (of every profile when none is given) that does not have it yet, at the lowest
 * rank and with no equipment. A row that exists is left as it is.
 */
export function ensureStartingHeroes(db: Database.Database, profileId?: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO roster (profile_id, hero_name, rank, equipment_level)
     SELECT p.id, h.name, (SELECT name FROM rank ORDER BY position LIMIT 1), NULL
     FROM profile p CROSS JOIN hero h
     WHERE h.tier = ? AND (? IS NULL OR p.id = ?)`,
  ).run(STARTING_TIER, profileId ?? null, profileId ?? null);
}

/** Whether a hero is a starting hero, which no roster can be without. */
export const isStartingHero = (db: Database.Database, name: string): boolean =>
  db.prepare('SELECT 1 FROM hero WHERE name = ? AND tier = ?').get(name, STARTING_TIER) !== undefined;
