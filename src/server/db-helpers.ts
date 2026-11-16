import type Database from 'better-sqlite3';
import { DEFAULT_CURRENT_SEASON } from '../domain/season.js';

type NamedTable = 'hero' | 'artifact' | 'phantimal' | 'map' | 'boss' | 'boss_rule' | 'formation_id';
type SingletonTable = 'score_setting' | 'stats_setting' | 'counter_setting' | 'update_setting' | 'agent_setting';
type NumberedTable = 'tournament' | 'profile' | 'scenario' | 'battle' | 'attempt';

/**
 * Saves the one row (`id = 1`) of a settings table, replacing the saved one. The columns are the keys of `values`, each named once; they
 * are written by the caller in code, never read from a request.
 */
export function upsertSingleton(db: Database.Database, table: SingletonTable, values: Record<string, string | number | null>): void {
  const columns = Object.keys(values);
  db.prepare(
    `INSERT INTO ${table} (id, ${columns.join(', ')}) VALUES (1, ${columns.map(() => '?').join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).run(...Object.values(values));
}

/** Whether a row of a table with a `name` column has this name. */
export function hasName(db: Database.Database, table: NamedTable, name: unknown): boolean {
  return db.prepare(`SELECT 1 FROM ${table} WHERE name = ?`).get(name) !== undefined;
}

/** Whether a row of a table has this `id`. */
export function hasId(db: Database.Database, table: NumberedTable, id: unknown): boolean {
  return db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;
}

/** The name of every hero. */
export function heroNames(db: Database.Database): string[] {
  return db.prepare('SELECT name FROM hero').pluck().all() as string[];
}

export function heroNameSet(db: Database.Database): Set<string> {
  return new Set(heroNames(db));
}

/** The tiles of a map (see `TILE` in the domain), or null when there is no such map. */
export function mapCells(db: Database.Database, name: string): number[] | null {
  const cells = db.prepare('SELECT cells FROM map WHERE name = ?').pluck().get(name) as string | undefined;
  return cells ? (JSON.parse(cells) as number[]) : null;
}

/** The current season of Admin > General. */
export function currentSeason(db: Database.Database): number {
  return (db.prepare('SELECT number FROM season WHERE is_current = 1').pluck().get() as number | undefined) ?? DEFAULT_CURRENT_SEASON;
}

/**
 * The season a new record is played in (ADR 0038): the Tournament's when the record is a fight in a Battle of a Tournament, so a late
 * import of an earlier season's Round stays in that season; else the season of the fights the Battle already has, so a fight added later
 * to an old Battle joins it; else the current season.
 */
export function seasonOfNewRecord(db: Database.Database, battleId?: number | null): number {
  if (battleId != null) {
    const tournamentSeason = db.prepare('SELECT t.season FROM battle b JOIN tournament t ON t.id = b.tournament_id WHERE b.id = ?').pluck().get(battleId) as number | undefined;
    if (tournamentSeason !== undefined) return tournamentSeason;
    const fightSeason = db.prepare('SELECT season FROM attempt WHERE battle_id = ? LIMIT 1').pluck().get(battleId) as number | undefined;
    if (fightSeason !== undefined) return fightSeason;
  }
  return currentSeason(db);
}
