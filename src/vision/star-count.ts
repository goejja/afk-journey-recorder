import { readFileSync } from 'node:fs';
import type { StarColor } from '../domain/exclusive-weapon.js';
import { hsvOf } from './color.js';

/** A tile picture as raw 8-bit pixels (RGB or RGBA), already cut to one hero tile and scaled to TILE_WIDTH wide. */
export interface RawTile {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

/** Tiles are compared at this width, and only the top BAND of their height is read: the stars sit at the top. */
export const TILE_WIDTH = 300;
/** The band starts this far above the tile's top and is this tall (both as a share of the tile height), so that a box a few pixels off still holds the stars. */
export const BAND_START = -0.08;
export const BAND = 0.42;
/** The stars are looked for this far to either side of the tile's centre, in steps, to forgive a box that is off sideways. */
const SIDEWAYS = 24;
const SIDEWAYS_STEP = 4;
/** Where the stars usually lie in the band (a share of its height); positions further away must score better to win. */
const USUAL_ROW = 0.36;
const SIDEWAYS_COST = 0.05;
const ROW_COST = 0.1;

/** The stars are centred on the tile, one every STAR_PITCH of its width. */
const STAR_PITCH = 0.147 * TILE_WIDTH;
/** How much of the next slot beyond the stars may look like a star before the count is rejected. */
const OUTSIDE_WEIGHT = 0.5;
/** The colour is read this many rows either side of the row the stars were found on. */
const STAR_ROWS = 8;
/** Below this share of bright pixels the strip is plain background. */
const MIN_BRIGHT = 0.08;
/** Grey stars are present above this share of pale pixels; below this, gold can still mean yellow stars. */
const MIN_PALE = 0.045;
const STRONG_GOLD = 0.4;
const SOME_GOLD = 0.06;

interface Template {
  width: number;
  height: number;
  values: Float32Array;
}

/** The average star, measured from six-star tiles (mean removed). */
const template: Template = (() => {
  const raw = JSON.parse(readFileSync(new URL('./star-template.json', import.meta.url), 'utf8')) as { width: number; height: number; values: number[] };
  return { width: raw.width, height: raw.height, values: Float32Array.from(raw.values) };
})();

/** Brightness with a boost for blue: the grey stars are cyan-white, so they stand out from warm frames and skin. */
function featureImage(tile: RawTile): Float32Array {
  const out = new Float32Array(tile.width * tile.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * tile.channels;
    const r = tile.data[p]!;
    const g = tile.data[p + 1]!;
    const b = tile.data[p + 2]!;
    out[i] = 0.3 * r + 0.59 * g + 0.11 * b + 0.6 * (b - r);
  }
  return out;
}

/** Normalised cross-correlation of the template centred at (cx, cy); -1 where it does not fit or is flat. */
function correlation(image: Float32Array, width: number, height: number, cx: number, cy: number): number {
  const { width: w, height: h, values } = template;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  if (x0 < 0 || y0 < 0 || x0 + w > width || y0 + h > height) return -1;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = image[(y0 + y) * width + x0 + x]!;
      const b = values[y * w + x]!;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }
  const n = w * h;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  return va < 1e-6 || vb < 1e-6 ? -1 : (sab - (sa * sb) / n) / Math.sqrt(va * vb);
}

export interface StarCount {
  /** 1 to 6; the game draws one star at +0. */
  count: number;
  /** How well stars at that count's slots match the star template, 1 at best; low when the tile shows no stars at all. */
  score: number;
  /** How far the best count scored above the second best: small means the picture is ambiguous. */
  margin: number;
  /** The row (of the scaled tile) the stars were found on. */
  row: number;
}

