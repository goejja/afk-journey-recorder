import type { Migration } from './index.js';

/**
 * 27 -> 28: the feature vector of each hero example, Hero Look and Unit Look picture, as migration 26 did for the Rank Looks, so that the
 * first import or Reader page after a start does not decode every picture again. It is derived data, rebuilt from the picture whenever a row
 * is missing or stale: `version` is the extractor's version, `size` and `mtime` are those of the picture file when the vector was made. Each
 * table points at its own looks and goes with them. The migration only creates the tables; the vectors are filled the first time they are read.
 */
export const migration: Migration = (db) => {
  for (const looks of ['hero_example', 'hero_look', 'unit_look']) {
    db.exec(`
      CREATE TABLE ${looks}_feature (
        look_id INTEGER PRIMARY KEY REFERENCES ${looks}(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        size    INTEGER NOT NULL,
        mtime   REAL    NOT NULL,
        vector  BLOB    NOT NULL
      );
    `);
  }
};
