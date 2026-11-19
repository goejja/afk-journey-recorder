import type { Migration } from './index.js';

/**
 * 25 -> 26: the feature vector of each Rank Look picture, kept so that the rank reader's reviews do not decode every picture again
 * each time the server starts. It is derived data, rebuilt from the picture whenever a row is missing or stale: `version` is the
 * extractor's `FEATURES_VERSION`, `size` and `mtime` are those of the picture file when the vector was made. The migration only
 * creates the table; the vectors are filled the first time they are read.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE rank_look_feature (
      look_id INTEGER PRIMARY KEY REFERENCES rank_look(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      size    INTEGER NOT NULL,
      mtime   REAL    NOT NULL,
      vector  BLOB    NOT NULL
    );
  `);
};
