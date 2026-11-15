import { PRYDWEN_NAMES, PRYDWEN_PVP, PRYDWEN_PVP_DATE } from '../pvp-hint-seed.js';
import type { Migration } from './index.js';

/**
 * 12 -> 13: the PVP Tier hint and role of a hero (ADR 0036), kept apart from `hero` so that editing a hint never makes the hero the
 * player's own. Like the unit tables it names heroes, not rows, and carries no foreign key. Seeded once from the Prydwen PVP tier
 * list of 2026-11-13; after that the player maintains it in Admin > Units.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE hero_pvp_hint (
      hero     TEXT PRIMARY KEY,
      pvp_tier TEXT CHECK (pvp_tier IN ('S+', 'S', 'A+', 'A', 'B', 'C', 'D')),
      pvp_role TEXT CHECK (pvp_role IN ('Damage dealer', 'Specialist', 'Support', 'Tank')),
      set_on   TEXT NOT NULL,
      source   TEXT NOT NULL DEFAULT 'prydwen' CHECK (source IN ('prydwen', 'manual'))
    );
  `);
  const insert = db.prepare("INSERT INTO hero_pvp_hint (hero, pvp_tier, pvp_role, set_on, source) VALUES (?, ?, ?, ?, 'prydwen')");
  for (const [tier, roles] of Object.entries(PRYDWEN_PVP)) {
    for (const [role, heroes] of Object.entries(roles)) {
      for (const hero of heroes) insert.run(PRYDWEN_NAMES[hero] ?? hero, tier, role, PRYDWEN_PVP_DATE);
    }
  }
};
