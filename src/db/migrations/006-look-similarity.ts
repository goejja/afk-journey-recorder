import type { Migration } from './index.js';

/**
 * 5 -> 6: how alike two learnt pictures must be for Thinning to treat them as one look, one row per kind of picture (ADR 0031).
 */
export const migration: Migration = (db) => {
  db.exec('CREATE TABLE thinning_setting (kind TEXT PRIMARY KEY, distance REAL NOT NULL)');
};
