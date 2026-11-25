import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import type { HeroStateRules } from '../domain/hero-state.js';

/**
 * Stand-in for the Advisor, which is not part of this build. It has the names the app imports and does nothing: no routes are
 * mounted, the query CLI lacks the commands that estimate a chance, and the tier check and the placement check find nothing.
 */

/** Whether the Advisor is part of this build. */
export const installed = false;

export function mountAdvisorRoutes(_app: Hono, _db: Database.Database, _loadRules: () => HeroStateRules): void {}

export const dunlingrCheck = (_db: Database.Database): { rows: unknown[]; records: number; boosted: number; onBoostTile: number } => ({ rows: [], records: 0, boosted: 0, onBoostTile: 0 });
export const backCheck = (_db: Database.Database): { rows: unknown[]; onBoostTile: number } => ({ rows: [], onBoostTile: 0 });

/** How many formation ideas use a hero, a map, an artifact or a Phantimal; this build has no ideas. */
export const ideasUsing = (_db: Database.Database, _kind: 'hero' | 'map' | 'artifact' | 'phantimal', _name: string): number => 0;

export const tierVsRecords = (_db: Database.Database): unknown[] => [];

export const cliUsage = '';

const NEEDS_THE_ADVISOR = ['layout-report', 'similar', 'score', 'backtest', 'counters', 'generate'];

export const cliCommands: Record<string, (context: unknown) => unknown> = Object.fromEntries(
  NEEDS_THE_ADVISOR.map((name) => [
    name,
    () => {
      throw new Error(`"${name}" needs the Advisor, which is not part of this build`);
    },
  ]),
);
