import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { DEFAULT_COUNTER_RULE, DEFAULT_STATS_MODES, orderedStatsModes, STATS_MODES } from '../../domain/stats.js';
import { counterRuleContract, statsSettingsContract } from '../../shared/contracts/stats-settings.js';
import { serve } from '../contract.js';
import { counterRule } from '../../query/formations.js';
import { upsertSingleton } from '../db-helpers.js';

/** The modes the Statistics page starts with: the saved list, or the player-versus-player modes when none is saved. */
function loadDefaultModes(db: Database.Database): string[] {
  const saved = db.prepare('SELECT default_modes FROM stats_setting WHERE id = 1').pluck().get() as string | undefined;
  return saved === undefined ? [...DEFAULT_STATS_MODES] : (JSON.parse(saved) as string[]);
}

/** Routes for Admin > General > Statistics: read, save and reset the modes the Statistics page starts with and the rule that makes a group a counter. */
export function statsSettingsRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const view = () => ({ modes: loadDefaultModes(db), defaults: [...DEFAULT_STATS_MODES], available: [...STATS_MODES] });

  serve(app, statsSettingsContract.get, view);

  serve(app, statsSettingsContract.save, ({ body }) => {
    upsertSingleton(db, 'stats_setting', { default_modes: JSON.stringify(orderedStatsModes(body.modes)) });
    return view();
  });

  serve(app, statsSettingsContract.reset, () => {
    db.prepare('DELETE FROM stats_setting').run();
    return view();
  });

  const rule = () => ({ ...counterRule(db), defaults: { ...DEFAULT_COUNTER_RULE } });

  serve(app, counterRuleContract.get, rule);

  serve(app, counterRuleContract.save, ({ body }) => {
    upsertSingleton(db, 'counter_setting', { min_win_rate: body.winRate, min_games: body.minGames });
    return rule();
  });

  serve(app, counterRuleContract.reset, () => {
    db.prepare('DELETE FROM counter_setting').run();
    return rule();
  });

  return app;
}
