import type { Migration } from './index.js';

/**
 * 10 -> 11: a stage keeps its enemies as counts, not positions (ADR 0034). Rows of the same enemy or hero fold into one with a
 * count; a hero with several Units counts once, and the tile and part are dropped.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE stage_enemy_new (
      stage_id   INTEGER NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
      enemy_name TEXT REFERENCES enemy (name) ON UPDATE CASCADE,
      hero_name  TEXT REFERENCES hero (name) ON UPDATE CASCADE,
      count      INTEGER NOT NULL CHECK (count >= 1),
      CHECK ((enemy_name IS NULL) <> (hero_name IS NULL))
    );
    INSERT INTO stage_enemy_new (stage_id, enemy_name, hero_name, count)
      SELECT stage_id, enemy_name, NULL, count(*) FROM stage_enemy WHERE enemy_name IS NOT NULL GROUP BY stage_id, enemy_name;
    INSERT INTO stage_enemy_new (stage_id, enemy_name, hero_name, count)
      SELECT stage_id, NULL, hero_name,
             CASE WHEN sum(part = '') > 0 THEN sum(part = '') ELSE (SELECT max(n) FROM (SELECT count(*) AS n FROM stage_enemy x WHERE x.stage_id = s.stage_id AND x.hero_name = s.hero_name GROUP BY x.part)) END
      FROM stage_enemy s WHERE hero_name IS NOT NULL GROUP BY stage_id, hero_name;
    DROP TABLE stage_enemy;
    ALTER TABLE stage_enemy_new RENAME TO stage_enemy;
    CREATE UNIQUE INDEX stage_enemy_once ON stage_enemy (stage_id, ifnull(enemy_name, ''), ifnull(hero_name, ''));
  `);
};
