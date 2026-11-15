import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { unitRulesContract } from '../../shared/contracts/unit-rules.js';
import { readUnitRules } from '../../db/unit-rules.js';
import { serve } from '../contract.js';

/** The pairs, summons and second parts the player declared, which the web app needs to place and check units like the server does. */
export function unitRuleRoutes(db: Database.Database): Hono {
  const app = new Hono();
  serve(app, unitRulesContract.get, () => readUnitRules(db));
  return app;
}
