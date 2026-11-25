import type { Migration } from './index.js';

/**
 * 39 -> 40: the standing the Advisor gives a community idea by its status (#325), one row at most (`id = 1`): Proven, no status and
 * Experimental, each a number from 0 to 1 that ranks an idea beside the Wilson lower bound of a record. With no row the defaults of
 * `src/advisor/domain/known.ts` apply. It is configuration, not a record, and the public edition has no ideas, so it has no table.
 */
export const migration: Migration = (db) => {
  void db;
};
