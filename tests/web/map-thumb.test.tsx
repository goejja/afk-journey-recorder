// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TILE } from '../../src/domain/map.js';
import { MapThumb } from '../../web/MapThumb.js';

afterEach(cleanup);

describe('MapThumb', () => {
  it('draws one hexagon per tile, coloured by tile type', () => {
    const cells = Array.from({ length: 45 }, (_, i) => (i === 0 ? TILE.ENEMY : i === 1 ? TILE.WOOD_WALL : i === 2 ? TILE.STONE_WALL : i === 44 ? TILE.PLAYER : TILE.OPEN));
    render(<MapThumb map={{ name: 'Test', rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells }} />);
    const hexes = [...screen.getByRole('img', { name: 'Layout of Test' }).querySelectorAll('polygon')];
    expect(hexes).toHaveLength(45);
    expect(new Set(hexes.map((h) => h.getAttribute('fill'))).size).toBe(5);
    expect(hexes[0]!.getAttribute('fill')).not.toBe(hexes[44]!.getAttribute('fill')); // enemy and player zones differ
  });
});
