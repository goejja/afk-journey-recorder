import { describe, expect, it } from 'vitest';
import { partnersAt } from '../../src/domain/partner-relation.js';

const units = (tiles: Record<string, number>) => Object.entries(tiles).map(([hero, tile]) => ({ hero, tile }));

describe('partnersAt', () => {
  // Tile 40 is the middle of the row of tiles 38 to 42; its neighbours toward the back are 43 (behind) and 44, the one beside it on its left is 39.
  it('names the tile behind, in front, and the six around', () => {
    expect(partnersAt('behind', 40, units({ a: 43, b: 44, c: 39 }))).toEqual(['a']);
    expect(partnersAt('front', 40, units({ a: 35, b: 34, c: 43 }))).toEqual(['a']);
    expect(partnersAt('adjacent', 40, units({ a: 39, b: 41, c: 34, d: 35, e: 43, f: 44, far: 38, back: 28 })).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('has no mirror for the centre of a row, and flips the others', () => {
    expect(partnersAt('mirror', 40, units({ a: 38, b: 42 }))).toEqual([]);
    expect(partnersAt('mirror', 38, units({ a: 42, b: 41 }))).toEqual(['a']);
  });

  it('reaches Daimon’s first free tile: behind, else beside on the left, else behind on the right', () => {
    expect(partnersAt('daimon', 40, units({ behind: 43, left: 39, right: 44 }))).toEqual(['behind']);
    expect(partnersAt('daimon', 40, units({ left: 39, right: 44 }))).toEqual(['left']);
    expect(partnersAt('daimon', 40, units({ right: 44 }))).toEqual(['right']);
    expect(partnersAt('daimon', 40, units({ elsewhere: 35 }))).toEqual([]);
  });

  it('counts the allies within 2 steps, with a line down changing the position by half a tile', () => {
    expect(partnersAt('within2', 40, units({ one: 41, two: 38, up: 28, three: 37, far: 20 })).sort()).toEqual(['one', 'two', 'up']); // 28 is two lines straight up; 37 and 20 are three steps
  });

  it('takes the allies of the same diagonal game row, not those of the same editor line', () => {
    // A board read from the game's formation generator: only Senea shares Alna's game row, though Daimon and Zorya stand on her editor line
    expect(partnersAt('sameRow', 38, units({ kazim: 19, daimon: 40, zorya: 42, senea: 43 }))).toEqual(['senea']);
  });

  it('puts the rearmost allies from the back edge, by game row and then the right of a row', () => {
    const team = units({ kazim: 19, daimon: 40, zorya: 42, senea: 43 });
    expect(partnersAt('rearmost', 38, team)).toEqual(['senea']);
    expect(partnersAt('rearmost2', 38, team)).toEqual(['senea', 'daimon']);
  });
});
