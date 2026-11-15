import type { Migration } from './index.js';

/**
 * 1 -> 2: where a learned picture came from (ADR 0027); null for the ones saved before it was kept
 */
export const migration: Migration = (db) => {
  for (const table of ['hero_look', 'hero_example', 'rank_look', 'unit_look']) db.exec(`ALTER TABLE ${table} ADD COLUMN source TEXT CHECK (source IN ('roster', 'battle', 'offline'))`);
};
