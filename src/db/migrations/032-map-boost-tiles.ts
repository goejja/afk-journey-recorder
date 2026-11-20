import type { Migration } from './index.js';

/**
 * 31 -> 32: a map can mark some of its deployment tiles as Boost tiles (#220). `boost_tiles` is a JSON list of tile numbers, each a
 * player or enemy deployment tile of `cells`, empty for a map that has none. It is kept apart from `cells`, so what reads the tile
 * values is not changed, and apart from `original_cells`, since an imported map has no Boost tile of its own: marking one is the
 * player's own edit.
 */
export const migration: Migration = (db) => {
  db.exec(`ALTER TABLE map ADD COLUMN boost_tiles TEXT NOT NULL DEFAULT '[]'`);
};
