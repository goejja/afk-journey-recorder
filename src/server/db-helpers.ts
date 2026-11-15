import type Database from 'better-sqlite3';
import type { Context } from 'hono';

/** The JSON body of a request, or null when it is missing or not JSON. Callers check the fields they read. */
export async function readJson(c: Context): Promise<any> {
  return c.req.json().catch(() => null);
}

type NamedTable = 'hero' | 'artifact' | 'phantimal' | 'map' | 'boss' | 'boss_rule' | 'formation_id';
type NumberedTable = 'tournament' | 'profile' | 'scenario' | 'battle' | 'attempt';

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
