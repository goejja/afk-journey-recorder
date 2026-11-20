import type { LayoutUnit } from './layout.js';
import { PAIR_PHANTIMALS, unitsOf } from './units.js';

/**
 * A placement that is already known: a side of a record, with the map it was fought on and the Player behind it. Only what a
 * placement needs is here, so every layer (the web forms, the query CLI, the generator) can supply its own rows.
 */
export interface SavedPlacement<S = unknown> {
  /** The record it comes from; higher is newer. */
  attemptId: number;
  mapName: string | null;
  /** The Player behind the side, by Player ID, when it is known. */
  playerId?: string | null;
  units: LayoutUnit[];
  artifact?: string | null;
  /** Whether the side won its fight, for `order: 'won'`. */
  won?: boolean;
  /** What the caller carries along with the side (ranks, equipment, the whole saved side), handed back untouched with the match. */
  source?: S;
}

/** Where a team is to be placed. */
export interface PlacementTarget {
  mapName: string | null;
  /** The map's tiles, to check that a known placement fits and to find free ones; null when the map is unknown. */
  cells: number[] | null;
  /** The side's deployment kind (TILE.PLAYER or TILE.ENEMY). */
  zone: number;
  /** The heroes of the team: a Pair once. */
  heroes: string[];
  /** The Player the team belongs to. Without one nothing is reused: only the confirmed team or the first free tiles. */
  playerId?: string | null;
  /** Which of several matching records wins: the newest (the default), the earliest, for a Round Deployment that is not replaced once known (ADR 0021), or a side that won before one that lost, the newest of each (the Generated formation). */
  order?: 'newest' | 'earliest' | 'won';
}

/** A team confirmed for a Super League Round: its heroes and Artifact stand whatever the map; its tiles only when they fit. */
export interface ConfirmedTeam {
  units: LayoutUnit[];
  artifact?: string | null;
}

type PlacementTier = 'confirmed' | 'profile' | 'any' | 'free';

export interface ResolvedPlacement<S = unknown> {
  tier: PlacementTier;
  units: LayoutUnit[];
  artifact: string | null;
  /** The record the placement came from; null for a confirmed team and for first free tiles. */
  attemptId: number | null;
  /** The confirmed team's heroes and Artifact when only its tiles did not fit (tier `profile`, `any` or `free`). */
  fromConfirmed: boolean;
  /** The `source` of the record the placement came from; null for a confirmed team and for first free tiles. */
  source: S | null;
}

const heroesKey = (heroes: string[]) => [...new Set(heroes)].sort().join('|');
/** A team is its heroes: the Phantimal is not one of them (GLOSSARY, Phantimal). */
const sameHeroes = (units: { kind?: string; hero: string }[], heroes: string[]) =>
  heroesKey(units.filter((u) => u.kind !== 'phantimal').map((u) => u.hero)) === heroesKey(heroes);

/** Whether every Unit of the placement stands on its own tile of the zone, and a Phantimal pair has both its tiles. */
function fits(units: LayoutUnit[], target: PlacementTarget): boolean {
  const tiles = units.map((u) => u.tile);
  if (new Set(tiles).size !== tiles.length) return false;
  if (target.cells === null) return true;
  if (!tiles.every((tile) => target.cells![tile] === target.zone)) return false;
  // A pair Phantimal that lost its second tile is not the placement it was recorded as.
  for (const name of new Set(units.filter((u) => u.kind === 'phantimal').map((u) => u.hero))) {
    const own = units.filter((u) => u.kind === 'phantimal' && u.hero === name);
    if (PAIR_PHANTIMALS[name] && !own.some((u) => u.part !== '')) return false;
  }
  return true;
}

/** The first free tiles of the zone for the team's Units, in the order a hero places them. */
function firstFree(target: PlacementTarget): LayoutUnit[] {
  const used = new Set<number>();
  const tile = (): number | null => {
    if (target.cells === null) return null;
    const found = target.cells.findIndex((cell, index) => cell === target.zone && !used.has(index));
    return found === -1 ? null : found;
  };
  const units: LayoutUnit[] = [];
  for (const hero of target.heroes) {
    for (const part of unitsOf(hero)) {
      const next = tile();
      if (next === null) return [];
      used.add(next);
      units.push({ kind: 'hero', hero, part, tile: next });
    }
  }
  return units;
}

/**
 * Where a team already stood, by the rule of ADR 0030:
 * 1. its confirmed Round Deployment, when one is given;
 * 2. a record of the same Player with exactly the same heroes on the same Map;
 * 3. the same of any Player, when none of the Player's own matches;
 * 4. the first free tiles of the side.
 * A match needs every hero and the Map itself, never a lookalike team. The found placement brings all of a hero's Units.
 * A target with no Player ID reuses no record at all (tiers 2 and 3 are skipped), and several matches are taken newest first
 * unless `target.order` says earliest, or won first.
 */
export function resolveSavedPlacement<S = unknown>(target: PlacementTarget, records: SavedPlacement<S>[], confirmed?: ConfirmedTeam | null): ResolvedPlacement<S> {
  // A confirmed team is about who is fielded; the Map decides where. Its tiles are used only when they fit.
  const base = confirmed && sameHeroes(confirmed.units, target.heroes) ? confirmed : null;
  if (base && fits(base.units, target)) return { tier: 'confirmed', units: base.units, artifact: base.artifact ?? null, attemptId: null, fromConfirmed: false, source: null };
  const heroSide = (record: SavedPlacement) => sameHeroes(record.units, target.heroes);
  const onMap = (record: SavedPlacement) => (target.mapName === null ? true : record.mapName === target.mapName);
  const who = target.playerId?.toLowerCase() ?? null;
  const sign = target.order === 'earliest' ? 1 : -1;
  const wonFirst = (a: SavedPlacement<S>, b: SavedPlacement<S>) => (target.order === 'won' ? Number(b.won ?? false) - Number(a.won ?? false) : 0);
  const usable = who === null ? [] : records.filter((r) => heroSide(r) && onMap(r) && fits(r.units, target)).sort((a, b) => wonFirst(a, b) || sign * (a.attemptId - b.attemptId));
  const own = usable.find((r) => r.playerId?.toLowerCase() === who);
  const chosen = own ?? usable[0];
  if (chosen) {
    return {
      tier: own ? 'profile' : 'any',
      units: chosen.units,
      artifact: chosen.artifact ?? base?.artifact ?? null,
      attemptId: chosen.attemptId,
      fromConfirmed: false,
      source: chosen.source ?? null,
    };
  }
  return {
    tier: 'free',
    units: firstFree(target),
    artifact: base?.artifact ?? null,
    attemptId: null,
    fromConfirmed: base !== null,
    source: null,
  };
}

/** True when a team of these heroes was placed on this map before, though no placement of it fits the map now. */
export const knewHomelessPlacement = (target: PlacementTarget, records: SavedPlacement[]): boolean =>
  records.some((r) => sameHeroes(r.units, target.heroes) && (target.mapName === null || r.mapName === target.mapName));