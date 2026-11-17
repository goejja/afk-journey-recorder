/** The colours the game gives a rank, as the names of the `--rank-*` variables in web/styles.css. */
export type RankColour = 'rare' | 'elite' | 'epic' | 'legendary' | 'mythic' | 'supreme' | 'paragon-1' | 'paragon-2' | 'paragon-3' | 'paragon-4';

/** The rank colours from the weakest up: a "+" rank takes the colour of the next one for its corners. */
const COLOUR_ORDER: RankColour[] = ['rare', 'elite', 'epic', 'legendary', 'mythic', 'supreme', 'paragon-1'];

const BY_NAME: Record<string, RankColour> = {
  Rare: 'rare',
  Elite: 'elite',
  Epic: 'epic',
  Legendary: 'legendary',
  Mythic: 'mythic',
  Supreme: 'supreme',
  'Paragon 1': 'paragon-1',
  'Paragon 2': 'paragon-2',
  'Paragon 3': 'paragon-3',
  'Paragon 4': 'paragon-4',
};

export interface RankLook {
  fill: RankColour;
  /** The colour of the two small corners (bottom left, top right) of a "+" rank; null for the others. */
  corner: RankColour | null;
}

/**
 * How the game paints a rank: a plain rank is one colour, and a "+" rank is that colour with two small corners in the
 * colour of the next rank (Legendary+ is red with white corners). Null for a rank the game does not have.
 */
export function rankLook(rank: string): RankLook | null {
  const plus = rank.endsWith('+');
  const fill = BY_NAME[plus ? rank.slice(0, -1) : rank];
  if (!fill) return null;
  if (!plus) return { fill, corner: null };
  const at = COLOUR_ORDER.indexOf(fill);
  const next = at === -1 ? undefined : COLOUR_ORDER[at + 1];
  return next ? { fill, corner: next } : null;
}
