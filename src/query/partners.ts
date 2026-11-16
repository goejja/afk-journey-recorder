import type Database from 'better-sqlite3';
import { type StatFilters, MAX_ROWS, APPEARANCES, whereFor } from './filters.js';

/** The mechanic tags the unit info gives the heroes (ADR 0037), each with the heroes that carry it, the most used tags first. */
export function partnerTags(db: Database.Database): { tag: string; heroes: string[] }[] {
  const rows = db
    .prepare('SELECT j.value AS tag, a.hero FROM hero_attribute a, json_each(a.mechanics) j ORDER BY j.value, a.hero')
    .all() as { tag: string; hero: string }[];
  const byTag = new Map<string, string[]>();
  for (const { tag, hero } of rows) byTag.set(tag, [...(byTag.get(tag) ?? []), hero]);
  return [...byTag].map(([tag, heroes]) => ({ tag, heroes })).sort((a, b) => b.heroes.length - a.heroes.length || a.tag.localeCompare(b.tag));
}

/**
 * The heroes fielded on the same side as one hero, each with the games and wins of those sides and its share of the hero's games.
 * Only team membership: it says who stood together, not who the target of a protect, heal or buff was.
 */
export function partnerStats(db: Database.Database, hero: string, filters: StatFilters & { minGames?: number } = {}) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  const own = `${where ? `${where} AND` : 'WHERE'} lower(x.hero) = lower(?)`;
  const total = db
    .prepare(`SELECT count(*) AS games, coalesce(sum(x.won), 0) AS wins FROM (${APPEARANCES}) x ${own}`)
    .get(...params, hero) as { games: number; wins: number };
  const partners = db
    .prepare(
      `SELECT y.hero AS hero, count(*) AS games, sum(x.won) AS wins, round(1.0 * sum(x.won) / count(*), 3) AS winRate, round(1.0 * count(*) / ?, 3) AS share
       FROM (${APPEARANCES}) x
       JOIN (${APPEARANCES}) y ON y.attempt_id = x.attempt_id AND y.side = x.side AND y.hero <> x.hero
       ${own} GROUP BY y.hero HAVING count(*) >= ? ORDER BY games DESC, winRate DESC, y.hero LIMIT ${MAX_ROWS}`,
    )
    .all(Math.max(total.games, 1), ...params, hero, filters.minGames ?? 1) as { hero: string; games: number; wins: number; winRate: number; share: number }[];
  return { hero, games: total.games, wins: total.wins, winRate: total.games === 0 ? 0 : Math.round((total.wins / total.games) * 1000) / 1000, partners };
}
