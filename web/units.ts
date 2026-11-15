import { MAX_STANDARD_HEROES } from '../src/domain/formation.js';
import { heroCount, isSummon, PAIR_HEROES, PAIR_PHANTIMALS, SUMMONS, partOf, unitsOf } from '../src/domain/units.js';
import type { Hero } from './backend.js';

/** A hero or unit standing on a tile, as the editors keep it. */
export interface PlacedRow {
  tile: number;
  hero: string;
  /** See `partOf` in src/domain/units.ts: '' or missing for a hero alone, a part name for a pair, the summon's name for a summon. */
  part?: string;
}

/** What the map and the lists call a placed row: its unit when it has one, else its hero. */
export const rowName = (p: { hero: string; part?: string | null }): string => partOf(p) || p.hero;

/** The hero and unit behind an icon of the selector. */
export function resolveUnit(name: string): { hero: string; part: string } {
  for (const [hero, parts] of Object.entries(PAIR_HEROES)) if (parts.includes(name)) return { hero, part: name };
  for (const [hero, summon] of Object.entries(SUMMONS)) if (summon.part === name) return { hero, part: name };
  return { hero: name, part: '' };
}

/**
 * The icons a hero selector shows: one per Hero (ADR 0028). A Pair Hero and a hero with Summons are one Hero, and their
 * Units are placed with it.
 */
export function selectorHeroes(heroes: Hero[]): Hero[] {
  return heroes;
}

/** The Units a hero puts on the board: the domain rule, so every layer places the same ones. */
export const unitParts = unitsOf;

/** Selector icons that cannot be placed now, mapped to why: already placed (any of its Units), or held elsewhere. */
export function unitsUnavailable(placed: PlacedRow[], unavailable?: Map<string, string>): Map<string, string> {
  const why = new Map(unavailable ?? []);
  for (const p of placed) why.set(p.hero, 'Already placed');
  return why;
}

/**
 * Adds every Unit of a hero: the first on `tile`, the rest on the first free tiles of `zone` in the order of `unitParts`.
 * A hero is never placed in part (ADR 0028): when its Units do not all fit, nothing is placed and the message says why.
 */
export function addHeroUnits<T extends PlacedRow>(
  placed: T[],
  hero: string,
  tile: number,
  cells: number[],
  zone: number,
  occupied: (tile: number) => boolean,
  make: (row: PlacedRow, siblings: T[]) => T,
): { placed: T[]; message: string | null } {
  if (placed.some((p) => p.hero === hero)) return { placed, message: `${hero} is already placed` };
  if (heroCount(placed) >= MAX_STANDARD_HEROES) return { placed, message: `At most ${MAX_STANDARD_HEROES} standard heroes can be placed` };
  const parts = unitParts(hero);
  if (occupied(tile)) return { placed, message: `Tile ${tile + 1} is taken` };
  const tiles = [tile];
  for (let i = 1; i < parts.length; i += 1) {
    const next = firstFreeTile(cells, zone, (t) => occupied(t) || tiles.includes(t));
    if (next === null) return { placed, message: `${hero} needs ${parts.length} free tiles; only ${tiles.length} ${tiles.length === 1 ? 'is' : 'are'} free` };
    tiles.push(next);
  }
  let next = placed;
  for (const [i, part] of parts.entries()) {
    const row: PlacedRow = { tile: tiles[i]!, hero, ...(part ? { part } : {}) };
    next = [...next, make(row, next.filter((p) => p.hero === hero))];
  }
  return { placed: next, message: null };
}

/** Adds the unit behind an icon to the placed rows, or says why not. `make` builds the row type of the caller. */
export function addUnit<T extends PlacedRow>(
  placed: T[],
  name: string,
  tile: number,
  make: (row: PlacedRow, siblings: T[]) => T,
): { placed: T[]; message: string | null } {
  const { hero, part } = resolveUnit(name);
  const row = { tile, hero, ...(part ? { part } : {}) };
  const summon = SUMMONS[hero];
  if (summon && part === summon.part) {
    if (!placed.some((p) => p.hero === hero && !partOf(p))) return { placed, message: `Place ${hero} first` };
    if (placed.filter((p) => isSummon(p) && p.hero === hero).length >= summon.count) return { placed, message: `${hero} has at most ${summon.count} ${summon.part}` };
  } else {
    if (placed.some((p) => p.hero === hero && partOf(p) === part)) return { placed, message: null };
    if (!placed.some((p) => p.hero === hero) && heroCount(placed) >= MAX_STANDARD_HEROES) {
      return { placed, message: `At most ${MAX_STANDARD_HEROES} standard heroes can be placed` };
    }
  }
  return { placed: [...placed, make(row, placed.filter((p) => p.hero === hero))], message: null };
}

