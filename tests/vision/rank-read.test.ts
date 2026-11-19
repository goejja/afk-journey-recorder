import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FEATURES_VERSION, MIN_EXAMPLES, rankFeatures, readRank, type RankExample } from '../../src/vision/rank-read.js';

/** A tile picture: a top of one colour with a band of another, like a frame with an ornament, over a plain body. */
const tile = (top: [number, number, number], band: [number, number, number], shift = 0) =>
  sharp({ create: { width: 90, height: 150, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .composite([
      { input: { create: { width: 90, height: 40, channels: 3, background: { r: top[0], g: top[1], b: top[2] } } }, left: 0, top: 0 },
      { input: { create: { width: 50, height: 12, channels: 3, background: { r: band[0], g: band[1], b: band[2] } } }, left: 20 + shift, top: 6 },
    ])
    .png()
    .toBuffer();

const examples = async (rank: string, count: number, top: [number, number, number], band: [number, number, number]): Promise<RankExample[]> =>
  Promise.all(Array.from({ length: count }, async (_, i) => ({ rank, features: await rankFeatures(await tile(top, band, i % 3)) })));

describe('readRank', () => {
  it('knows nothing without examples', async () => {
    expect(readRank(await rankFeatures(await tile([250, 200, 0], [255, 255, 255])), [])).toBeNull();
  });

  it('answers with the rank of the closest looks, and is sure of one with enough examples', async () => {
    const known = [...(await examples('Paragon 4', MIN_EXAMPLES, [250, 200, 0], [255, 255, 255])), ...(await examples('Supreme+', MIN_EXAMPLES, [120, 60, 20], [200, 150, 90]))];
    const reading = readRank(await rankFeatures(await tile([250, 200, 0], [255, 255, 255], 1)), known);
    expect(reading).toMatchObject({ rank: 'Paragon 4', support: MIN_EXAMPLES, confident: true });
  });

  it('is not sure of a rank it has seen fewer than three times', async () => {
    const known = [...(await examples('Paragon 4', 2, [250, 200, 0], [255, 255, 255])), ...(await examples('Supreme+', MIN_EXAMPLES, [120, 60, 20], [200, 150, 90]))];
    expect(readRank(await rankFeatures(await tile([250, 200, 0], [255, 255, 255])), known)).toMatchObject({ rank: 'Paragon 4', support: 2, confident: false });
  });

  it('is not sure of a tile that looks like nothing it has seen', async () => {
    const known = await examples('Paragon 4', MIN_EXAMPLES, [250, 200, 0], [255, 255, 255]);
    expect(readRank(await rankFeatures(await tile([10, 20, 120], [0, 0, 0])), known)?.confident).toBe(false);
  });

  it('is not sure when two ranks look the same', async () => {
    const known = [...(await examples('Paragon 1', MIN_EXAMPLES, [250, 200, 0], [255, 255, 255])), ...(await examples('Paragon 2', MIN_EXAMPLES, [250, 200, 0], [255, 255, 255]))];
    expect(readRank(await rankFeatures(await tile([250, 200, 0], [255, 255, 255])), known)?.confident).toBe(false);
  });

  describe('the ornament in the top centre of the frame', () => {
    /** A frame top of one colour across the whole width, with or without a purple shape standing out in the middle. */
    const frame = (ornament: boolean | 'down', body: number) =>
      sharp({ create: { width: 90, height: 150, channels: 3, background: { r: body, g: body, b: body } } })
        .composite([
          { input: { create: { width: 90, height: 14, channels: 3, background: { r: 200, g: 140, b: 40 } } }, left: 0, top: 10 },
          ...(ornament === true ? [{ input: { create: { width: 12, height: 10, channels: 3 as const, background: { r: 150, g: 40, b: 200 } } }, left: 39, top: 2 }] : []),
          // wider at the top than at the bottom: the bottom ornament of the tile above, which is not the frame's
          ...(ornament === 'down'
            ? [10, 6, 3].map((width, i) => ({ input: { create: { width, height: 3, channels: 3 as const, background: { r: 150, g: 40, b: 200 } } }, left: 45 - Math.round(width / 2), top: 2 + i * 3 }))
            : []),
        ])
        .png()
        .toBuffer();
    const looks = async (rank: string, ornament: boolean | 'down') =>
      Promise.all([200, 205, 210].map(async (body) => ({ rank, features: await rankFeatures(await frame(ornament, body)) })));

    it('tells a frame with a purple shape standing out from one without, whatever the background behind', async () => {
      const known = [...(await looks('Paragon 1', true)), ...(await looks('Supreme+', false))];
      expect(readRank(await rankFeatures(await frame(true, 100)), known)?.rank).toBe('Paragon 1');
      expect(readRank(await rankFeatures(await frame(false, 100)), known)?.rank).toBe('Supreme+');
    });

    it('does not take a shape pointing down for the frame ornament', async () => {
      const known = [...(await looks('Paragon 1', true)), ...(await looks('Supreme+', false))];
      expect(readRank(await rankFeatures(await frame('down', 100)), known)?.rank).toBe('Supreme+');
    });
  });

  describe('the background colour of a tile below Supreme', () => {
    /** A tile with its background colour showing in the margins and corners, and the hero's art (a dark block) over the middle. */
    const tileOf = (background: [number, number, number], art: number) =>
      sharp({ create: { width: 90, height: 130, channels: 3, background: { r: background[0], g: background[1], b: background[2] } } })
        .composite([{ input: { create: { width: 50, height: 90, channels: 3, background: { r: art, g: art, b: art } } }, left: 20, top: 12 }])
        .png()
        .toBuffer();
    const looks = async (rank: string, background: [number, number, number], arts: number[]) =>
      Promise.all(arts.map(async (art) => ({ rank, features: await rankFeatures(await tileOf(background, art)) })));

    it('tells Epic from Legendary when the hero covers the middle, even if its art looks more like the other rank', async () => {
      // the Epic examples have bright art, the Legendary ones dark art: the tile's own art (80) sits closer to the Legendary ones
      const known = [...(await looks('Epic', [235, 160, 50], [190, 195, 200])), ...(await looks('Legendary', [200, 50, 45], [30, 35, 40]))];
      expect(readRank(await rankFeatures(await tileOf([235, 160, 50], 80)), known)?.rank).toBe('Epic');
      expect(readRank(await rankFeatures(await tileOf([200, 50, 45], 150)), known)?.rank).toBe('Legendary');
    });
  });
});

describe('rankFeatures', () => {
  // The vectors of Rank Looks are stored with FEATURES_VERSION (rank_look_feature). If this fails, the extractor now gives other numbers for
  // the same picture: raise FEATURES_VERSION, then update the numbers here, so that stored vectors are made again and never compared with new ones.
  it(`gives the numbers that version ${FEATURES_VERSION} of the extractor stands for`, async () => {
    const features = await rankFeatures(await tile([250, 200, 0], [120, 60, 160]));
    const weighted = features.reduce((sum, v, i) => sum + v * ((i % 17) + 1), 0);
    const sum = features.reduce((a, v) => a + v, 0);
    expect(features.length).toBe(1943);
    // within 1%, so that a new version of the image library rounding a pixel differently does not fail it, and a changed window or weight does
    expect(Math.abs(sum - 1229.14) / 1229.14).toBeLessThan(0.01);
    expect(Math.abs(weighted - 11071.7) / 11071.7).toBeLessThan(0.01);
  });
});
