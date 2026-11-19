import sharp from 'sharp';
import { meanDifference, nearestLabel } from './nearest.js';

/**
 * Hero reader: compares the art of a tile with Hero Looks, tiles whose hero the player confirmed, and answers with the hero of the
 * closest one. It gives the Agent's reading a second opinion and fills in what the Agent could not name. It knows nothing without examples.
 */

/** The part of a tile (cut by `withFrameTop`) that holds the character: no frame top, no stars, no rank line. Shares of its width and height. */
const REGION = { left: 0.15, top: 0.3, width: 0.7, height: 0.42 };
const SIZE = 24;

/** The mean difference (0 to 1 of a colour channel) under which a tile is taken for the example's hero. */
export const HERO_MAX_DISTANCE = 0.06;
/** How much closer the best hero's closest example must be than the closest example of any other hero, as a share of that distance. */
export const HERO_MARGIN = 0.25;

/**
 * The version of what `heroFeatures` computes. Vectors are stored with it (`hero_example_feature`, `hero_look_feature`), so a change to the
 * extractor, its region, size or weights must raise it, or the stored vectors would be compared with new ones. `tests/vision/hero-read.test.ts`
 * fails when the output for a fixed picture changes.
 */
export const HERO_FEATURES_VERSION = 1;

export type Features = Float32Array;

/** The character art of a tile picture (the PNG of a tile cut with its frame top) as a small grid of colours. */
export async function heroFeatures(tile: Buffer): Promise<Features> {
  const { width = 0, height = 0 } = await sharp(tile).metadata();
  const left = Math.round(width * REGION.left);
  const top = Math.round(height * REGION.top);
  const { data } = await sharp(tile)
    .extract({ left, top, width: Math.max(1, Math.round(width * REGION.width)), height: Math.max(1, Math.round(height * REGION.height)) })
    .resize({ width: SIZE, height: SIZE, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Float32Array.from(data, (v) => v / 255);
}

export interface HeroExample {
  hero: string;
  features: Features;
}

export const distance = meanDifference;

export interface HeroReading {
  hero: string;
  /** The distance to the closest example of that hero. */
  distance: number;
  /** The reader trusts its answer: a close example, and clearly closer than any other hero's. */
  confident: boolean;
}

export function readHero(features: Features, examples: HeroExample[]): HeroReading | null {
  const nearest = nearestLabel(features, examples, (e) => e.hero, distance);
  return nearest && { hero: nearest.label, distance: nearest.distance, confident: nearest.distance <= HERO_MAX_DISTANCE && nearest.margin >= HERO_MARGIN };
}
