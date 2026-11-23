import type { Migration } from './index.js';

/**
 * 35 -> 36: `hero.hand_made` and `boss.hand_made` mark a row the player made in Admin (a stand-in for a hero or boss the importer's
 * source does not list yet, #297). The importer takes such a row over when the source lists its name. A row an import made and the
 * player then edited is not hand-made, so it stays protected. Existing `manual` rows with no `image_path` were made by hand (an
 * imported row has a path, and an edit leaves it), so they are marked.
 */
export const migration: Migration = (db) => {
  db.exec(`
    ALTER TABLE hero ADD COLUMN hand_made INTEGER NOT NULL DEFAULT 0 CHECK (hand_made IN (0, 1));
    ALTER TABLE boss ADD COLUMN hand_made INTEGER NOT NULL DEFAULT 0 CHECK (hand_made IN (0, 1));
    UPDATE hero SET hand_made = 1 WHERE source = 'manual' AND image_path IS NULL;
    UPDATE boss SET hand_made = 1 WHERE source = 'manual' AND image_path IS NULL;
  `);
};
