import type { Migration } from './index.js';

/**
 * 41 -> 42: the season an idea is for (#353), which says which Phantimals its teams may bring (`phantimal_season`, ADR 0029) and shows as a badge.
 * It is nullable: the ideas already saved have no known season and stay blank. The public edition has no ideas.
 */
export const migration: Migration = (db) => {
  void db;
};
