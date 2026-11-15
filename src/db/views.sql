-- Views: derived data, nothing is stored. They are dropped and created again each time the database opens, so a change to one
-- needs no migration. They read the tables of schema.sql and of the migrations.

-- One row per side of every attempt, oriented to that side: won is that side's own result. Side A is the
-- player's formation in every mode; Side B exists only in PvP battles, with the result flipped. mode is the
-- PvP mode where there is one (Arena, Supreme Arena, Super League, Guild Duel, Treasure Rush), else the attempt's mode. Derived data:
DROP VIEW IF EXISTS v_side;
CREATE VIEW v_side AS
  SELECT a.id AS attempt_id, COALESCE(r.mode, a.mode) AS mode, COALESCE(r.map_name, d.map_name) AS map_name,
         COALESCE(r.rule, d.boss_rule) AS rule, 'A' AS side, (a.outcome = 'Win') AS won, f.artifact AS artifact, a.created_at AS created_at
  FROM attempt a
  JOIN formation f ON f.attempt_id = a.id
  LEFT JOIN arena_attempt r ON r.attempt_id = a.id
  LEFT JOIN dream_hunt_attempt d ON d.attempt_id = a.id
  UNION ALL
  SELECT a.id, r.mode, r.map_name, r.rule, 'B', (a.outcome = 'Loss'), r.opp_artifact, a.created_at
  FROM attempt a
  JOIN arena_attempt r ON r.attempt_id = a.id;

-- The heroes of each side in v_side, one row per hero however many tiles its units take, with the rank and
-- equipment they had in that battle (snapshots, ADR 0001). Summons have no rank, so max() keeps the hero's own.
-- The tile is the hero's own body (the row with no part), never one of its summons (ADR 0028); a Pair Hero, whose
-- rows are both parts, keeps the lower of the two.
DROP VIEW IF EXISTS v_side_hero;
CREATE VIEW v_side_hero AS
  SELECT f.attempt_id AS attempt_id, 'A' AS side, COALESCE(min(CASE WHEN fh.part = '' THEN fh.tile END), min(fh.tile)) AS tile,
         fh.hero_name AS hero, max(fh.rank) AS rank, max(fh.equipment_level) AS equipment_level
  FROM formation f JOIN formation_hero fh ON fh.formation_id = f.id
  GROUP BY f.attempt_id, fh.hero_name
  UNION ALL
  SELECT attempt_id, 'B', COALESCE(min(CASE WHEN part = '' THEN tile END), min(tile)), hero_name, max(rank), max(equipment_level)
  FROM arena_opponent_hero GROUP BY attempt_id, hero_name;

DROP VIEW IF EXISTS v_import_accuracy;
CREATE VIEW v_import_accuracy AS
  SELECT source, screen, field, count(*) AS readings, sum(read_value IS final_value) AS agreed, round(100.0 * sum(read_value IS final_value) / count(*), 1) AS agreed_percent
  FROM import_reading GROUP BY source, screen, field;

DROP VIEW IF EXISTS v_import_skip_rate;
CREATE VIEW v_import_skip_rate AS
  SELECT screen, fresh, count(*) AS pictures, sum(agent_called) AS agent_calls,
         sum(strips_known) AS strips_known, sum(strips_total) AS strips_total, round(100.0 * sum(strips_known) / sum(strips_total), 1) AS strips_known_percent,
         sum(tiles_sent) AS tiles_sent, sum(tiles_total) AS tiles_total, round(100.0 * sum(tiles_sent) / sum(tiles_total), 1) AS tiles_sent_percent
  FROM import_run GROUP BY screen, fresh;
