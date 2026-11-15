import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { heroFeatures, readHero, type HeroExample } from '../../src/vision/hero-read.js';

/** A tile picture: a plain frame around a character of one colour with a spot of another, in the middle where the hero reader looks. */
const tile = (body: [number, number, number], spot: [number, number, number], frame: [number, number, number] = [200, 200, 200]) =>
  sharp({ create: { width: 90, height: 150, channels: 3, background: { r: frame[0], g: frame[1], b: frame[2] } } })
    .composite([
      { input: { create: { width: 60, height: 60, channels: 3, background: { r: body[0], g: body[1], b: body[2] } } }, left: 15, top: 45 },
      { input: { create: { width: 20, height: 20, channels: 3, background: { r: spot[0], g: spot[1], b: spot[2] } } }, left: 35, top: 60 },
    ])
    .png()
    .toBuffer();

const example = async (hero: string, body: [number, number, number], spot: [number, number, number], frame?: [number, number, number]): Promise<HeroExample> => ({ hero, features: await heroFeatures(await tile(body, spot, frame)) });

describe('readHero', () => {
  it('knows nothing without examples', async () => {
    expect(readHero(await heroFeatures(await tile([10, 20, 30], [250, 250, 0])), [])).toBeNull();
  });

  it('names the hero of a tile that looks like one the player confirmed, whatever the frame around it', async () => {
    const known = [await example('Evie', [10, 20, 30], [250, 250, 0]), await example('Thador', [200, 30, 30], [20, 20, 200])];
    const reading = readHero(await heroFeatures(await tile([10, 20, 30], [250, 250, 0], [250, 120, 0])), known);
    expect(reading).toMatchObject({ hero: 'Evie', confident: true });
  });

  it('is not sure of a tile that looks like no hero it knows', async () => {
    const known = [await example('Evie', [10, 20, 30], [250, 250, 0])];
    expect(readHero(await heroFeatures(await tile([120, 220, 130], [10, 10, 10])), known)?.confident).toBe(false);
  });

  it('is not sure when two heroes look alike to it', async () => {
    const known = [await example('Evie', [10, 20, 30], [250, 250, 0]), await example('Thador', [10, 20, 32], [250, 250, 0])];
    expect(readHero(await heroFeatures(await tile([10, 20, 31], [250, 250, 0])), known)?.confident).toBe(false);
  });
});
