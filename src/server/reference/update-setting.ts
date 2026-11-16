import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { updateDateContract } from '../../shared/contracts/update-date.js';
import { serve } from '../contract.js';
import { upsertSingleton } from '../db-helpers.js';

/** The day of the latest game update, or null when none was set. */
export function loadUpdateDate(db: Database.Database): string | null {
  return (db.prepare('SELECT updated_on FROM update_setting WHERE id = 1').pluck().get() as string | undefined) ?? null;
}

/** Routes for the Update date in Admin > General: read, save and clear. */
export function updateSettingRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const view = () => ({ date: loadUpdateDate(db) });

  serve(app, updateDateContract.get, view);

  serve(app, updateDateContract.save, ({ body }) => {
    upsertSingleton(db, 'update_setting', { updated_on: body.date });
    return view();
  });

  serve(app, updateDateContract.reset, () => {
    db.prepare('DELETE FROM update_setting').run();
    return view();
  });

  return app;
}
