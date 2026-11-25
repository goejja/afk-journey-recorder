import type { Migration } from './index.js';

/**
 * 40 -> 41: an idea has no title (#349). It is known by its id, its source and its Formation ID, so `idea.title` is dropped and the titles
 * already saved are discarded. Like the rest of the ideas, the public edition has none.
 */
export const migration: Migration = (db) => {
  void db;
};
