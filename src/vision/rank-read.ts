import type { RankReading } from '../domain/roster-import.js';
import sharp from 'sharp';
import { hsvOf, type Hsv } from './color.js';
import { nearestLabel } from './nearest.js';

/**
 * Rank reader: the shape and colour of the top of a hero tile's frame tell the ranks above Supreme apart (wings, crown, flame), and
 * the Agent cannot read them. This compares the top of a tile with Rank Looks, tiles whose rank the player confirmed in a roster
 * import, and answers with the rank of the closest ones. It knows nothing without examples: with none it answers null.
 *
 * Besides the colours of the top, a tile is described by its ornament: a coloured shape standing out in the top centre of the frame
 * (Paragon 1 has a purple triangle, Paragon 2 and 3 a yellow or red fork, Paragon 4 a rainbow crown) while Supreme and Supreme+ have
 * none. The ornament is a few numbers, so that the stars and the hero's art, which fill the rest of the top, cannot outweigh it. The
 * ranks below Supreme are told by the background colour of the tile, measured the same way where the art does not hide it.
 */

/** The part of a tile cut by `withFrameTop` that holds the frame top and the stars: from its top down this share of its height. */
const TOP_SHARE = 0.4;
const WIDTH = 40;
const HEIGHT = 16;

/** The ranks that have fewer examples than this are not trusted: one example is a coincidence. */
export const MIN_EXAMPLES = 3;
/** The distance (the grid's mean colour difference, 0 to 1, plus the weighted ornament and background differences) above which the closest example is not close. Taken from the owner's 339 Rank Looks, each read from all the others: 0.15 with a margin of 0.3 reads 199 of them with 8 wrong, against 206 with 15 wrong before the background colours were added. */
export const RANK_MAX_DISTANCE = 0.15;
/** How much closer the best rank's closest example must be than the closest example of any other rank, as a share of that distance. */
export const RANK_MARGIN = 0.3;

/**
 * The version of what `rankFeatures` computes. Vectors are stored with it (`rank_look_feature`), so a change to the extractor, its sizes,
 * windows or weights must raise it, or the stored vectors would be compared with new ones. `tests/vision/rank-read.test.ts` fails when the
 * output for a fixed picture changes.
 */
export const FEATURES_VERSION = 1;

/** Features: the colours of the top as a small grid, then one ornament share per `ORNAMENTS` entry. */
export type Features = Float32Array;

/** The colours an ornament can have, as hue (degrees), saturation and value (0 to 1) windows. */
const ORNAMENTS: ((hsv: Hsv) => boolean)[] = [
  ([h, s, v]) => h >= 260 && h <= 310 && s > 0.35 && v > 0.45,
  ([h, s, v]) => h >= 38 && h <= 58 && s > 0.5 && v > 0.7,
  ([h, s, v]) => (h >= 350 || h <= 15) && s > 0.55 && v > 0.5,
];
/** How much one unit of ornament share weighs against the mean difference of the grid's colour channels (0 to 1). */
const ORNAMENT_WEIGHT = 0.2;
const GRID_LENGTH = WIDTH * HEIGHT * 3;

/**
 * Below Supreme the background colour of the tile is the rank (purple Elite, yellow Epic, red Legendary, white Mythic) and a "+" rank
 * has a tint of the next rank's colour in its top right and bottom left corners. The hero's art hides most of the background, so the
 * colour is measured where the art rarely reaches: the side margins and the two corners, as the share of each colour there.
 */
const BACKGROUNDS: ((hsv: Hsv) => boolean)[] = [
  ([h, s, v]) => h >= 250 && h <= 310 && s > 0.3 && v > 0.35,
  ([h, s, v]) => h >= 25 && h <= 55 && s > 0.5 && v > 0.6,
  ([h, s, v]) => (h >= 345 || h <= 15) && s > 0.55 && v > 0.4,
  ([, s, v]) => s < 0.2 && v > 0.8,
  ([h, s, v]) => h >= 170 && h < 250 && s > 0.3 && v > 0.35,
];
/** The regions of a tile picture (left, right, top, bottom as shares of its size) whose colours are measured. */
const BACKGROUND_REGIONS: [number, number, number, number][] = [
  [0.04, 0.12, 0.12, 0.8],
  [0.88, 0.96, 0.12, 0.8],
  [0.82, 0.96, 0.06, 0.16],
  [0.04, 0.18, 0.72, 0.86],
];
const BACKGROUND_WIDTH = 40;
const BACKGROUND_HEIGHT = 60;
/** How much one unit of background share weighs against the mean difference of the grid's colour channels (0 to 1). */
const BACKGROUND_WEIGHT = 0.05;
/** The ornament is looked for on a grid finer than the colour grid: its centre strip and the strips on both sides of it, as shares of the width. */
const ORNAMENT_WIDTH = 60;
const ORNAMENT_HEIGHT = 30;
const CENTRE: [number, number] = [0.44, 0.56];
const SIDES: [number, number][] = [[0.22, 0.34], [0.66, 0.78]];

