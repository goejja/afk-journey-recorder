import { validateHeroState, type HeroStateRules } from './hero-state.js';
import { MAX_STANDARD_HEROES } from './formation.js';
import { TILE } from './map.js';
import { checkFactionRequirement, checkPhantimalPartner, checkUnits, heroCount, isSummon } from './units.js';

export const ARENA_MODES = ['Arena', 'Supreme Arena', 'Super League', 'Guild Duel', 'Treasure Rush'] as const;
export type ArenaMode = (typeof ARENA_MODES)[number];

/**
 * The PvP modes that let one Phantimal join the team. Arena never does. Treasure Rush does: every recorded Treasure Rush fight of the
 * owner's carries one, and no plain Arena fight does (ADR 0029).
 */
const PHANTIMAL_MODES: ReadonlySet<string> = new Set(['Supreme Arena', 'Super League', 'Guild Duel', 'Treasure Rush']);

export const modeAllowsPhantimal = (mode: string): boolean => PHANTIMAL_MODES.has(mode);

/** Every mode a record can have: the Arena-type modes and the two others. */
export const RECORD_MODES = ['Stage', 'Dream Hunt', ...ARENA_MODES] as const;

/** The modes the Counter Advisor covers. */
export const ADVISOR_MODES = ['Arena', 'Supreme Arena', 'Super League'] as const;

/** The modes where each artifact goes on one team of a battle only, like each hero. */
export const ARTIFACT_ONCE_MODES: readonly ArenaMode[] = ['Supreme Arena', 'Super League', 'Guild Duel'];

/** How many teams (and so battles) one contest of each mode has. */
export const TEAMS_PER_MODE: Record<ArenaMode, number> = { Arena: 1, 'Supreme Arena': 3, 'Super League': 5, 'Guild Duel': 3, 'Treasure Rush': 1 };

/** The modes fought on one map only: the map is not chosen, and any other is refused. */
export const FIXED_MAP: Partial<Record<ArenaMode, string>> = { 'Treasure Rush': 'Arena I' };

/** The error for a map that is not the fixed map of its mode, or null (also for a mode that can be fought anywhere). */
export function checkFixedMap(mode: string, mapName: unknown): string | null {
  const fixed = FIXED_MAP[mode as ArenaMode];
  return fixed === undefined || mapName === fixed ? null : `${mode} is fought on ${fixed} only`;
}

/** The highest Union Level a Guild Duel side can have, as far as is known; the level is a whole number from 0. */
export const UNION_LEVEL_MAX = 100;

/** Returns an error message, or null. A Union Level is optional: an opponent's may be unknown. */
export function validateUnionLevel(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > UNION_LEVEL_MAX) return `${label} goes from 0 to ${UNION_LEVEL_MAX}`;
  return null;
}

/** Heroes already taken by the other teams of the same contest, so the form can grey them out. */
export function heroesAlreadyUsed(formations: { heroes: string[]; assist: string | null }[]): Set<string> {
  const used = new Set<string>();
  for (const f of formations) {
    for (const hero of f.heroes) used.add(hero);
    if (f.assist) used.add(f.assist);
  }
  return used;
}

/** The first hero that two teams of one battle both field, or null. Each hero plays on one team only in Supreme Arena, Super League and Guild Duel. */
export function sharedHero(teams: { heroes: string[]; assist: string | null }[]): { hero: string; first: number; second: number } | null {
  const seen = new Map<string, number>();
  for (const [index, team] of teams.entries()) {
    for (const hero of new Set([...team.heroes, ...(team.assist ? [team.assist] : [])])) {
      const earlier = seen.get(hero);
      if (earlier !== undefined) return { hero, first: earlier, second: index };
      seen.set(hero, index);
    }
  }
  return null;
}

export interface OpponentContext {
  cells: number[];
  knownHeroes: Set<string>;
  artifacts: Set<string>;
  /** Whether this mode lets one Phantimal join the enemy team. */
  phantimalAllowed: boolean;
  /** Every phantimal; Arena does not limit them to one season. */
  phantimals: Set<string>;
  /** The faction of each hero and of each Phantimal, for the Faction Requirement (ADR 0029). */
  heroFactions: Map<string, string | null>;
  phantimalFactions: Map<string, string | null>;
  rules: HeroStateRules;
}

/** Returns an error message, or null. Unlike Side A, only heroes and tiles are required. */
export function validateOpponent(input: any, ctx: OpponentContext): string | null {
  if (!Array.isArray(input?.heroes) || input.heroes.length < 1) return 'Enter at least one Side B hero';
  if (heroCount(input.heroes) > MAX_STANDARD_HEROES) return `At most ${MAX_STANDARD_HEROES} Side B heroes`;
  const tiles = new Set<number>();
  const names = new Set<string>();
  for (const placed of input.heroes) {
    if (typeof placed?.hero !== 'string' || !ctx.knownHeroes.has(placed.hero)) return `Unknown Side B hero "${String(placed?.hero)}"`;
    if (!Number.isInteger(placed.tile) || ctx.cells[placed.tile] !== TILE.ENEMY) return `${placed.hero} must stand on an enemy deployment tile`;
    if (tiles.has(placed.tile)) return `Tile ${placed.tile + 1} is used twice`;
    tiles.add(placed.tile);
    names.add(placed.hero);
    // A summon has no rank or equipment to check.
    const stateError = isSummon(placed) ? null : validateHeroState({ rank: placed.rank ?? null, equipmentLevel: placed.equipmentLevel ?? null }, ctx.rules);
    if (stateError) return `${placed.hero}: ${stateError}`;
  }
  const unitsError = checkUnits(input.heroes);
  if (unitsError) return unitsError;
  if (input.assistHero) {
    if (typeof input.assistHero !== 'string' || !ctx.knownHeroes.has(input.assistHero)) return 'Unknown Side B assist hero';
    if (names.has(input.assistHero)) return 'The Side B assist hero cannot also be placed on the map';
    const stateError = validateHeroState({ rank: input.assistRank ?? null, equipmentLevel: input.assistEquipmentLevel ?? null }, ctx.rules);
    if (stateError) return `${input.assistHero}: ${stateError}`;
  }
  if (input.phantimal !== null && input.phantimal !== undefined) {
    const phantimal = input.phantimal as { tile: number; name: string; partnerTile?: number | null };
    if (!ctx.phantimalAllowed) return 'This battle does not allow a phantimal';
    if (typeof phantimal.name !== 'string' || !ctx.phantimals.has(phantimal.name)) return `Unknown Side B phantimal "${String(phantimal.name)}"`;
    if (!Number.isInteger(phantimal.tile) || ctx.cells[phantimal.tile] !== TILE.ENEMY) return `${phantimal.name} must stand on an enemy deployment tile`;
    if (tiles.has(phantimal.tile)) return `Tile ${phantimal.tile + 1} is used twice`;
    tiles.add(phantimal.tile);
    const partnerError = checkPhantimalPartner(phantimal, (tile, label) => {
      if (!Number.isInteger(tile) || ctx.cells[tile] !== TILE.ENEMY) return `${label} must stand on an enemy deployment tile`;
      if (tiles.has(tile)) return `Tile ${tile + 1} is used twice`;
      tiles.add(tile);
      return null;
    });
    if (partnerError) return partnerError;
    const factionError = checkFactionRequirement(input.heroes, phantimal.name, ctx.phantimalFactions.get(phantimal.name), ctx.heroFactions);
    if (factionError) return factionError;
  }
  if (input.artifact && !ctx.artifacts.has(input.artifact)) return `Unknown artifact "${String(input.artifact)}"`;
  return null;
}
