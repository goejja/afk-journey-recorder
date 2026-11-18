import { mapColumns, ROW_LENGTHS } from '../src/domain/map.js';

/** The map of a record editor is drawn with tiles this wide, and the portrait on a tile fills this share of it. */
export const RECORD_TILE_WIDTH = 64;
export const RECORD_PORTRAIT_SIZE = Math.round(RECORD_TILE_WIDTH * 0.78);

/** The artifact drawn in the hexagon of an artifact slot of that map: about as big as a hero's portrait, so it fills the hexagon. */
export const RECORD_ARTIFACT_SIZE = 48;

/** The width of the map column of a record editor in pixels: the map and nothing more. `.two-col` in web/styles.css states the same number. */
export const RECORD_MAP_WIDTH = RECORD_TILE_WIDTH * mapColumns(ROW_LENGTHS);
