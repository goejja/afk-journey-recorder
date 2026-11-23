import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { TITAN_BOSS_SLOTS, titanSlotLabel, validateTitanReaverSetup, type TitanReaverSetup } from '../../domain/titan-reaver.js';
import { titanReaverContract, type TitanReaverView } from '../../shared/contracts/defaults.js';
import { hasName } from '../db-helpers.js';
import { fail, serve } from '../contract.js';

/** Routes for the Titan Reaver setup in Admin > Weekly default, which the Titan Reaver record form starts from (#277). */
export function titanReaverRoutes(db: Database.Database): Hono {
  const app = new Hono();

  const view = (): TitanReaverView => {
    const rows = db.prepare('SELECT position, boss, updated_at AS updatedAt FROM titan_reaver_default').all() as { position: number; boss: string | null; updatedAt: string }[];
    return {
      bosses: Array.from({ length: TITAN_BOSS_SLOTS }, (_, i) => rows.find((r) => r.position === i + 1)?.boss ?? null),
      updatedAt: rows.map((r) => r.updatedAt).sort().at(-1) ?? null,
    };
  };

  serve(app, titanReaverContract.get, () => view());

  serve(app, titanReaverContract.save, ({ body }) => {
    const problem = validateTitanReaverSetup(body);
    if (problem) return fail(400, problem);
    const { bosses } = body as TitanReaverSetup;
    for (const [i, boss] of bosses.entries()) {
      if (boss && !hasName(db, 'boss', boss)) return fail(400, `${titanSlotLabel(i)}: unknown boss "${boss}"`);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM titan_reaver_default').run();
      const insert = db.prepare('INSERT INTO titan_reaver_default (position, boss) VALUES (?, ?)');
      for (const [i, boss] of bosses.entries()) if (boss) insert.run(i + 1, boss);
    })();
    return view();
  });

  serve(app, titanReaverContract.clear, () => {
    db.prepare('DELETE FROM titan_reaver_default').run();
    return view();
  });

  return app;
}
