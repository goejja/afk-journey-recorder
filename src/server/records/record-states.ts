import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { validateHeroState, type HeroStateRules } from '../../domain/hero-state.js';
import { isSummon } from '../../domain/units.js';
import type { z } from 'zod';
import { recordStatesContract, StatesBody } from '../../shared/contracts/record-states.js';
import { hasId } from '../db-helpers.js';
import { fail, serve } from '../contract.js';

type StateInput = z.infer<typeof StatesBody>['heroes'][number];

/**
 * Routes that correct the rank and equipment a saved record stored for its heroes. A record keeps the state its heroes had
 * on the day (ADR 0001), so this is only for a record whose states were wrong, for example one cloned from an older fight
 * and not updated: the player then chooses to bring them to the roster's.
 */
export function recordStateRoutes(db: Database.Database, loadRules: () => HeroStateRules): Hono {
  const app = new Hono();

  // Sets the state of some heroes on one side of some records. A hero a record does not hold is left out of it.
  serve(app, recordStatesContract.setHeroStates, ({ body: { attemptIds: ids, side, heroes } }) => {
    const rules = loadRules();
    const states: StateInput[] = [];
    for (const h of heroes) {
      const state = { rank: h.rank, equipmentLevel: h.equipmentLevel };
      const error = validateHeroState(state, rules);
      if (error) return fail(400, `${h.hero}: ${error}`);
      states.push({ hero: h.hero, ...state });
    }
    const missing = ids.filter((id) => !hasId(db, 'attempt', id));
    if (missing.length > 0) return fail(404, `Unknown record ${missing[0]}`);

    const stateOf = new Map(states.map((s) => [s.hero, s]));
    let corrected = 0;
    db.transaction(() => {
      for (const id of ids) {
        // Side A is the formation, Side B the opponent of an Arena-type fight; the assist hero sits on the record itself.
        const rows =
          side === 'A'
            ? (db
                .prepare('SELECT fh.tile, fh.hero_name AS hero, fh.part FROM formation_hero fh JOIN formation f ON f.id = fh.formation_id WHERE f.attempt_id = ?')
                .all(id) as { tile: number; hero: string; part: string }[])
            : (db.prepare('SELECT tile, hero_name AS hero, part FROM arena_opponent_hero WHERE attempt_id = ?').all(id) as { tile: number; hero: string; part: string }[]);
        for (const row of rows) {
          const state = stateOf.get(row.hero);
          if (!state || isSummon({ hero: row.hero, part: row.part })) continue; // a summon has no rank or equipment
          const result =
            side === 'A'
              ? db
                  .prepare('UPDATE formation_hero SET rank = ?, equipment_level = ? WHERE tile = ? AND formation_id = (SELECT id FROM formation WHERE attempt_id = ?)')
                  .run(state.rank, state.equipmentLevel, row.tile, id)
              : db.prepare('UPDATE arena_opponent_hero SET rank = ?, equipment_level = ? WHERE attempt_id = ? AND tile = ?').run(state.rank, state.equipmentLevel, id, row.tile);
          corrected += result.changes;
        }
        const assist =
          side === 'A'
            ? db.prepare('UPDATE formation SET assist_rank = ?, assist_equipment_level = ? WHERE attempt_id = ? AND assist_hero = ?')
            : db.prepare('UPDATE arena_attempt SET opp_assist_rank = ?, opp_assist_equipment = ? WHERE attempt_id = ? AND opp_assist_hero = ?');
        for (const state of states) corrected += assist.run(state.rank, state.equipmentLevel, id, state.hero).changes;
      }
    })();
    return { corrected };
  });

  return app;
}
