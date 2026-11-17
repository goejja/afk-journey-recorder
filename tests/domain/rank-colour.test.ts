import { describe, expect, it } from 'vitest';
import { rankLook } from '../../src/domain/rank-colour.js';

describe('rankLook', () => {
  it('paints a plain rank in its own colour with no corners', () => {
    expect(rankLook('Rare')).toEqual({ fill: 'rare', corner: null });
    expect(rankLook('Mythic')).toEqual({ fill: 'mythic', corner: null });
    expect(rankLook('Paragon 4')).toEqual({ fill: 'paragon-4', corner: null });
  });

  it('gives a "+" rank the corners of the next rank colour', () => {
    expect(rankLook('Elite+')).toEqual({ fill: 'elite', corner: 'epic' });
    expect(rankLook('Epic+')).toEqual({ fill: 'epic', corner: 'legendary' });
    expect(rankLook('Legendary+')).toEqual({ fill: 'legendary', corner: 'mythic' });
    expect(rankLook('Mythic+')).toEqual({ fill: 'mythic', corner: 'supreme' });
    expect(rankLook('Supreme+')).toEqual({ fill: 'supreme', corner: 'paragon-1' });
  });

  it('knows no look for a rank the game does not have', () => {
    expect(rankLook('Godlike')).toBeNull();
    expect(rankLook('Paragon 4+')).toBeNull();
    expect(rankLook('')).toBeNull();
  });
});
