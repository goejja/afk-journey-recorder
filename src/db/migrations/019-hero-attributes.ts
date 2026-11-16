import type { Migration } from './index.js';

/**
 * 18 -> 19: a hero's range, energy and mechanic tags (the unit info) become a table of the hero admin's own, `hero_attribute`
 * (ADR 0037), kept apart from `hero` like the PVP Tier hint so that editing them never makes the hero the player's own. Each row
 * says where its values came from: `external` for values copied from an outside source, `manual` once the player edited them.
 * Like the unit tables it names heroes, not rows, and carries no foreign key. Mechanic tags are kept as a flat JSON list of names.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE hero_attribute (
      hero            TEXT PRIMARY KEY,
      range           INTEGER CHECK (range >= 0),
      energy          TEXT NOT NULL DEFAULT '[]',
      mechanics       TEXT NOT NULL DEFAULT '[]',
      released_season INTEGER CHECK (released_season >= 0),
      set_on          TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'external' CHECK (source IN ('external', 'manual'))
    );
  `);
  // This edition has no outside source to copy from.
};
