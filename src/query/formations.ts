import type Database from 'better-sqlite3';
import { round3 as round } from '../domain/stats.js';
import { type StatFilters, listOf, MAX_ROWS, APPEARANCES, whereFor } from './filters.js';

export const FORMATIONS_PER_PLAYER = 5;

interface FormationRow {
  heroes: string[];
  games: number;
  wins: number;
  winRate: number;
}

/** The units of each side as a set of hero names (positions, artifact, rank and equipment ignored), with that side's result. */
export function sideFormations(db: Database.Database, filters: StatFilters) {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  const rows = db
    .prepare(
      `SELECT x.attempt_id AS attemptId, x.side, x.hero, x.won, p.player_id AS playerId
       FROM (${APPEARANCES}) x LEFT JOIN attempt_player p ON p.attempt_id = x.attempt_id AND p.side = x.side
       ${where} ORDER BY x.attempt_id, x.side, x.hero`,
    )
    .all(...params) as { attemptId: number; side: string; hero: string; won: number; playerId: string | null }[];
  const sides = new Map<string, { heroes: string[]; won: number; playerId: string | null }>();
  for (const r of rows) {
    const key = `${r.attemptId}/${r.side}`;
    const side = sides.get(key) ?? { heroes: [], won: r.won, playerId: r.playerId };
    side.heroes.push(r.hero);
    sides.set(key, side);
  }
  return [...sides.values()];
}

