import type Database from 'better-sqlite3';
import { evidenceLabels, type EvidenceLabel } from '../domain/formation-labels.js';
import { TILE_COUNT } from '../domain/map.js';
import { formationArchetypes, formationGroups, round, whereFor, type Archetype, type FormationGroup, type GroupHero, type StatFilters } from './index.js';

/** A variation needs this many appearances; rarer exact lineups are listed apart. */
const VARIATION_MIN_GAMES = 3;
/** An enemy group counts as a matchup from this many games; strong from this win rate, weak up to its complement. */
const MATCHUP_MIN_GAMES = 5;
const STRONG_FROM = 0.6;
const WEAK_UP_TO = 0.4;
/** An upgrade gap is the difference of the sides' mean power per hero; this far or more is ahead or behind. */
const GAP_LEVEL = 0.5;

export interface Tally {
  games: number;
  wins: number;
}
export interface RateRecord extends Tally {
  winRate: number;
}

export interface GroupRow extends FormationGroup {
  /** The group's win rate minus the win rate of all sides under the same filters. */
  vsAverage: number;
  /** The most used artifact and its share of the group's appearances; null when none is known. */
  artifact: { artifact: string; share: number } | null;
  labels: EvidenceLabel[];
}

export interface ReportArchetype extends Omit<Archetype, 'groups'> {
  groups: GroupRow[];
}

/** A hero of a group on one map: the tile it stood on most often (as if on the half of Side A) and how often that was. */
export interface PlacedHero {
  hero: string;
  /** The tile the example board puts the hero on; null when every tile it stood on is taken by a hero used more. */
  tile: number | null;
  /** The share of the hero's games on this map in which it stood on that tile. */
  share: number;
  /** The hero's games on this map. */
  games: number;
  /** The tile is not the hero's favourite: that one went to another hero. */
  secondChoice: boolean;
}

export interface PlacementMap extends RateRecord {
  map: string;
  heroes: PlacedHero[];
}

export interface FormationProfile extends GroupRow {
  artifacts: (RateRecord & { artifact: string; share: number })[];
  /** Exact lineups seen at least 3 times, with the heroes outside the core. */
  variations: (RateRecord & { flex: string[] })[];
  /** The other exact lineups. */
  otherLineups: (RateRecord & { heroes: string[] })[];
  /** The record with and without each flex hero, over all the group's appearances. */
  heroImpact: { hero: string; with: RateRecord; without: RateRecord }[];
  strongAgainst: (RateRecord & { enemy: string[] })[];
  weakAgainst: (RateRecord & { enemy: string[] })[];
  /** Results when ahead, near level and behind in ranks and equipment, and when the gap is unknown. */
  gapRecords: { ahead: Tally; near: Tally; behind: Tally; unknown: Tally };
  /** Expected win rate against an average opponent with equal upgrades minus the recorded one, over the battles with a known gap. */
  gapAdjustment: { games: number; shift: number } | null;
  /** Where the group stood, per map, the map with most games first. */
  placement: PlacementMap[];
}

type Bucket = 'ahead' | 'near' | 'behind';
export interface SideRow {
  attemptId: number;
  side: string;
  won: number;
  artifact: string | null;
  playerId: string | null;
  map: string | null;
  heroes: string[];
  /** The tile of each hero, a Side B tile turned over so both sides read the same way. */
  tiles: Map<string, number>;
}

const rate = (r: Tally): RateRecord => ({ ...r, winRate: r.games === 0 ? 0 : round(r.wins / r.games) });
const keyOf = (heroes: string[]) => JSON.stringify(heroes);
const names = (heroes: GroupHero[]) => heroes.map((h) => h.hero);
const add = (r: Tally, won: number) => ((r.games += 1), (r.wins += won));

