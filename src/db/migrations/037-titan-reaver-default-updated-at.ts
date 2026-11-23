import type { Migration } from './index.js';

/**
 * 36 -> 37: `titan_reaver_default.updated_at` (#300). Migration 33 was edited after it was applied, so a database that ran its earlier
 * version has the table without this column. SQLite cannot add a column whose default is `datetime('now')`, so the table is rebuilt
 * with its rows (each stamped now). A database that already has the column is left alone.
 */
export const migration: Migration = (db) => {
  const columns = (db.prepare("SELECT name FROM pragma_table_info('titan_reaver_default')").pluck().all() as string[]);
  if (columns.includes('updated_at')) return;
  db.exec(`
    CREATE TABLE titan_reaver_default_new (
      position   INTEGER PRIMARY KEY CHECK (position BETWEEN 1 AND 6),
      boss       TEXT UNIQUE REFERENCES boss (name) ON UPDATE CASCADE ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO titan_reaver_default_new (position, boss) SELECT position, boss FROM titan_reaver_default;
    DROP TABLE titan_reaver_default;
    ALTER TABLE titan_reaver_default_new RENAME TO titan_reaver_default;
  `);
};
