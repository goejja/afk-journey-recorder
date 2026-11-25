import type { Migration } from './index.js';

/**
 * 38 -> 39: formation ideas (#324), the formations the community shares, kept apart from every record. An idea (`idea`) has a mode,
 * a title, where it came from, an optional status (Experimental or Proven) and, when the source gave one, the Formation ID of the whole
 * battle. Its teams (`idea_team`, `position` 1 to 5) each have a map, an artifact and a Phantimal, and the heroes they place
 * (`idea_hero`, as `formation_hero`) carry no rank or equipment. Nothing here is an attempt: no Statistics, Win Score or sample size reads
 * these tables. They are outside evidence, so the public edition has none (ADR 0043).
 */
export const migration: Migration = (db) => {
  void db; // this edition has no ideas
};
