import type { Migration } from './index.js';

/**
 * 28 -> 29: the readings of a Battle import that the hero reader could not learn from by itself, parked for the player to confirm in
 * Admin > Reader (ADR 0040), and a `review` source for the Hero Examples the player confirms there.
 *
 * A parked reading is one tile of a saved import. A `difference` is a tile the player's heroes did not match and that could not be paired
 * with one of them; an `unsure` one is a tile the Agent was not sure of. `candidates` is a JSON array of hero names. The picture is the file
 * images/custom/parked-reading/<file>; `vector` is its hero feature vector as a Float32 BLOB and `version` the extractor's version, kept
 * so that a new crop is compared with the parked ones without decoding them again. A row is not derived data: a backup keeps it.
 *
 * `hero_example.source` cannot change its CHECK, so the table is rebuilt (the runner switches foreign keys off for this version, and
 * `hero_example_feature` points at it).
 */
export const migration: Migration = (db) => {
  // a file whose version was set by hand, as some tests do, may not have the column migration 2 adds
  const source = db.prepare("SELECT count(*) FROM pragma_table_info('hero_example') WHERE name = 'source'").pluck().get() ? 'source' : 'NULL';
  db.exec(`
    CREATE TABLE parked_reading (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('difference', 'unsure')),
      side       TEXT NOT NULL CHECK (side IN ('A', 'B')),
      mode       TEXT,
      read_hero  TEXT,
      kept_hero  TEXT,
      candidates TEXT NOT NULL DEFAULT '[]',
      file       TEXT NOT NULL UNIQUE,
      version    INTEGER NOT NULL,
      vector     BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE hero_example_new (
      id         INTEGER PRIMARY KEY,
      hero_name  TEXT NOT NULL REFERENCES hero (name),
      file       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      source     TEXT CHECK (source IN ('roster', 'battle', 'offline', 'review'))
    );
    INSERT INTO hero_example_new (id, hero_name, file, created_at, source) SELECT id, hero_name, file, created_at, ${source} FROM hero_example;
    DROP TABLE hero_example;
    ALTER TABLE hero_example_new RENAME TO hero_example;
  `);
};
