/**
 * Arena maps where the game's editor data is wrong, with the tiles the player corrected them to
 * (45 tiles, row by row, left to right). The import uses these in place of the editor's version, so a
 * corrected map stays what Restore returns and a fresh database starts from it.
 */
export const MAP_CORRECTIONS: Record<string, number[]> = {
  'Arena V - Special': [-1,-1,-2,-2,-2,-2,-1,-1,-1,-1,-1,-1,-1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,-2,-2,-2,-2,1,1],
};
