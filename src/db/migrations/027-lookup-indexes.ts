import type { Migration } from './index.js';

/**
 * 26 -> 27: indexes on the columns other tables are looked up or cascaded by, which had none, so that deleting an attempt, deleting or
 * renaming a Formation ID, and counting the records of a code no longer scan whole tables. The columns that are usually empty
 * (Formation IDs, the tournament of a battle) have partial indexes that hold only the rows that name something.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE INDEX formation_by_attempt ON formation (attempt_id);
    CREATE INDEX formation_by_formation_id ON formation (formation_id) WHERE formation_id IS NOT NULL;
    CREATE INDEX arena_attempt_by_opp_formation_id ON arena_attempt (opp_formation_id) WHERE opp_formation_id IS NOT NULL;
    CREATE INDEX battle_by_formation_id ON battle (formation_id) WHERE formation_id IS NOT NULL;
    CREATE INDEX battle_by_opp_formation_id ON battle (opp_formation_id) WHERE opp_formation_id IS NOT NULL;
    CREATE INDEX battle_by_tournament ON battle (tournament_id) WHERE tournament_id IS NOT NULL;
    CREATE INDEX stage_attempt_by_stage ON stage_attempt (stage_id);
    CREATE INDEX round_deployment_by_profile ON round_deployment (profile_id);
  `);
};