/** Removes the unit on a tile. A pair goes as a whole, and so do a hero's summons with it, since neither stands alone. */
export function removeUnit<T extends PlacedRow>(placed: T[], tile: number): T[] {
  const row = placed.find((p) => p.tile === tile);
  if (!row) return placed;
  if (PAIR_HEROES[row.hero] || (SUMMONS[row.hero] && !partOf(row))) return placed.filter((p) => p.hero !== row.hero);
  return placed.filter((p) => p.tile !== tile);
}

/** The lowest-numbered tile of the given type that nothing stands on, or null when the zone is full. */
export function firstFreeTile(cells: number[], zone: number, taken: (tile: number) => boolean): number | null {
  const index = cells.findIndex((cell, tile) => cell === zone && !taken(tile));
  return index === -1 ? null : index;
}

/** The items with the ones on tiles `a` and `b` exchanged; with nothing on `b` this moves the one on `a` there. */
export function swapTiles<T extends { tile: number }>(items: T[], a: number, b: number): T[] {
  return items.map((item) => (item.tile === a ? { ...item, tile: b } : item.tile === b ? { ...item, tile: a } : item));
}

/** The unit still to place: the other part of a pair, or a summon of a hero on the map; null when nothing is missing. */
export function missingPart(placed: PlacedRow[]): string | null {
  for (const [hero, parts] of Object.entries(PAIR_HEROES)) {
    const have = placed.filter((p) => p.hero === hero).map(partOf);
    const part = have.length > 0 ? parts.find((x) => !have.includes(x)) : undefined;
    if (part) return part;
  }
  for (const [hero, summon] of Object.entries(SUMMONS)) {
    const here = placed.filter((p) => p.hero === hero);
    if (here.some((p) => !partOf(p)) && here.filter(isSummon).length < summon.count) return summon.part;
  }
  return null;
}

/** A placed phantimal; a pair (the Celestial wedges) also stands on a second tile, for its other part. */
export interface PlacedPhantimal {
  tile: number;
  name: string;
  partnerTile?: number | null;
}

/** Each part of a phantimal with the tile it stands on. */
export function phantimalParts(p: PlacedPhantimal | null | undefined): { tile: number; name: string }[] {
  if (!p) return [];
  const partner = PAIR_PHANTIMALS[p.name];
  return [{ tile: p.tile, name: p.name }, ...(partner && p.partnerTile != null ? [{ tile: p.partnerTile, name: partner }] : [])];
}

/** The name of the phantimal part standing on a tile, if any. */
export const phantimalAt = (p: PlacedPhantimal | null | undefined, tile: number): string | undefined => phantimalParts(p).find((part) => part.tile === tile)?.name;

/** The tile a named part of the phantimal stands on, if it is placed. */
export const phantimalTileOf = (p: PlacedPhantimal | null | undefined, name: string): number | undefined => phantimalParts(p).find((part) => part.name === name)?.tile;

/** The phantimal with the part `name` put on a tile: a pair's other part takes the second tile, any other pick replaces the phantimal. */
export function withPhantimalPart<T extends PlacedPhantimal>(existing: T | null, name: string, tile: number): PlacedPhantimal {
  if (existing && PAIR_PHANTIMALS[existing.name] === name) return { ...existing, partnerTile: tile };
  if (existing?.name === name) return { ...existing, tile };
  return { tile, name };
}

/** The part of a phantimal pair still to place, or null when it is whole or not a pair. */
export function missingPhantimalPart(p: PlacedPhantimal | null | undefined): string | null {
  const partner = p ? PAIR_PHANTIMALS[p.name] : undefined;
  return p && partner && p.partnerTile == null ? partner : null;
}

/** A phantimal pair with its second part on `tile` (when there is one) if that part is not placed yet. */
export function withPartnerOn<T extends PlacedPhantimal>(phantimal: T, tile: number | null): T {
  return missingPhantimalPart(phantimal) !== null && tile !== null ? { ...phantimal, partnerTile: tile } : phantimal;
}

/** A phantimal's tiles after tiles `a` and `b` were exchanged. */
export function swapPhantimal<T extends PlacedPhantimal>(phantimal: T | null, a: number, b: number): T | null {
  if (!phantimal) return null;
  const move = (t: number) => (t === a ? b : t === b ? a : t);
  return { ...phantimal, tile: move(phantimal.tile), ...(phantimal.partnerTile != null ? { partnerTile: move(phantimal.partnerTile) } : {}) };
}
