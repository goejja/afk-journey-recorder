import sharp from 'sharp';
import { BAND, BAND_START, TILE_WIDTH, type RawTile } from './star-count.js';

/** Where a hero tile lies in a picture, in pixels. */
export interface TileBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The band is cut this much wider than the tile on each side (a share of its width), so that a box a few pixels off sideways still holds every star. */
const SIDE_MARGIN = 0.07;

/**
 * The top band of a tile, scaled so that the tile itself is TILE_WIDTH wide. The band starts above the tile and reaches
 * past its sides: the star reader searches the whole band for the stars, so the box need not be exact.
 */
export async function tileBand(image: string | Buffer, box: TileBox): Promise<RawTile> {
  const { width: pictureWidth, height: pictureHeight } = await sharp(image).metadata();
  const margin = Math.round(box.width * SIDE_MARGIN);
  const left = Math.max(0, box.left - margin);
  const right = Math.min(pictureWidth!, box.left + box.width + margin);
  const top = Math.max(0, box.top + Math.round(box.height * BAND_START));
  const height = Math.min(pictureHeight! - top, Math.round(box.height * BAND));
  const { data, info } = await sharp(image)
    .extract({ left, top, width: right - left, height })
    .resize({ width: Math.round((TILE_WIDTH * (right - left)) / box.width), kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** The spread of grey levels (standard deviation) under which a tile is flat, an empty slot: a hero's portrait is far above it. */
const BLANK_SPREAD = 15;

/** Whether a tile's picture shows nothing: an empty slot is one flat colour, a portrait is not. */
export async function isBlank(tile: Buffer): Promise<boolean> {
  const { channels } = await sharp(tile).removeAlpha().stats();
  return channels.reduce((sum, c) => sum + c.stdev, 0) / channels.length < BLANK_SPREAD;
}
