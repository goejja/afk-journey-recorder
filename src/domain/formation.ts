import { TILE } from './map.js';
import { checkFactionRequirement, checkPhantimalPartner, checkUnits, heroCount } from './units.js';

export const MAX_STANDARD_HEROES = 5;

export interface FormationInput {
  heroes: unknown;
  phantimal: unknown;
  assistHero: unknown;
  artifact: unknown;
}

export interface FormationContext {
  cells: number[];
  /** Whether this kind of battle lets one phantimal join the heroes. */
  phantimalAllowed: boolean;
  ownedHeroes: Set<string>;
  artifacts: Set<string>;
  seasonPhantimals: Set<string>;
  /** The faction of each hero, for the Faction Requirement of a Phantimal (ADR 0029). */
  heroFactions: Map<string, string | null>;
  /** The faction of each Phantimal; a hero and a Phantimal may share a name, so it is a map of its own. */
  phantimalFactions: Map<string, string | null>;
}

interface Placement {
  tile: number;
}

/** Returns an error message, or null when the player's formation is valid for this stage. */
export function validateFormation(input: FormationInput, ctx: FormationContext): string | null {
  if (!Array.isArray(input.heroes) || input.heroes.length < 1) return 'Place at least one hero';
  if (heroCount(input.heroes as { hero: string }[]) > MAX_STANDARD_HEROES) return `At most ${MAX_STANDARD_HEROES} standard heroes can be placed`;

  const tiles = new Set<number>();
  const names = new Set<string>();
  const checkTile = (p: Placement, label: string): string | null => {
    if (!Number.isInteger(p.tile) || ctx.cells[p.tile] !== TILE.PLAYER) {
      return `${label} must stand on a player deployment tile`;
    }
    if (tiles.has(p.tile)) return `Tile ${p.tile + 1} is used twice`;
    tiles.add(p.tile);
    return null;
  };

  for (const hero of input.heroes as { tile: number; hero: string; part?: string | null }[]) {
    if (!hero || typeof hero.hero !== 'string') return 'Each hero needs a tile and a name';
    const tileError = checkTile(hero, hero.hero);
    if (tileError) return tileError;
    names.add(hero.hero);
    if (!ctx.ownedHeroes.has(hero.hero)) return `${hero.hero} is not in your roster`;
  }
  const unitsError = checkUnits(input.heroes as { hero: string; part?: string | null }[]);
  if (unitsError) return unitsError;

  if (input.phantimal !== null && input.phantimal !== undefined) {
    const phantimal = input.phantimal as { tile: number; name: string; partnerTile?: number | null };
    if (!ctx.phantimalAllowed) return 'This battle does not allow a phantimal';
    if (typeof phantimal.name !== 'string') return 'The phantimal needs a name';
    if (!ctx.seasonPhantimals.has(phantimal.name)) return `${phantimal.name} is not available in this season`;
    const tileError = checkTile(phantimal, phantimal.name);
    if (tileError) return tileError;
    const partnerError = checkPhantimalPartner(phantimal, (tile, label) => checkTile({ tile }, label));
    if (partnerError) return partnerError;
    const factionError = checkFactionRequirement(input.heroes as { hero: string }[], phantimal.name, ctx.phantimalFactions.get(phantimal.name), ctx.heroFactions);
    if (factionError) return factionError;
  }

  if (input.assistHero !== null && input.assistHero !== undefined) {
    if (typeof input.assistHero !== 'string' || !ctx.ownedHeroes.has(input.assistHero)) {
      return 'The assist hero must be in your roster';
    }
    if (names.has(input.assistHero)) return 'The assist hero cannot also be placed on the map';
  }

  if (input.artifact === null || input.artifact === undefined) return null;
  if (typeof input.artifact !== 'string' || !ctx.artifacts.has(input.artifact)) return `Unknown artifact "${String(input.artifact)}"`;
  return null;
}