export function tally(sides: { heroes: string[]; won: number }[]): FormationRow[] {
  const byKey = new Map<string, FormationRow>();
  for (const { heroes, won } of sides) {
    const key = JSON.stringify(heroes);
    const row = byKey.get(key) ?? { heroes, games: 0, wins: 0, winRate: 0 };
    row.games += 1;
    row.wins += won;
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .map((r) => ({ ...r, winRate: round(r.wins / r.games) }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.heroes.join().localeCompare(b.heroes.join()));
}

/**
 * Most used formations: the set of heroes on a side (positions, artifact, rank and equipment ignored), with how often it was fielded
 * and how it did. Both sides of a PvP record count, so other players' teams are included; filter by `player` for one Player's own.
 */
export function formationStats(db: Database.Database, filters: StatFilters & { minGames?: number } = {}): FormationRow[] {
  return tally(sideFormations(db, filters))
    .filter((r) => r.games >= (filters.minGames ?? 1))
    .slice(0, MAX_ROWS);
}

/** A hero of a Formation group with its share of the group's appearances (0 to 1). */
export interface GroupHero {
  hero: string;
  share: number;
}

/** A hero in at least this share of a Formation group's appearances is core; below it, and from FLEX_SHARE up, it is flex. */
const CORE_SHARE = 0.8;
const FLEX_SHARE = 0.15;

export interface FormationGroup {
  /** The heroes in at least 80% of the group's appearances, most used first. */
  core: GroupHero[];
  /** The heroes in 15% to below 80% of them, most used first. */
  flex: GroupHero[];
  games: number;
  wins: number;
  winRate: number;
  /** How many different Players stood behind the group's sides; sides with no known Player are not counted. */
  players: number;
  /** The Player IDs counted in `players`. */
  playerIds: string[];
  /** The formations of the group, most used first, each with the heroes outside the core. */
  variants: (FormationRow & { flex: string[] })[];
}

/**
 * Formations that differ by one hero, grouped. Exact formations are taken from the most used down; each joins the first group whose
 * first formation it shares all but one hero with (same size, at least 3 heroes), or starts a new group. A hero's share is the part of
 * the group's games it stood in: core from 80%, flex from 15% (rarer heroes are in neither list). Groups never overlap, so the games add
 * up to the games of the formations.
 */
export function formationGroups(db: Database.Database, filters: StatFilters & { minGames?: number; hero?: string | string[] } = {}): FormationGroup[] {
  return groupSides(sideFormations(db, filters), filters).slice(0, MAX_ROWS);
}

/** `formationGroups` over sides already read: each with its heroes (sorted by name), result and Player. */
export function groupSides(
  sides: { heroes: string[]; won: number; playerId: string | null }[],
  filters: { minGames?: number; hero?: string | string[] } = {},
): FormationGroup[] {
  const playersOf = new Map<string, Set<string>>();
  for (const side of sides) {
    if (side.playerId === null) continue;
    const key = JSON.stringify(side.heroes);
    playersOf.set(key, (playersOf.get(key) ?? new Set()).add(side.playerId));
  }
  const picked = listOf(filters.hero);
  const groups: { seed: string[]; members: FormationRow[] }[] = [];
  for (const formation of tally(sides)) {
    const size = formation.heroes.length;
    const group = groups.find(
      (g) => g.seed.length === size && size >= 3 && formation.heroes.filter((h) => g.seed.includes(h)).length >= size - 1,
    );
    if (group) group.members.push(formation);
    else groups.push({ seed: formation.heroes, members: [formation] });
  }
  return groups
    .map(({ members }) => {
      const games = members.reduce((sum, m) => sum + m.games, 0);
      const wins = members.reduce((sum, m) => sum + m.wins, 0);
      const appearances = new Map<string, number>();
      for (const m of members) for (const h of m.heroes) appearances.set(h, (appearances.get(h) ?? 0) + m.games);
      const shares = [...appearances]
        .map(([hero, count]) => ({ hero, share: round(count / games) }))
        .sort((a, b) => b.share - a.share || a.hero.localeCompare(b.hero));
      const core = shares.filter((h) => h.share >= CORE_SHARE);
      const coreNames = core.map((h) => h.hero);
      const playerIds = [...new Set(members.flatMap((m) => [...(playersOf.get(JSON.stringify(m.heroes)) ?? [])]))].sort();
      return {
        players: playerIds.length,
        playerIds,
        core,
        flex: shares.filter((h) => h.share >= FLEX_SHARE && h.share < CORE_SHARE),
        games,
        wins,
        winRate: round(wins / games),
        variants: members.map((m) => ({ ...m, flex: m.heroes.filter((h) => !coreNames.includes(h)) })),
      };
    })
    .filter((g) => g.games >= (filters.minGames ?? 1))
    .filter((g) => picked.every((hero) => [...g.core, ...g.flex].some((h) => h.hero === hero)))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.core.map((h) => h.hero).join().localeCompare(b.core.map((h) => h.hero).join()));
}

export interface Archetype {
  /** The heroes that are core in every group of the row, with their share of all the row's games. */
  core: GroupHero[];
  /** The other heroes its groups add (core or flex in some), from 15% of all the row's games. */
  flex: GroupHero[];
  games: number;
  wins: number;
  winRate: number;
  players: number;
  /** Its groups, most used first. Each keeps its own results; the row only adds the games up. */
  groups: FormationGroup[];
}

/**
 * Groups that share two or more core heroes, listed together. Groups are taken from the most used down; one joins the row where it
 * shares the most core heroes with what the row's groups all have in common (at least 2, then the row with more games), or starts a
 * row. A group alone is a row of one. A group that could join two rows goes to the one that shares more with it, which is a simpler
 * reading than counting how often two groups were grouped together, since it needs no history of how groups were split.
 */
export function formationArchetypes(groups: FormationGroup[]): Archetype[] {
  const rows: { common: string[]; groups: FormationGroup[] }[] = [];
  for (const group of groups) {
    const names = group.core.map((h) => h.hero);
    let best: { row: (typeof rows)[number]; shared: number } | null = null;
    for (const row of rows) {
      const shared = row.common.filter((h) => names.includes(h)).length;
      const games = (r: typeof row) => r.groups.reduce((sum, g) => sum + g.games, 0);
      if (shared >= 2 && (!best || shared > best.shared || (shared === best.shared && games(row) > games(best.row)))) best = { row, shared };
    }
    if (best) {
      best.row.groups.push(group);
      best.row.common = best.row.common.filter((h) => names.includes(h));
    } else rows.push({ common: names, groups: [group] });
  }
  return rows.map(({ common, groups: members }) => {
    const games = members.reduce((sum, g) => sum + g.games, 0);
    const wins = members.reduce((sum, g) => sum + g.wins, 0);
    const weighted = new Map<string, number>();
    for (const g of members) for (const h of [...g.core, ...g.flex]) weighted.set(h.hero, (weighted.get(h.hero) ?? 0) + h.share * g.games);
    const heroes = [...weighted]
      .map(([hero, total]) => ({ hero, share: round(total / games) }))
      .sort((a, b) => b.share - a.share || a.hero.localeCompare(b.hero));
    return {
      core: heroes.filter((h) => common.includes(h.hero)),
      flex: heroes.filter((h) => !common.includes(h.hero) && h.share >= FLEX_SHARE),
      games,
      wins,
      winRate: round(wins / games),
      players: new Set(members.flatMap((g) => g.playerIds)).size,
      groups: members,
    };
  });
}
