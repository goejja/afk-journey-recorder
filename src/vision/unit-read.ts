import sharp from 'sharp';
import { meanDifference, nearestLabel } from './nearest.js';

/**
 * Unit reader: compares the crop of an artifact as a battle report draws it with Unit Looks, crops whose name the player kept, and answers
 * with the name of the closest. Only artifacts: the partner phantimals (Wedge of Matter and Wedge of Power) share a crop and were
 * confused by it in the first trial. It knows nothing without looks.
 */

/** The centre of the crop, as a share of its width and height: the icon without the ring or the background around it. */
const INNER = 0.8;
const SIZE = 16;

/** The mean difference (0 to 1 of a colour channel) under which a crop is taken for the look's name. */
const UNIT_MAX_DISTANCE = 0.04;
/** How much closer the best name's closest look must be than the closest look of any other name, as a share of that distance. */
const UNIT_MARGIN = 0.25;
/** The reader gives a name only once it has this many looks, as the rank reader does. */
const MIN_LOOKS = 3;
/** Two names with looks closer than this are told apart by the Agent: the reader confused them in the trial (Soulbound and Soulshock, 0.019). */
const LOOKALIKE = 0.03;

/**
 * The version of what `unitFeatures` computes. Vectors are stored with it (`unit_look_feature`), so a change to the extractor, its region or
 * size must raise it, or the stored vectors would be compared with new ones. `tests/vision/unit-read.test.ts` fails when the output for a
 * fixed picture changes.
 */
export const UNIT_FEATURES_VERSION = 1;

export type UnitFeatures = Float32Array;

export async function unitFeatures(crop: Buffer): Promise<UnitFeatures> {
  const { width = 0, height = 0 } = await sharp(crop).metadata();
  const { data } = await sharp(crop)
    .extract({ left: Math.round((width * (1 - INNER)) / 2), top: Math.round((height * (1 - INNER)) / 2), width: Math.max(1, Math.round(width * INNER)), height: Math.max(1, Math.round(height * INNER)) })
    .resize({ width: SIZE, height: SIZE, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Float32Array.from(data, (v) => v / 255);
}

export interface UnitExample {
  name: string;
  features: UnitFeatures;
}

const distance = meanDifference;

export interface UnitReading {
  name: string;
  /** The distance to the closest look of that name. */
  distance: number;
  /** The reader trusts its answer: enough looks, a close one, clearly closer than any other name's, and no look-alike name. */
  confident: boolean;
}

export function readUnit(features: UnitFeatures, examples: UnitExample[]): UnitReading | null {
  const nearest = nearestLabel(features, examples, (e) => e.name, distance);
  if (!nearest) return null;
  const own = examples.filter((e) => e.name === nearest.label);
  const alike = examples.some((other) => other.name !== nearest.label && own.some((e) => distance(e.features, other.features) < LOOKALIKE));
  return { name: nearest.label, distance: nearest.distance, confident: own.length >= MIN_LOOKS && nearest.distance <= UNIT_MAX_DISTANCE && nearest.margin >= UNIT_MARGIN && !alike };
}
