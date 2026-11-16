import type Database from 'better-sqlite3';
import { type PartnerRelation, partnersAt } from '../domain/partner-relation.js';
import { loadSides, type SideRow } from './formation-profile.js';
import { type StatFilters, MAX_ROWS, APPEARANCES, whereFor } from './filters.js';
import { round3 as round } from '../domain/stats.js';

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

/** Fewer sides than this are anecdote (AGENTS.md); a partner seen at least this often in one exact layout is flagged as one repeated formation. */
const ANECDOTE_BELOW = 5;
const ONE_LAYOUT_SHARE = 0.5;

/**
 * Who stood in a relation to a hero at the start of the fight (behind it, around it, in its game row and so on), counted over the sides
 * that held the hero: games, wins and the share of the hero's games, with how many different Players and exact layouts stood behind
 * each partner. A side where nobody stood there counts under `empty`. It says who stood there, not who a skill reached, and Side B is
 * read from its own back edge.
 */
export function positionalPartners(db: Database.Database, hero: string, relation: PartnerRelation, filters: StatFilters & { minGames?: number } = {}) {
  const sides = loadSides(db, filters).flatMap((side) => {
    const name = [...side.tiles.keys()].find((h) => h.toLowerCase() === hero.toLowerCase());
    return name === undefined ? [] : [{ side, name }];
  });
  const layoutOf = (side: SideRow) => JSON.stringify([...side.tiles].sort((x, y) => x[0].localeCompare(y[0])));
  const partners = new Map<string, { games: number; wins: number; players: Set<string>; layouts: Map<string, number> }>();
  let wins = 0;
  let empty = 0;
  for (const { side, name } of sides) {
    wins += side.won;
    const others = [...side.tiles].filter(([h]) => h !== name).map(([h, tile]) => ({ hero: h, tile }));
    const found = partnersAt(relation, side.tiles.get(name)!, others);
    if (found.length === 0) empty += 1;
    for (const partner of found) {
      const tally = partners.get(partner) ?? { games: 0, wins: 0, players: new Set<string>(), layouts: new Map<string, number>() };
      tally.games += 1;
      tally.wins += side.won;
      if (side.playerId !== null) tally.players.add(side.playerId);
      tally.layouts.set(layoutOf(side), (tally.layouts.get(layoutOf(side)) ?? 0) + 1);
      partners.set(partner, tally);
    }
  }
  const games = sides.length;
  return {
    hero,
    relation,
    games,
    wins,
    winRate: games === 0 ? 0 : round(wins / games),
    empty,
    partners: [...partners]
      .filter(([, t]) => t.games >= (filters.minGames ?? 1))
      .map(([partner, t]) => ({
        hero: partner,
        games: t.games,
        wins: t.wins,
        winRate: round(t.wins / t.games),
        share: round(t.games / games),
        players: t.players.size,
        layouts: t.layouts.size,
        oneLayout: t.games >= ANECDOTE_BELOW && Math.max(...t.layouts.values()) / t.games >= ONE_LAYOUT_SHARE,
      }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.hero.localeCompare(b.hero))
      .slice(0, MAX_ROWS),
  };
}
