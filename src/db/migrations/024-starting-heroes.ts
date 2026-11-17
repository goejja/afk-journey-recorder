import { ensureStartingHeroes } from '../starting-heroes.js';
import type { Migration } from './index.js';

/**
 * 23 -> 24: the starting heroes (the R tier heroes, Chippy and Hammie) are on every profile's roster from now on: add them where
 * they are missing, and leave a row that exists as it is. No table changes; the app keeps the rule afterwards.
 */
export const migration: Migration = (db) => {
  ensureStartingHeroes(db);
};
