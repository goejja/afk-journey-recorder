import type Database from 'better-sqlite3';
import { gameRowOf } from '../domain/board.js';
import { type StatFilters, MAX_ROWS, APPEARANCES, whereFor } from './filters.js';

/**
 * Win rate of each hero across the records it appeared in, with its pick rate: the share of all sides (in the same filter)
 * that fielded it.
 */
export function heroStats(db: Database.Database, filters: StatFilters & { minGames?: number } = {}) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  const sides = db
    .prepare(`SELECT count(*) FROM (SELECT DISTINCT x.attempt_id, x.side FROM (${APPEARANCES}) x ${where})`)
    .pluck()
    .get(...params) as number;
  return db
    .prepare(
      `SELECT x.hero, count(*) AS games, sum(x.won) AS wins, round(1.0 * sum(x.won) / count(*), 3) AS winRate, round(1.0 * count(*) / ?, 3) AS pickRate
       FROM (${APPEARANCES}) x ${where} GROUP BY x.hero HAVING count(*) >= ? ORDER BY winRate DESC, games DESC LIMIT ${MAX_ROWS}`,
    )
    .all(Math.max(sides, 1), ...params, filters.minGames ?? 1);
}

/** Win rate of each pair of heroes fielded together on the same side. */
export function pairStats(db: Database.Database, filters: StatFilters & { minGames?: number } = {}) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  return db
    .prepare(
      `SELECT x.hero AS heroA, y.hero AS heroB, count(*) AS games, sum(x.won) AS wins, round(1.0 * sum(x.won) / count(*), 3) AS winRate
       FROM (${APPEARANCES}) x
       JOIN (${APPEARANCES}) y ON y.attempt_id = x.attempt_id AND y.side = x.side AND y.hero > x.hero
       ${where} GROUP BY x.hero, y.hero HAVING count(*) >= ? ORDER BY winRate DESC, games DESC LIMIT ${MAX_ROWS}`,
    )
    .all(...params, filters.minGames ?? 1);
}

/**
 * How a hero's rank and equipment are spread over the Players who fielded it. Each Player counts once, with the state from their latest
 * record that has a rank (records are in entry order); a Player whose records have none is counted as `unknown`. Sides with no Player
 * are left out, and so is the roster: this is what was recorded, not what anyone owns now.
 */
export function heroDistribution(db: Database.Database, hero: string, filters: StatFilters = {}) {
  const params: unknown[] = [hero];
  const where = whereFor(filters, params);
  const rows = db
    .prepare(
      `SELECT x.player_id AS playerId, x.rank, x.equipment_level AS equipmentLevel
       FROM (SELECT s.attempt_id, s.side, s.mode, lower(p.player_id) AS player_id, h.rank, h.equipment_level
             FROM v_side s JOIN attempt_player p ON p.attempt_id = s.attempt_id AND p.side = s.side
             JOIN v_side_hero h ON h.attempt_id = s.attempt_id AND h.side = s.side WHERE h.hero = ?) x
       ${where} ORDER BY x.attempt_id DESC`,
    )
    .all(...params) as { playerId: string; rank: string | null; equipmentLevel: number | null }[];
  const latest = new Map<string, { rank: string; equipmentLevel: number | null } | null>();
  for (const row of rows) {
    if (!latest.has(row.playerId)) latest.set(row.playerId, null);
    if (latest.get(row.playerId) === null && row.rank !== null) latest.set(row.playerId, { rank: row.rank, equipmentLevel: row.equipmentLevel });
  }
  const position = new Map((db.prepare('SELECT name, position FROM rank').all() as { name: string; position: number }[]).map((r) => [r.name, r.position]));
  const counts = new Map<string, { rank: string; equipmentLevel: number | null; players: number }>();
  let unknown = 0;
  for (const state of latest.values()) {
    if (state === null) {
      unknown += 1;
      continue;
    }
    const key = `${state.rank}\u0000${state.equipmentLevel}`;
    const cell = counts.get(key) ?? { ...state, players: 0 };
    cell.players += 1;
    counts.set(key, cell);
  }
  const cells = [...counts.values()].sort(
    (a, b) => (position.get(b.rank) ?? -1) - (position.get(a.rank) ?? -1) || (b.equipmentLevel ?? -1) - (a.equipmentLevel ?? -1),
  );
  return { hero, players: latest.size, unknown, cells };
}

