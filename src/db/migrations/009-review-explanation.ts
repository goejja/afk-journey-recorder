import type { Migration } from './index.js';

/**
 * 8 -> 9: the Agent's explanation of a run is kept on the run, with the time it was written (ADR 0032).
 */
export const migration: Migration = (db) => {
  db.exec('ALTER TABLE review_run ADD COLUMN explanation TEXT');
  db.exec('ALTER TABLE review_run ADD COLUMN explained_at TEXT');
};
