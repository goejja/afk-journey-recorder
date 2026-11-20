import type Database from 'better-sqlite3';
import { findProfile, listProfiles } from '../db/profiles.js';

/** Counts per mode and per tag, to see what history there is. */
export function summary(db: Database.Database) {
  return {
    records: db
      .prepare(
        `SELECT COALESCE(r.mode, a.mode) AS mode, count(*) AS records, sum(a.outcome = 'Win') AS wins, min(a.created_at) AS first, max(a.created_at) AS last
         FROM attempt a LEFT JOIN arena_attempt r ON r.attempt_id = a.id GROUP BY 1 ORDER BY 1`,
      )
      .all(),
    tags: db.prepare('SELECT tag, count(DISTINCT attempt_id) AS records FROM attempt_tag GROUP BY tag ORDER BY records DESC').all(),
  };
}

/** The id of the profile named (id or name), else the default one; an error for a name that matches none. */
export function profileIdOf(db: Database.Database, profile?: string | number): number {
  const found = findProfile(db, profile);
  if (!found) throw new Error(`Unknown profile "${profile}"`);
  return found.id;
}

/** The heroes a profile owns (the default profile unless told otherwise) with their current rank and equipment: what you can actually field. */
export function roster(db: Database.Database, profile?: string | number) {
  return db
    .prepare(
      `SELECT r.hero_name AS hero, h.class, h.faction, h.tier, r.rank, r.equipment_level AS equipment
       FROM roster r JOIN hero h ON h.name = r.hero_name WHERE r.profile_id = ? ORDER BY h.tier, r.hero_name`,
    )
    .all(profileIdOf(db, profile));
}

/** The profiles, with the default first. */
export function profiles(db: Database.Database) {
  return listProfiles(db).map(({ id: _id, ...profile }) => profile);
}
