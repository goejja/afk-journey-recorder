import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { DEFAULT_THINNING_SETTINGS, type ThinningSettings } from '../../domain/thinning.js';
import { reviewContract } from '../../shared/contracts/review.js';
import { serve } from '../contract.js';

/** The distances the player saved, over the defaults for the kinds not saved. */
export function loadThinningSettings(db: Database.Database): ThinningSettings {
  const saved = db.prepare('SELECT kind, distance FROM thinning_setting').all() as { kind: string; distance: number }[];
  return { ...DEFAULT_THINNING_SETTINGS, ...Object.fromEntries(saved.map((s) => [s.kind, s.distance])) };
}

/** Routes for how alike pictures must be for Thinning: read and save. */
export function thinningSettingsRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const view = () => ({ ...loadThinningSettings(db), defaults: DEFAULT_THINNING_SETTINGS });

  serve(app, reviewContract.thinningSettings, view);

  serve(app, reviewContract.saveThinningSettings, ({ body }) => {
    db.prepare('INSERT INTO thinning_setting (kind, distance) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET distance = excluded.distance').run('rank', body.rank);
    return view();
  });

  return app;
}
