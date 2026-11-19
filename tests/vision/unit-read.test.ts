import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readUnit, UNIT_FEATURES_VERSION, unitFeatures, type UnitExample } from '../../src/vision/unit-read.js';

/** An artifact crop: a plain background around an icon of one colour with a spot of another, in the middle where the unit reader looks. */
const crop = (body: [number, number, number], spot: [number, number, number]) =>
  sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .composite([
      { input: { create: { width: 60, height: 60, channels: 3, background: { r: body[0], g: body[1], b: body[2] } } }, left: 20, top: 20 },
      { input: { create: { width: 20, height: 20, channels: 3, background: { r: spot[0], g: spot[1], b: spot[2] } } }, left: 40, top: 40 },
    ])
    .png()
    .toBuffer();

const looks = (name: string, count: number, body: [number, number, number], spot: [number, number, number]): Promise<UnitExample[]> =>
  Promise.all(Array.from({ length: count }, async () => ({ name, features: await unitFeatures(await crop(body, spot)) })));

describe('readUnit', () => {
  it('knows nothing without looks', async () => {
    expect(readUnit(await unitFeatures(await crop([10, 20, 30], [250, 250, 0])), [])).toBeNull();
  });

  it('names the artifact of a crop that looks like three the player kept', async () => {
    const known = [...(await looks('Bladestorm', 3, [10, 20, 30], [250, 250, 0])), ...(await looks('Coreforge', 3, [200, 30, 30], [20, 20, 200]))];
    expect(readUnit(await unitFeatures(await crop([10, 20, 30], [250, 250, 0])), known)).toMatchObject({ name: 'Bladestorm', confident: true });
  });

  it('is not sure of a name with fewer than three looks', async () => {
    const known = await looks('Bladestorm', 2, [10, 20, 30], [250, 250, 0]);
    expect(readUnit(await unitFeatures(await crop([10, 20, 30], [250, 250, 0])), known)?.confident).toBe(false);
  });

  it('is not sure of a crop that looks like no artifact it knows', async () => {
    const known = await looks('Bladestorm', 3, [10, 20, 30], [250, 250, 0]);
    expect(readUnit(await unitFeatures(await crop([120, 220, 130], [10, 10, 10])), known)?.confident).toBe(false);
  });

  it('leaves two names that look alike to the Agent', async () => {
    const known = [...(await looks('Soulbound', 3, [10, 20, 30], [250, 250, 0])), ...(await looks('Soulshock', 3, [10, 20, 36], [250, 250, 0]))];
    expect(readUnit(await unitFeatures(await crop([10, 20, 30], [250, 250, 0])), known)?.confident).toBe(false);
  });
});

describe('unitFeatures', () => {
  // The vectors of Unit Looks are stored with UNIT_FEATURES_VERSION (unit_look_feature). If this fails, the extractor now gives other numbers
  // for the same picture: raise UNIT_FEATURES_VERSION, then update the numbers here, so that stored vectors are made again and never compared
  // with new ones.
  it(`gives the numbers that version ${UNIT_FEATURES_VERSION} of the extractor stands for`, async () => {
    const features = await unitFeatures(await crop([10, 20, 30], [250, 250, 0]));
    const weighted = features.reduce((sum, v, i) => sum + v * ((i % 17) + 1), 0);
    const sum = features.reduce((a, v) => a + v, 0);
    expect(features.length).toBe(768);
    expect(Math.abs(sum - 325.49) / 325.49).toBeLessThan(0.01);
    expect(Math.abs(weighted - 2891.2) / 2891.2).toBeLessThan(0.01);
  });
});