/** The sides under the filters, one per side of a record, with their heroes in name order. */
export function loadSides(db: Database.Database, filters: StatFilters): SideRow[] {
  const params: unknown[] = [];
  const where = whereFor(filters, params);
  const rows = db
    .prepare(
      `SELECT x.attempt_id AS attemptId, x.side, x.won, x.artifact, x.map_name AS map, p.player_id AS playerId, h.hero, h.tile
       FROM v_side x JOIN v_side_hero h ON h.attempt_id = x.attempt_id AND h.side = x.side
       LEFT JOIN attempt_player p ON p.attempt_id = x.attempt_id AND p.side = x.side
       ${where} ORDER BY x.attempt_id, x.side, h.hero`,
    )
    .all(...params) as (Omit<SideRow, 'heroes' | 'tiles'> & { hero: string; tile: number })[];
  const sides = new Map<string, SideRow>();
  for (const { hero, tile, ...r } of rows) {
    const side: SideRow = sides.get(`${r.attemptId}/${r.side}`) ?? { ...r, heroes: [], tiles: new Map() };
    side.heroes.push(hero);
    side.tiles.set(hero, r.side === 'B' ? TILE_COUNT - 1 - tile : tile);
    sides.set(`${r.attemptId}/${r.side}`, side);
  }
  return [...sides.values()];
}

/** Power of one hero: its place on the rank ladder plus its equipment step (+5 is a step; the Resonance levels one each after +25). */
const equipmentStep = (level: number | null) => (level === null ? 0 : level <= 25 ? level / 5 : 5 + (level - 25));

/** Mean power per hero of every side of every record, unfiltered; a side with an unknown rank has none. */
function powers(db: Database.Database): Map<string, number | null> {
  const rows = db
    .prepare('SELECT h.attempt_id AS attemptId, h.side, rk.position AS position, h.equipment_level AS equipment FROM v_side_hero h LEFT JOIN rank rk ON rk.name = h.rank')
    .all() as { attemptId: number; side: string; position: number | null; equipment: number | null }[];
  const sums = new Map<string, { total: number; count: number; known: boolean }>();
  for (const r of rows) {
    const entry = sums.get(`${r.attemptId}/${r.side}`) ?? { total: 0, count: 0, known: true };
    entry.count += 1;
    if (r.position === null) entry.known = false;
    else entry.total += r.position + equipmentStep(r.equipment);
    sums.set(`${r.attemptId}/${r.side}`, entry);
  }
  return new Map([...sums].map(([key, e]) => [key, e.known && e.count > 0 ? e.total / e.count : null]));
}

