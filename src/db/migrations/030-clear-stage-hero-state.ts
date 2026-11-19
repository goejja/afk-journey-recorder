import type { Migration } from './index.js';

/**
 * 29 -> 30: a Stage record keeps no hero state (ADR 0041). The rank and equipment of the heroes of a Stage attempt, and of its assist
 * hero, are set to NULL: a record is often entered days after the clear, when the roster has been upgraded since, so what it snapshotted
 * (ADR 0001) is not what the heroes had. Only attempts of mode `Stage` are touched; no column is dropped, because `formation` and
 * `formation_hero` are shared with the other modes.
 */
export const migration: Migration = (db) => {
  db.exec(`
    UPDATE formation_hero SET rank = NULL, equipment_level = NULL
    WHERE formation_id IN (SELECT f.id FROM formation f JOIN attempt a ON a.id = f.attempt_id WHERE a.mode = 'Stage');

    UPDATE formation SET assist_rank = NULL, assist_equipment_level = NULL
    WHERE attempt_id IN (SELECT id FROM attempt WHERE mode = 'Stage');
  `);
};