/** Counts the grey stars of a tile by testing, for each count, whether stars match at the slots that count predicts and not just beyond them. */
export function countStars(tile: RawTile): StarCount {
  const image = featureImage(tile);
  const scores = new Map<number, number>();
  const rows = new Map<number, number>();
  for (let cy = Math.round(tile.height * 0.12); cy <= Math.round(tile.height * 0.88); cy += 2) for (let ox = -SIDEWAYS; ox <= SIDEWAYS; ox += SIDEWAYS_STEP) {
    // slots are half a pitch apart: odd counts sit on whole pitches from the centre, even counts on half pitches
    const at = new Map<number, number>();
    for (let m = -9; m <= 9; m++) at.set(m, correlation(image, tile.width, tile.height, tile.width / 2 + ox + (m * STAR_PITCH) / 2, cy));
    for (let n = 1; n <= 6; n++) {
      const slots = Array.from({ length: n }, (_, j) => 2 * j - (n - 1));
      const inside = slots.reduce((a, m) => a + at.get(m)!, 0) / n;
      const outside = ((at.get(slots[0]! - 2) ?? 0) + (at.get(slots[n - 1]! + 2) ?? 0)) / 2;
      const score = inside - Math.max(0, outside) * OUTSIDE_WEIGHT - SIDEWAYS_COST * (Math.abs(ox) / SIDEWAYS) - ROW_COST * Math.abs(cy / tile.height - USUAL_ROW) / 0.25;
      if (score > (scores.get(n) ?? -Infinity)) {
        scores.set(n, score);
        rows.set(n, cy);
      }
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return { count: ranked[0]![0], score: ranked[0]![1], margin: ranked[0]![1] - ranked[1]![1], row: rows.get(ranked[0]![0])! };
}

/**
 * The colour of the stars: grey, or purple, yellow, red or rainbow for the Resonance levels R1 to R4, from the share
 * of the bright pixels around the star row that fall in each hue family. The thresholds sit between the shares measured
 * on grey tiles and on purple (R1), yellow (R2) and rainbow (R4) tiles; red (R3) was measured later on cached pictures,
 * at 0.67 to 0.85 of the bright pixels. Too few bright pixels means the strip is plain background, not stars of any colour.
 */
export function starColor(tile: RawTile, row: number): StarColor {
  const share = hueShares(tile, row);
  if (share.bright < MIN_BRIGHT) return 'grey';
  if (share.yellow >= 0.55) return 'yellow';
  if (share.purple >= 0.5) return 'purple';
  if (share.red >= 0.5) return 'red';
  if (share.red >= 0.11 && share.yellow >= 0.12 && share.purple >= 0.25 && share.cyan >= 0.3) return 'rainbow';
  return 'grey';
}

/** The share of the bright pixels around the star row that fall in each hue family, and the share of the strip that is bright. */
function hueShares(tile: RawTile, row: number): { purple: number; yellow: number; red: number; cyan: number; bright: number } {
  const counts = { purple: 0, yellow: 0, red: 0, cyan: 0 };
  let bright = 0;
  let total = 0;
  const x0 = Math.round(tile.width * 0.07);
  const x1 = Math.round(tile.width * 0.93);
  for (let y = Math.max(0, row - STAR_ROWS); y <= Math.min(tile.height - 1, row + STAR_ROWS); y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      const p = (y * tile.width + x) * tile.channels;
      const [h, , v] = hsvOf(tile.data[p]!, tile.data[p + 1]!, tile.data[p + 2]!);
      if (v < 0.78) continue;
      bright++;
      if (h >= 250 && h < 335) counts.purple++;
      else if (h >= 25 && h < 75) counts.yellow++;
      else if (h >= 335 || (h >= 0 && h < 20)) counts.red++;
      else if (h >= 150 && h < 250) counts.cyan++;
    }
  }
  const n = Math.max(1, bright);
  return { purple: counts.purple / n, yellow: counts.yellow / n, red: counts.red / n, cyan: counts.cyan / n, bright: bright / Math.max(1, total) };
}

/** How much of the strip around the star row is pale blue-white, which is what grey stars are made of; plain backgrounds have next to none. */
function paleShare(tile: RawTile, row: number): number {
  let pale = 0;
  let total = 0;
  for (let y = Math.max(0, row - 10); y <= Math.min(tile.height - 1, row + 10); y++) {
    for (let x = Math.round(tile.width * 0.1); x < Math.round(tile.width * 0.9); x++) {
      total++;
      const p = (y * tile.width + x) * tile.channels;
      const r = tile.data[p]!;
      const g = tile.data[p + 1]!;
      const b = tile.data[p + 2]!;
      const max = Math.max(r, g, b);
      if (max > 215 && b >= r + 8 && (max - Math.min(r, g, b)) / max < 0.3) pale++;
    }
  }
  return pale / Math.max(1, total);
}

/** Saturated gold in the strip: the yellow stars of R2 (orange tile backgrounds reach a third of this share, so it only counts when high). */
function goldShare(tile: RawTile, row: number): number {
  let gold = 0;
  let total = 0;
  for (let y = Math.max(0, row - 10); y <= Math.min(tile.height - 1, row + 10); y++) {
    for (let x = Math.round(tile.width * 0.1); x < Math.round(tile.width * 0.9); x++) {
      total++;
      const p = (y * tile.width + x) * tile.channels;
      const [h, , v] = hsvOf(tile.data[p]!, tile.data[p + 1]!, tile.data[p + 2]!);
      const max = Math.max(tile.data[p]!, tile.data[p + 1]!, tile.data[p + 2]!);
      const min = Math.min(tile.data[p]!, tile.data[p + 1]!, tile.data[p + 2]!);
      if (v >= 0.85 && h >= 38 && h < 64 && (max - min) / max >= 0.28) gold++;
    }
  }
  return gold / Math.max(1, total);
}

export interface StarReading {
  /**
   * 'present' when the tile shows stars, 'absent' when it shows none (a hero below Supreme has no exclusive weapon), 'unsure'
   * when the strip could hold yellow stars or just a warm background: the review leaves such a tile unticked.
   */
  stars: 'present' | 'absent' | 'unsure';
  /** The exclusive weapon level (+0 to +25, or 26 to 29 for R1 to R4); null unless the stars are present. */
  level: number | null;
  color: StarColor;
  count: number;
  /** Low when the count is ambiguous; the review leaves such a level unticked. */
  margin: number;
}

/** Reads the weapon level of a tile: colored stars are a Resonance level, grey stars one level per star. */
export function readStars(tile: RawTile): StarReading {
  const { count, margin, row } = countStars(tile);
  const color = starColor(tile, row);
  const coloured = (c: Exclude<StarColor, 'grey'>): StarReading => ({ stars: 'present', level: 26 + (['purple', 'yellow', 'red', 'rainbow'] as const).indexOf(c), color: c, count: 6, margin: 1 });
  if (color === 'purple' || color === 'red' || color === 'rainbow') return coloured(color);
  const gold = goldShare(tile, row);
  if (color === 'yellow' && gold >= STRONG_GOLD) return coloured('yellow');
  if (paleShare(tile, row) >= MIN_PALE) return { stars: 'present', level: (count - 1) * 5, color: 'grey', count, margin };
  return { stars: color === 'grey' && gold < SOME_GOLD ? 'absent' : 'unsure', level: null, color: 'grey', count: 0, margin: 0 };
}
