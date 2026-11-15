import type Database from 'better-sqlite3';

export interface Filters {
  /** Stage, Dream Hunt, Arena, Supreme Arena, Super League, Guild Duel or Treasure Rush. */
  mode?: string;
  tag?: string;
  /** Only records made before this attempt id (creation order). Used by the backtest so a prediction never sees later records. */
  before?: number;
  /** Leave out the record with this attempt id. */
  except?: number;
}

/** Filters of the statistics, where several modes, kinds or tags may be given: a record matches when it has any of them. */
export type StatFilters = Omit<Filters, 'mode' | 'tag'> & {
  mode?: string | string[];
  tag?: string | string[];
  /** Player IDs (ADR 0006): only the sides of these Players. */
  player?: string | string[];
  /** Leave out the sides of the default profile's Player ID, to see what other Players use. Nothing is left out when it has no Player ID. */
  excludeDefault?: boolean;
};

export const listOf = (value: string | string[] | undefined): string[] => (value === undefined ? [] : [value].flat().filter((v) => v !== ''));
export const placeholders = (values: string[]) => values.map(() => '?').join(', ');

export const MAX_ROWS = 500;

/** One row per hero per record from that hero's side, with whether that side won. Arena Side B counts too, with the result flipped. */
export const APPEARANCES = `
  SELECT s.attempt_id, s.side, s.mode, h.hero, s.won
  FROM v_side s JOIN v_side_hero h ON h.attempt_id = s.attempt_id AND h.side = s.side`;

export function whereFor(filters: StatFilters, params: unknown[]): string {
  const clauses: string[] = [];
  const modes = listOf(filters.mode);
  if (modes.length) (clauses.push(`x.mode IN (${placeholders(modes)})`), params.push(...modes));
  const tags = listOf(filters.tag);
  if (tags.length) (clauses.push(`EXISTS (SELECT 1 FROM attempt_tag t WHERE t.attempt_id = x.attempt_id AND t.tag IN (${placeholders(tags)}))`), params.push(...tags));
  const players = listOf(filters.player);
  if (players.length) (clauses.push(`EXISTS (SELECT 1 FROM attempt_player p WHERE p.attempt_id = x.attempt_id AND p.side = x.side AND p.player_id IN (${placeholders(players)}))`), params.push(...players));
  if (filters.excludeDefault) clauses.push(`NOT EXISTS (SELECT 1 FROM attempt_player p JOIN profile pr ON pr.player_id = p.player_id AND pr.is_default = 1 WHERE p.attempt_id = x.attempt_id AND p.side = x.side)`);
  if (filters.before !== undefined) (clauses.push('x.attempt_id < ?'), params.push(filters.before));
  if (filters.except !== undefined) (clauses.push('x.attempt_id <> ?'), params.push(filters.except));
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

/** Player IDs from what a person types: a Profile's name stands for its Player ID, anything else is taken as an ID as it is. */
export function playerIds(db: Database.Database, values: string[]): string[] {
  const byName = db.prepare('SELECT player_id FROM profile WHERE name = ? AND player_id IS NOT NULL').pluck();
  return values.map((v) => (byName.get(v) as string | undefined) ?? v);
}

/** Runs one statement that only reads. The connection should be read-only as well; this also refuses anything else. */
export function runSelect(db: Database.Database, sql: string): unknown[] {
  const statement = sql.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(statement)) throw new Error('Only a single SELECT statement is allowed');
  let prepared: Database.Statement;
  try {
    prepared = db.prepare(statement);
  } catch (e) {
    if (e instanceof RangeError) throw new Error('Only a single SELECT statement is allowed'); // more than one statement
    throw e;
  }
  if (!prepared.reader) throw new Error('Only a single SELECT statement is allowed');
  const rows: unknown[] = [];
  for (const row of prepared.iterate()) {
    rows.push(row);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}
