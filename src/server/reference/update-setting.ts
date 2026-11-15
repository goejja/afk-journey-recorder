import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { updateDateContract } from '../../shared/contracts/update-date.js';
import { serve } from '../contract.js';

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
    db.prepare('INSERT INTO update_setting (id, updated_on) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET updated_on = excluded.updated_on').run(body.date);
    return view();
  });

  serve(app, updateDateContract.clear, () => {
    db.prepare('DELETE FROM update_setting').run();
    return view();
  });

  return app;
}
