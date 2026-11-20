import type Database from 'better-sqlite3';
import { DEFAULT_PLAYER_ID_SQL } from '../db/profiles.js';
import { listOf, MAX_ROWS, placeholders, seasonsOf, type StatFilters } from './filters.js';
import { FORMATIONS_PER_PLAYER, sideFormations, tally } from './formations.js';

/**
 * Win rate of each Player (a Player ID on a side, ADR 0006) from their own side, with the modes they were seen in, when, and the
 * formations they fielded most. `name` is the Profile that has the ID now, null when none does. Sides with no Player are left out.
 */
export function playerStats(db: Database.Database, filters: { mode?: string | string[]; playedIn?: StatFilters['playedIn']; minGames?: number; excludeDefault?: boolean } = {}) {
  const params: unknown[] = [];
  const modes = listOf(filters.mode);
  const clauses: string[] = [];
  if (modes.length) (clauses.push(`s.mode IN (${placeholders(modes)})`), params.push(...modes));
  const seasons = seasonsOf(filters.playedIn);
  if (seasons.length) (clauses.push(`s.attempt_id IN (SELECT id FROM attempt WHERE season IN (${placeholders(seasons.map(String))}))`), params.push(...seasons));
  if (filters.excludeDefault) clauses.push(`p.player_id NOT IN (${DEFAULT_PLAYER_ID_SQL})`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const players = db
    .prepare(
      `SELECT p.player_id AS playerId, (SELECT name FROM profile WHERE player_id = p.player_id) AS name,
              count(*) AS games, sum(s.won) AS wins, round(1.0 * sum(s.won) / count(*), 3) AS winRate,
              group_concat(DISTINCT s.mode) AS modes, min(s.created_at) AS first, max(s.created_at) AS last
       FROM v_side s JOIN attempt_player p ON p.attempt_id = s.attempt_id AND p.side = s.side
       ${where} GROUP BY p.player_id HAVING count(*) >= ? ORDER BY games DESC, winRate DESC, p.player_id LIMIT ${MAX_ROWS}`,
    )
    .all(...params, filters.minGames ?? 1) as { playerId: string; name: string | null; games: number; wins: number; winRate: number; modes: string; first: string; last: string }[];
  const sides = sideFormations(db, { mode: filters.mode, playedIn: filters.playedIn, excludeDefault: filters.excludeDefault }).filter((s) => s.playerId !== null);
  return players.map((p) => ({
    ...p,
    modes: p.modes.split(',').sort(),
    formations: tally(sides.filter((s) => s.playerId === p.playerId)).slice(0, FORMATIONS_PER_PLAYER),
  }));
}
