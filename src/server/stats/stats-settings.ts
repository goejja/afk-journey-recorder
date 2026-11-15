import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { DEFAULT_STATS_MODES, orderedStatsModes, STATS_MODES } from '../../domain/stats.js';
import { statsSettingsContract } from '../../shared/contracts/stats-settings.js';
import { serve } from '../contract.js';

/** The modes the Statistics page starts with: the saved list, or the player-versus-player modes when none is saved. */
function loadDefaultModes(db: Database.Database): string[] {
  const saved = db.prepare('SELECT default_modes FROM stats_setting WHERE id = 1').pluck().get() as string | undefined;
  return saved === undefined ? [...DEFAULT_STATS_MODES] : (JSON.parse(saved) as string[]);
}

/** Routes for Admin > General > Statistics: read, save and reset the modes the Statistics page starts with. */
export function statsSettingsRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const view = () => ({ modes: loadDefaultModes(db), defaults: [...DEFAULT_STATS_MODES], available: [...STATS_MODES] });

  serve(app, statsSettingsContract.get, view);

  serve(app, statsSettingsContract.save, ({ body }) => {
    db.prepare(
      'INSERT INTO stats_setting (id, default_modes) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET default_modes = excluded.default_modes',
    ).run(JSON.stringify(orderedStatsModes(body.modes)));
    return view();
  });

  serve(app, statsSettingsContract.reset, () => {
    db.prepare('DELETE FROM stats_setting').run();
    return view();
  });

  return app;
}
