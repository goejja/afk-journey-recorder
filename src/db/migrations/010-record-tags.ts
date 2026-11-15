import type { Migration } from './index.js';

/**
 * 9 -> 10: a tag belongs to the whole record; the tags the baseline allowed on one side of a battle are deleted, because the
 * Player ID says whose side it was (ADR 0033). The table is rebuilt without its `side` column.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE attempt_tag_new (
      attempt_id INTEGER NOT NULL REFERENCES attempt (id) ON DELETE CASCADE,
      tag        TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (attempt_id, tag)
    );
    INSERT OR IGNORE INTO attempt_tag_new (attempt_id, tag) SELECT attempt_id, tag FROM attempt_tag WHERE side = '';
    DROP TABLE attempt_tag;
    ALTER TABLE attempt_tag_new RENAME TO attempt_tag;
    CREATE INDEX attempt_tag_by_tag ON attempt_tag (tag);
  `);
};
