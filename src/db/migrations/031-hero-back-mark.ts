import type { Migration } from './index.js';

/**
 * 30 -> 31: the player's own mark on a hero for the placement check of ranged damage dealers (#221). `stands_back` is 1 for a hero the
 * check always expects at the back and 0 for one it never checks; a hero with no row is checked by its range and Role. Like the PVP
 * Tier hint and the unit info it names heroes, not rows, so it carries no foreign key, and editing it never makes the hero the player's
 * own. It is the player's judgement, in no score or sample size.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE hero_back_mark (
      hero        TEXT PRIMARY KEY,
      stands_back INTEGER NOT NULL CHECK (stands_back IN (0, 1)),
      set_on      TEXT NOT NULL
    );
  `);
};
