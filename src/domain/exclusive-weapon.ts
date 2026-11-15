import type { EquipmentCap } from './hero-state.js';

/**
 * The levels of a hero's exclusive weapon that matter when recording a battle, as the game shows them
 * (see https://www.afk.global/afk-journey/exclusive-weapons). The last four are the Resonance levels
 * R1 to R4, stored as +26 to +29.
 */
export const WEAPON_LEVELS = [0, 5, 10, 15, 20, 25, 26, 27, 28, 29];

const FIRST_RESONANCE = 26;

/** The highest weapon level each rank allows; ranks below Mythic+ have no weapon. */
export const WEAPON_CAPS: EquipmentCap[] = [
  { rank: 'Mythic+', minLevel: null, maxLevel: 10 },
  { rank: 'Supreme', minLevel: null, maxLevel: 15 },
  { rank: 'Supreme+', minLevel: null, maxLevel: 25 },
  { rank: 'Paragon 1', minLevel: null, maxLevel: 26 },
  { rank: 'Paragon 2', minLevel: null, maxLevel: 27 },
  { rank: 'Paragon 3', minLevel: null, maxLevel: 28 },
  { rank: 'Paragon 4', minLevel: null, maxLevel: 29 },
];

/** What older versions stored for the Resonance levels (Yaphalla's steps of five), mapped to R1 to R4. */
export const OLD_RESONANCE_LEVELS: Record<number, number> = { 30: 26, 35: 27, 40: 28, 45: 29 };

/** How a level is written: +10, or R1 to R4 for the Resonance levels. */
export const weaponLabel = (level: number): string => (level >= FIRST_RESONANCE ? `R${level - FIRST_RESONANCE + 1}` : `+${level}`);

export type StarColor = 'grey' | 'purple' | 'yellow' | 'red' | 'rainbow';

/**
 * The stars the game draws for a level: one more for every +5 (two grey stars at +5 up to six at +25), and six
 * stars coloured purple, yellow, red and rainbow for R1 to R4. +0 follows the same pattern with one grey star.
 */
export function weaponStars(level: number): { count: number; color: StarColor } {
  if (level >= FIRST_RESONANCE) return { count: 6, color: (['purple', 'yellow', 'red', 'rainbow'] as const)[Math.min(level - FIRST_RESONANCE, 3)]! };
  return { count: Math.floor(level / 5) + 1, color: 'grey' };
}
