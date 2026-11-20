import type Database from 'better-sqlite3';

/**
 * Takes away what migrations 26 and later made, so that a test which sets `user_version` back below 26 and opens the database again
 * can run those migrations again. Add what a new migration creates here.
 */
export function dropObjectsOfMigrationsFrom26(db: Database.Database): void {
  db.exec(`
    DROP TABLE rank_look_feature;
    DROP TABLE hero_example_feature;
    DROP TABLE hero_look_feature;
    DROP TABLE unit_look_feature;
    DROP TABLE parked_reading;
    DROP TABLE hero_back_mark;
    ALTER TABLE map DROP COLUMN boost_tiles;
    DROP INDEX formation_by_attempt;
    DROP INDEX formation_by_formation_id;
    DROP INDEX arena_attempt_by_opp_formation_id;
    DROP INDEX battle_by_formation_id;
    DROP INDEX battle_by_opp_formation_id;
    DROP INDEX battle_by_tournament;
    DROP INDEX stage_attempt_by_stage;
    DROP INDEX round_deployment_by_profile;
  `);
}
