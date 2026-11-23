import type { Migration } from './index.js';

/**
 * 32 -> 33: the setup of the current Titan Reaver event (#277), edited in Admin > Weekly default. `titan_reaver_default` holds its six
 * boss slots: `position` 1 to 6 is Charge boss 1 and 2, Clash boss 1 and 2, Conquer boss 1 and 2. A slot with no boss is not stored,
 * and the same boss cannot be in two slots (a deleted boss leaves its slot empty). It is the event of the current Season Phase, so it
 * says nothing else about itself. It is a convenience for the record form, never a record or evidence, and a Save replaces it whole.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS titan_reaver_default (
      position   INTEGER PRIMARY KEY CHECK (position BETWEEN 1 AND 6),
      boss       TEXT UNIQUE REFERENCES boss (name) ON UPDATE CASCADE ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};