/** Every side's heroes, unfiltered, to find who the enemy of a side was. */
function allFormations(db: Database.Database): Map<string, string[]> {
  const rows = db.prepare('SELECT attempt_id AS attemptId, side, hero FROM v_side_hero ORDER BY attempt_id, side, hero').all() as { attemptId: number; side: string; hero: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(`${r.attemptId}/${r.side}`, [...(map.get(`${r.attemptId}/${r.side}`) ?? []), r.hero]);
  return map;
}

/** The tiles a group's heroes stood on, per map, with an example board on which no two heroes share a tile. */
function placementOf(sides: SideRow[], heroes: string[]): PlacementMap[] {
  const byMap = new Map<string, SideRow[]>();
  for (const s of sides) if (s.map !== null) byMap.set(s.map, [...(byMap.get(s.map) ?? []), s]);
  return [...byMap]
    .map(([map, onMap]) => {
      const placed = heroes.map((hero) => {
        const counts = new Map<number, number>();
        let games = 0;
        for (const s of onMap) {
          const tile = s.tiles.get(hero);
          if (tile === undefined) continue;
          games += 1;
          counts.set(tile, (counts.get(tile) ?? 0) + 1);
        }
        const tiles = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        return { hero, games, tiles };
      });
      const taken = new Set<number>();
      const board = new Map<string, PlacedHero>();
      for (const { hero, games, tiles } of [...placed].sort((a, b) => b.games - a.games || a.hero.localeCompare(b.hero))) {
        const free = tiles.find(([tile]) => !taken.has(tile));
        if (free) taken.add(free[0]);
        board.set(hero, { hero, tile: free ? free[0] : null, share: free ? round(free[1] / games) : 0, games, secondChoice: free !== undefined && free[0] !== tiles[0]![0] });
      }
      const record: Tally = { games: onMap.length, wins: onMap.reduce((sum, s) => sum + s.won, 0) };
      return { map, ...rate(record), heroes: heroes.map((h) => board.get(h)!).filter((h) => h.games > 0) };
    })
    .sort((a, b) => b.games - a.games || a.map.localeCompare(b.map));
}

interface Analysis {
  baseline: number;
  rows: ReportArchetype[];
  profiles: Map<string, FormationProfile>;
}

/** A group is found by the set of its core heroes, in any order. */
const coreKey = (g: { core: GroupHero[] }) => names(g.core).sort().join('/');

function analyse(db: Database.Database, filters: StatFilters): Analysis {
  const groups = formationGroups(db, filters);
  const sides = loadSides(db, filters);
  const baseline = sides.length === 0 ? 0 : round(sides.reduce((sum, s) => sum + s.won, 0) / sides.length);

  const groupOf = new Map<string, FormationGroup>();
  for (const g of groups) for (const v of g.variants) groupOf.set(keyOf(v.heroes), g);
  // Enemies are named by their group among all the sides of the same modes, whatever Player or tag the filters keep.
  const everyGroup = formationGroups(db, { mode: filters.mode });
  const enemyGroupOf = new Map<string, FormationGroup>();
  for (const g of everyGroup) for (const v of g.variants) enemyGroupOf.set(keyOf(v.heroes), g);

  const power = powers(db);
  const formations = allFormations(db);
  const gapOf = (s: SideRow): number | null => {
    const mine = power.get(`${s.attemptId}/${s.side}`);
    const theirs = power.get(`${s.attemptId}/${s.side === 'A' ? 'B' : 'A'}`);
    return mine == null || theirs == null ? null : mine - theirs;
  };
  const bucketOf = (gap: number): Bucket => (gap >= GAP_LEVEL ? 'ahead' : gap <= -GAP_LEVEL ? 'behind' : 'near');

  const league: Record<Bucket, Tally> = { ahead: { games: 0, wins: 0 }, near: { games: 0, wins: 0 }, behind: { games: 0, wins: 0 } };
  for (const s of sides) {
    const gap = gapOf(s);
    if (gap !== null) add(league[bucketOf(gap)], s.won);
  }
  const level = league.near.games > 0 ? league.near.wins / league.near.games : 0.5;
  const leagueRate = (b: Bucket) => (league[b].games > 0 ? league[b].wins / league[b].games : level);

  const bySide = new Map<FormationGroup, SideRow[]>();
  for (const s of sides) {
    const g = groupOf.get(keyOf(s.heroes));
    if (g) bySide.set(g, [...(bySide.get(g) ?? []), s]);
  }

  const profiles = new Map<string, FormationProfile>();
  const rowOf = new Map<FormationGroup, GroupRow>();
  for (const g of groups) {
    const own = bySide.get(g) ?? [];

    const gapRecords = { ahead: { games: 0, wins: 0 }, near: { games: 0, wins: 0 }, behind: { games: 0, wins: 0 }, unknown: { games: 0, wins: 0 } };
    let shiftTotal = 0;
    let gapGames = 0;
    for (const s of own) {
      const gap = gapOf(s);
      if (gap === null) add(gapRecords.unknown, s.won);
      else {
        const bucket = bucketOf(gap);
        add(gapRecords[bucket], s.won);
        shiftTotal += leagueRate(bucket) - level;
        gapGames += 1;
      }
    }
    const gapAdjustment = gapGames === 0 ? null : { games: gapGames, shift: round(-shiftTotal / gapGames) };

    const vs = new Map<string, { enemy: string[]; record: Tally }>();
    for (const s of own) {
      const enemy = enemyGroupOf.get(keyOf(formations.get(`${s.attemptId}/${s.side === 'A' ? 'B' : 'A'}`) ?? []));
      if (!enemy) continue;
      const entry = vs.get(coreKey(enemy)) ?? { enemy: names(enemy.core), record: { games: 0, wins: 0 } };
      add(entry.record, s.won);
      vs.set(coreKey(enemy), entry);
    }
    const matchups = [...vs.values()]
      .filter((m) => m.record.games >= MATCHUP_MIN_GAMES)
      .map((m) => ({ enemy: m.enemy, ...rate(m.record) }))
      .sort((a, b) => b.games - a.games || a.enemy.join().localeCompare(b.enemy.join()));
    const strongAgainst = matchups.filter((m) => m.winRate >= STRONG_FROM);
    const weakAgainst = matchups.filter((m) => m.winRate <= WEAK_UP_TO);

    const playerGames = new Map<string, number>();
    for (const s of own) if (s.playerId !== null) playerGames.set(s.playerId, (playerGames.get(s.playerId) ?? 0) + 1);
    const labels = evidenceLabels({
      games: g.games,
      wins: g.wins,
      playerGames: [...playerGames.values()],
      strongAgainst: strongAgainst.map((m) => m.enemy.join(' + ')),
      gapAdjustment,
    });

    const artifacts = new Map<string, Tally>();
    for (const s of own) if (s.artifact !== null) add(artifacts.get(s.artifact) ?? artifacts.set(s.artifact, { games: 0, wins: 0 }).get(s.artifact)!, s.won);

    const artifactRows = [...artifacts]
      .map(([artifact, r]) => ({ artifact, ...rate(r), share: round(r.games / g.games) }))
      .sort((a, b) => b.games - a.games || a.artifact.localeCompare(b.artifact));
    const top = artifactRows[0];
    const row: GroupRow = { ...g, vsAverage: round(g.winRate - baseline), artifact: top ? { artifact: top.artifact, share: top.share } : null, labels };
    rowOf.set(g, row);
    profiles.set(coreKey(g), {
      ...row,
      placement: placementOf(own, [...g.core, ...g.flex].map((h) => h.hero)),
      artifacts: artifactRows,
      variations: g.variants.filter((v) => v.games >= VARIATION_MIN_GAMES).map((v) => ({ flex: v.flex, ...rate({ games: v.games, wins: v.wins }) })),
      otherLineups: g.variants.filter((v) => v.games < VARIATION_MIN_GAMES).map((v) => ({ heroes: v.heroes, ...rate({ games: v.games, wins: v.wins }) })),
      heroImpact: g.flex.map(({ hero }) => {
        const withHero: Tally = { games: 0, wins: 0 };
        const without: Tally = { games: 0, wins: 0 };
        for (const v of g.variants) {
          const target = v.heroes.includes(hero) ? withHero : without;
          target.games += v.games;
          target.wins += v.wins;
        }
        return { hero, with: rate(withHero), without: rate(without) };
      }),
      strongAgainst,
      weakAgainst,
      gapRecords,
      gapAdjustment,
    });
  }

  const rows: ReportArchetype[] = formationArchetypes(groups).map((a) => ({ ...a, groups: a.groups.map((g) => rowOf.get(g)!) }));
  return { baseline, rows, profiles };
}

/** The Formation groups under their Archetype rows, each with its win rate against the average of all sides and its evidence labels. */
export function formationReport(db: Database.Database, filters: StatFilters & { hero?: string | string[] } = {}) {
  const { baseline, rows } = analyse(db, filters);
  return { baseline, rows };
}

/** The profile of the Formation group whose Core heroes are these, or null when there is none. */
export function formationProfile(db: Database.Database, core: string[], filters: StatFilters = {}): FormationProfile | null {
  return analyse(db, filters).profiles.get([...core].sort().join('/')) ?? null;
}