/** The strip over which the width of a shape is measured, to tell the way it points. */
const SHAPE: [number, number] = [0.3, 0.7];
/** A row belongs to a shape when its centre strip holds this much more of the colour than the strips beside it. */
const STANDS_OUT = 0.2;

/**
 * Per ornament colour, the most the centre strip of one row of the top holds more of that colour than the strips beside it: a shape
 * that stands out from the frame, which runs the full width. A shape that points down (wider at its top than at its bottom) is the
 * bottom ornament of the tile above, seen in the crop: the ornaments of the frame point up, from the frame.
 */
const ornamentShares = (pixels: Buffer): number[] => {
  const share = (matches: (hsv: Hsv) => boolean, [from, to]: [number, number], y: number) => {
    let hits = 0;
    const start = Math.round(from * ORNAMENT_WIDTH);
    const end = Math.round(to * ORNAMENT_WIDTH);
    for (let x = start; x < end; x++) {
      const i = (y * ORNAMENT_WIDTH + x) * 3;
      if (matches(hsvOf(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!))) hits++;
    }
    return hits / (end - start);
  };
  return ORNAMENTS.map((matches) => {
    let best = 0;
    const stands: number[] = [];
    for (let y = 0; y < ORNAMENT_HEIGHT; y++) {
      const excess = share(matches, CENTRE, y) - Math.max(...SIDES.map((side) => share(matches, side, y)));
      best = Math.max(best, excess);
      if (excess >= STANDS_OUT) stands.push(y);
    }
    if (stands.length < 2) return best;
    const wider = (y: number) => share(matches, SHAPE, y);
    return wider(stands[stands.length - 1]!) < wider(stands[0]!) ? 0 : best;
  });
};

/** Per region of `BACKGROUND_REGIONS` and colour of `BACKGROUNDS`, the share of the region's pixels of that colour. */
const backgroundShares = (pixels: Buffer): number[] =>
  BACKGROUND_REGIONS.flatMap(([left, right, top, bottom]) => {
    const hits = BACKGROUNDS.map(() => 0);
    let total = 0;
    for (let y = Math.round(top * BACKGROUND_HEIGHT); y < Math.round(bottom * BACKGROUND_HEIGHT); y++) {
      for (let x = Math.round(left * BACKGROUND_WIDTH); x < Math.round(right * BACKGROUND_WIDTH); x++) {
        const i = (y * BACKGROUND_WIDTH + x) * 3;
        const hsv = hsvOf(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
        total++;
        BACKGROUNDS.forEach((matches, k) => {
          if (matches(hsv)) hits[k]!++;
        });
      }
    }
    return hits.map((n) => n / total);
  });

/** The frame top of a tile picture (the PNG of a tile cut with its frame top): its colours as a small grid, and its ornament. */
export async function rankFeatures(tile: Buffer): Promise<Features> {
  const { width = 0, height = 0 } = await sharp(tile).metadata();
  const top = () => sharp(tile).extract({ left: 0, top: 0, width, height: Math.max(1, Math.round(height * TOP_SHARE)) });
  const grid = await top().resize({ width: WIDTH, height: HEIGHT, fit: 'fill' }).removeAlpha().raw().toBuffer();
  const fine = await top().resize({ width: ORNAMENT_WIDTH, height: ORNAMENT_HEIGHT, fit: 'fill' }).removeAlpha().raw().toBuffer();
  const whole = await sharp(tile).resize({ width: BACKGROUND_WIDTH, height: BACKGROUND_HEIGHT, fit: 'fill' }).removeAlpha().raw().toBuffer();
  return Float32Array.from([...Array.from(grid, (v) => v / 255), ...ornamentShares(fine), ...backgroundShares(whole)]);
}

export interface RankExample {
  rank: string;
  features: Features;
}

export const distance = (a: Features, b: Features): number => {
  let grid = 0;
  for (let i = 0; i < GRID_LENGTH; i++) grid += Math.abs(a[i]! - b[i]!);
  let ornament = 0;
  for (let i = GRID_LENGTH; i < GRID_LENGTH + ORNAMENTS.length; i++) ornament += Math.abs(a[i]! - b[i]!);
  let background = 0;
  for (let i = GRID_LENGTH + ORNAMENTS.length; i < a.length; i++) background += Math.abs(a[i]! - b[i]!);
  return grid / GRID_LENGTH + ORNAMENT_WEIGHT * ornament + BACKGROUND_WEIGHT * background;
};

export function readRank(features: Features, examples: RankExample[], measure: (a: Features, b: Features) => number = distance): RankReading | null {
  const nearest = nearestLabel(features, examples, (e) => e.rank, measure);
  if (!nearest) return null;
  return {
    rank: nearest.label,
    distance: nearest.distance,
    margin: nearest.margin,
    support: nearest.support,
    confident: nearest.support >= MIN_EXAMPLES && nearest.distance <= RANK_MAX_DISTANCE && nearest.margin >= RANK_MARGIN,
  };
}
