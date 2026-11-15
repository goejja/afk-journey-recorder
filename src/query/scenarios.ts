import type Database from 'better-sqlite3';
import { MAX_ROWS } from './filters.js';
import { profileIdOf } from './overview.js';

/** The planning scenarios, newest first, with whether each already has an estimate. */
export function scenarios(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, name, mode, note, estimate IS NOT NULL AS hasEstimate, estimate_at AS estimateAt, updated_at AS updatedAt
       FROM scenario ORDER BY id DESC LIMIT ${MAX_ROWS}`,
    )
    .all();
}

/**
 * One scenario to answer. Your heroes carry their current roster rank and equipment. `pinned` heroes are the
 * ones you placed (keep them); the other roster heroes are free to propose, each hero on at most one team.
 */
export function scenario(db: Database.Database, id: number, profile?: string | number) {
  const profileId = profileIdOf(db, profile);
  const row = db
    .prepare('SELECT id, name, mode, note, estimate, estimate_at AS estimateAt, updated_at AS updatedAt FROM scenario WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const pinnedOf = db.prepare(
    `SELECT h.tile, h.hero_name AS name, h.part, r.rank, r.equipment_level AS equipment FROM scenario_hero h
     LEFT JOIN roster r ON r.hero_name = h.hero_name AND r.profile_id = ? WHERE h.scenario_id = ? AND h.position = ? AND h.side = 'mine' ORDER BY h.tile`,
  );
  const enemyOf = db.prepare(
    `SELECT tile, hero_name AS name, part, rank, equipment_level AS equipment FROM scenario_hero
     WHERE scenario_id = ? AND position = ? AND side = 'enemy' ORDER BY tile`,
  );
  const cellsOf = db.prepare('SELECT cells FROM map WHERE name = ?').pluck();
  const slots = (db.prepare('SELECT position, map_name AS map, rule FROM scenario_slot WHERE scenario_id = ? ORDER BY position').all(id) as {
    position: number;
    map: string;
  }[]).map((s) => ({
    ...s,
    pinned: pinnedOf.all(profileId, id, s.position),
    enemy: enemyOf.all(id, s.position),
    playerTiles: (JSON.parse(cellsOf.get(s.map) as string) as number[])
      .map((cell, tile) => (cell === 1 ? tile : -1))
      .filter((tile) => tile >= 0),
  }));
  const taken = new Set(slots.flatMap((s) => s.pinned.map((h) => (h as { name: string }).name)));
  const free = (
    db
      .prepare(
        `SELECT r.hero_name AS name, h.class, h.faction, h.tier, r.rank, r.equipment_level AS equipment
         FROM roster r JOIN hero h ON h.name = r.hero_name WHERE r.profile_id = ? ORDER BY h.tier, r.hero_name`,
      )
      .all(profileId) as { name: string }[]
  ).filter((h) => !taken.has(h.name));
  return {
    ...row,
    slots,
    freeRosterHeroes: free,
  };
}
