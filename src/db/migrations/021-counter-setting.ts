import type { Migration } from './index.js';

/**
 * 20 -> 21: the rule that decides when a Formation group counts as a counter of another (ADR 0039): the least win rate and the least
 * games of its head-to-head record. One row at most; with no row the defaults of `src/domain/stats.ts` apply. It is configuration, not a
 * record, and it is kept apart from `stats_setting` so that resetting the modes the Statistics page starts with leaves it alone.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE counter_setting (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      min_win_rate REAL    NOT NULL CHECK (min_win_rate >= 0.5 AND min_win_rate <= 1),
      min_games    INTEGER NOT NULL CHECK (min_games >= 1 AND min_games <= 50)
    );
  `);
};
