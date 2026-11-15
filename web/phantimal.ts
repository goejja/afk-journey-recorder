import { checkFactionRequirement, PAIR_PHANTIMALS } from '../src/domain/units.js';
import { firstFreeTile, type PlacedPhantimal, type PlacedRow } from './units.js';

/** A Phantimal the editor may offer: its name and faction (the season filter is applied before it gets here). */
export interface PhantimalOption {
  name: string;
  faction: string | null;
}

/** The Phantimals whose Faction Requirement the team meets: at most those of the one faction three or more heroes share (ADR 0029). */
export function eligiblePhantimals(placed: PlacedRow[], options: PhantimalOption[], heroFactions: Map<string, string | null>): string[] {
  const heroes = placed.map((p) => ({ hero: p.hero }));
  return options.filter((option) => checkFactionRequirement(heroes, option.name, option.faction, heroFactions) === null).map((option) => option.name);
}

/** The team state a Phantimal is derived for. */
export interface WithPhantimal {
  placed: PlacedRow[];
  phantimal: PlacedPhantimal | null;
  /** The Phantimal the player chose; it stands only while the team meets its Faction Requirement. */
  phantimalChoice?: string;
}

/**
 * Makes the chosen Phantimal stand exactly while the team's heroes bring it: placed on its own tiles when they are free, else
 * on the first free tiles of the zone, and gone when the heroes no longer meet its Faction Requirement or it does not fit
 * (ADR 0029). The player's choice is kept, so the Phantimal comes back with the third matching hero.
 */
export function derivePhantimal<T extends WithPhantimal>(value: T, cells: number[], zone: number, options: PhantimalOption[], heroFactions: Map<string, string | null>): T {
  const choice = value.phantimalChoice ?? '';
  // A Phantimal this season or mode does not offer at all is no choice to keep: it would leave the picker blank.
  if (choice !== '' && !options.some((option) => option.name === choice)) {
    return value.phantimal === null && !value.phantimalChoice ? value : { ...value, phantimal: null, phantimalChoice: '' };
  }
  if (!choice || !eligiblePhantimals(value.placed, options, heroFactions).includes(choice)) {
    return value.phantimal === null ? value : { ...value, phantimal: null };
  }
  const current = value.phantimal?.name === choice ? value.phantimal : null;
  const taken = (tile: number) => value.placed.some((p) => p.tile === tile);
  const keepsTiles = current !== null && !taken(current.tile) && (current.partnerTile == null || !taken(current.partnerTile));
  if (keepsTiles) return value;
  const tile = firstFreeTile(cells, zone, taken);
  if (tile === null) return value.phantimal === null ? value : { ...value, phantimal: null };
  if (!PAIR_PHANTIMALS[choice]) return { ...value, phantimal: { name: choice, tile } };
  const partnerTile = firstFreeTile(cells, zone, (t) => t === tile || taken(t));
  // A pair stands together: with no room for the second part the Phantimal does not appear.
  return { ...value, phantimal: partnerTile === null ? null : { name: choice, tile, partnerTile } };
}