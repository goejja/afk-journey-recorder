import { backToFront, gameRowOf, relatedTile, rowOfTile, stepsBetween, tileAt, xOf } from './board.js';

/**
 * Where an ally can stand in relation to a hero, read from the start tiles of a side (a Side B tile turned over, so both sides read the
 * same way). They are the places the skills of the heroes point to; the statistic that counts them says who stood there, not who a skill reached.
 */
export const PARTNER_RELATIONS = ['behind', 'front', 'adjacent', 'within2', 'sameRow', 'mirror', 'rearmost', 'rearmost2', 'daimon'] as const;
export type PartnerRelation = (typeof PARTNER_RELATIONS)[number];

export const PARTNER_RELATION_TEXT: Record<PartnerRelation, string> = {
  behind: 'Behind it',
  front: 'In front of it',
  adjacent: 'Adjacent (the 6 tiles around)',
  within2: 'Within 2 tiles',
  sameRow: 'Same game row',
  mirror: 'Mirror tile',
  rearmost: 'Rearmost ally',
  rearmost2: 'Two rearmost allies',
  daimon: 'Behind, then beside (Daimon’s order)',
};

export const isPartnerRelation = (value: string): value is PartnerRelation => (PARTNER_RELATIONS as readonly string[]).includes(value);

interface Standing {
  hero: string;
  tile: number;
}

/** The tile at a step from a tile in the board's own frame (a line down is `+1`, a half tile across is `0.5`), or null off the board. */
const step = (tile: number, lines: number, across: number) => tileAt(rowOfTile(tile) + lines, xOf(tile) + across);

/** The tiles a relation names around a tile, in order, for the relations that name tiles. */
function tilesOf(relation: 'behind' | 'front' | 'adjacent' | 'mirror' | 'daimon', tile: number): (number | null)[] {
  switch (relation) {
    case 'behind': return [relatedTile('behind', tile, 'A')];
    case 'front': return [step(tile, -1, 0.5)];
    case 'mirror': return [relatedTile('mirror', tile, 'A')];
    case 'adjacent': return [step(tile, 0, -1), step(tile, 0, 1), step(tile, -1, -0.5), step(tile, -1, 0.5), step(tile, 1, -0.5), step(tile, 1, 0.5)];
    // Daimon's protection: the tile behind, else the one beside it on the left, else the one behind on the right (the owner's reading, 2026-11-17)
    case 'daimon': return [relatedTile('behind', tile, 'A'), step(tile, 0, -1), step(tile, 1, 0.5)];
  }
}

/** The allies in a relation to a hero standing on `tile`, among the other units of its side. For `daimon` that is the first one found, in the order of the tiles. */
export function partnersAt(relation: PartnerRelation, tile: number, others: Standing[]): string[] {
  const at = (tiles: (number | null)[]) => others.filter((u) => tiles.includes(u.tile)).map((u) => u.hero);
  switch (relation) {
    case 'behind':
    case 'front':
    case 'adjacent':
    case 'mirror':
      return at(tilesOf(relation, tile));
    case 'daimon': {
      for (const next of tilesOf('daimon', tile)) {
        const found = at([next]);
        if (found.length > 0) return found;
      }
      return [];
    }
    case 'within2': return others.filter((u) => stepsBetween(tile, u.tile) <= 2).map((u) => u.hero);
    case 'sameRow': return others.filter((u) => gameRowOf(u.tile, 'A') === gameRowOf(tile, 'A')).map((u) => u.hero);
    case 'rearmost':
    case 'rearmost2':
      return [...others].sort(backToFront('A')).slice(0, relation === 'rearmost' ? 1 : 2).map((u) => u.hero);
  }
}
