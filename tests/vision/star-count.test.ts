import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countStars, readStars, starColor, TILE_WIDTH, BAND, type RawTile } from '../../src/vision/star-count.js';

/** A band as `tileBand` cuts it: a little wider than the tile (7% each side), with the stars near a third of the way down. */
const WIDTH = Math.round(TILE_WIDTH * 1.14);
const HEIGHT = Math.round(TILE_WIDTH * 1.3 * BAND);
const PITCH = 0.147 * TILE_WIDTH;

const template = JSON.parse(readFileSync(new URL('../../src/vision/star-template.json', import.meta.url), 'utf8')) as { width: number; height: number; values: number[] };
const peak = Math.max(...template.values);

/** How lit the pixel (x, y) is by a star centred on (cx, cy): the star's own shape, as the reader's template has it, from 0 to 1. */
function starAt(x: number, y: number, cx: number, cy: number): number {
  const tx = Math.round(x - cx + template.width / 2);
  const ty = Math.round(y - cy + template.height / 2);
  if (tx < 0 || ty < 0 || tx >= template.width || ty >= template.height) return 0;
  return Math.max(0, Math.min(1, (template.values[ty * template.width + tx]! / peak) * 1.4));
}

/** A dark tile top with `count` pale blue stars centred on it, one every pitch. */
function tileWithStars(count: number): RawTile {
  const soft = new Float32Array(WIDTH * HEIGHT);
  const cy = HEIGHT * 0.36;
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      for (let j = 0; j < count; j++) soft[y * WIDTH + x] = Math.max(soft[y * WIDTH + x]!, starAt(x, y, WIDTH / 2 + (j - (count - 1) / 2) * PITCH, cy));
  const data = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < soft.length; i++) data.set([40 + 175 * soft[i]!, 30 + 205 * soft[i]!, 70 + 185 * soft[i]!], i * 3);
  return { data, width: WIDTH, height: HEIGHT, channels: 3 };
}

const solid = (r: number, g: number, b: number): RawTile => {
  const data = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i++) data.set([r, g, b], i * 3);
  return { data, width: WIDTH, height: HEIGHT, channels: 3 };
};

describe('countStars', () => {
  it.each([1, 2, 3, 4, 5, 6])('counts %i stars', (n) => {
    expect(countStars(tileWithStars(n)).count).toBe(n);
  });
});

describe('readStars', () => {
  it('turns grey star counts into weapon levels, one star per +5 with one at +0', () => {
    expect(readStars(tileWithStars(1)).level).toBe(0);
    expect(readStars(tileWithStars(3)).level).toBe(10);
    expect(readStars(tileWithStars(6)).level).toBe(25);
  });

  it('reads yellow stars as R2 and purple as R1 whatever the count', () => {
    expect(readStars(solid(240, 200, 40))).toMatchObject({ level: 27, color: 'yellow' });
    expect(readStars(solid(170, 90, 240))).toMatchObject({ level: 26, color: 'purple' });
  });

  it('reads red stars as R3', () => {
    expect(readStars(solid(230, 40, 40))).toMatchObject({ level: 28, color: 'red' });
  });

  it('says a tile without stars has none, and a warm tile that could hold yellow stars is unsure', () => {
    expect(readStars(solid(40, 30, 70))).toMatchObject({ stars: 'absent', level: null });
    expect(readStars(solid(200, 120, 60))).toMatchObject({ stars: 'unsure', level: null });
  });

  it('reads a dark tile as grey', () => {
    expect(starColor(solid(20, 20, 30), 10)).toBe('grey');
  });
});
