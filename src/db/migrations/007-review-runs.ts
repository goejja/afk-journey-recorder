import type { Migration } from './index.js';

/**
 * 6 -> 7: the Reader review keeps its runs: the findings of each, as JSON, with its date (ADR 0032).
 */
export const migration: Migration = (db) => {
  db.exec("CREATE TABLE review_run (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), findings TEXT NOT NULL)");
};