/** Win rate of each trio of heroes fielded together on the same side. */
export function trioStats(db: Database.Database, filters: StatFilters & { minGames?: number } = {}) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  return db
    .prepare(
      `SELECT x.hero AS heroA, y.hero AS heroB, z.hero AS heroC, count(*) AS games, sum(x.won) AS wins, round(1.0 * sum(x.won) / count(*), 3) AS winRate
       FROM (${APPEARANCES}) x
       JOIN (${APPEARANCES}) y ON y.attempt_id = x.attempt_id AND y.side = x.side AND y.hero > x.hero
       JOIN (${APPEARANCES}) z ON z.attempt_id = x.attempt_id AND z.side = x.side AND z.hero > y.hero
       ${where} GROUP BY x.hero, y.hero, z.hero HAVING count(*) >= ? ORDER BY winRate DESC, games DESC LIMIT ${MAX_ROWS}`,
    )
    .all(...params, filters.minGames ?? 1);
}

/** Win rate of each artifact, from the side that used it. A side whose artifact is not known is left out. */
export function artifactStats(db: Database.Database, filters: StatFilters & { minGames?: number } = {}) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  return db
    .prepare(
      `SELECT x.artifact, count(*) AS games, sum(x.won) AS wins, round(1.0 * sum(x.won) / count(*), 3) AS winRate
       FROM v_side x ${where ? `${where} AND` : 'WHERE'} x.artifact IS NOT NULL
       GROUP BY x.artifact HAVING count(*) >= ? ORDER BY winRate DESC, games DESC LIMIT ${MAX_ROWS}`,
    )
    .all(...params, filters.minGames ?? 1);
}

/**
 * Win rate of Side A per map. Both sides of a battle share the map, so counting both would always give half: only Side A, whose
 * result is the record's, is counted.
 */
export function mapStats(db: Database.Database, filters: StatFilters & { minGames?: number } = {}) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  return db
    .prepare(
      `SELECT x.map_name AS map, count(*) AS games, sum(x.won) AS wins, round(1.0 * sum(x.won) / count(*), 3) AS winRate
       FROM v_side x ${where ? `${where} AND` : 'WHERE'} x.side = 'A' AND x.map_name IS NOT NULL
       GROUP BY x.map_name HAVING count(*) >= ? ORDER BY games DESC, winRate DESC LIMIT ${MAX_ROWS}`,
    )
    .all(...params, filters.minGames ?? 1) as { map: string; games: number; wins: number; winRate: number }[];
}

/**
 * Win rate of a hero by the game row it stood in (the diagonal rows of ADR 0036, 1 to 15), counted from the back edge of its own side:
 * Side B reads the board turned over, so both sides read the same way. A hero on several tiles (a Pair Hero) counts once per tile.
 */
export function heroRowStats(db: Database.Database, hero: string, filters: StatFilters = {}) {
  const params: unknown[] = [hero];
  const where = whereFor(filters, params);
  const rows = db
    .prepare(
      `SELECT x.tile, x.side, x.won FROM (SELECT s.attempt_id, s.side, s.mode, s.won, h.tile
         FROM v_side s JOIN v_side_hero h ON h.attempt_id = s.attempt_id AND h.side = s.side WHERE h.hero = ?) x ${where}`,
    )
    .all(...params) as { tile: number; side: 'A' | 'B'; won: number }[];
  const byRow = new Map<number, { games: number; wins: number }>();
  for (const r of rows) {
    const row = gameRowOf(r.tile, r.side);
    const entry = byRow.get(row) ?? { games: 0, wins: 0 };
    entry.games += 1;
    entry.wins += r.won;
    byRow.set(row, entry);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, { games, wins }]) => ({ row, games, wins, winRate: Math.round((wins / games) * 1000) / 1000 }));
}
