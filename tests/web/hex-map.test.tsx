// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ROW_LENGTHS, TILE, TILE_COUNT } from '../../src/domain/map.js';
import { HexMap } from '../../web/HexMap.js';
import { RECORD_MAP_WIDTH, RECORD_PORTRAIT_SIZE, RECORD_TILE_WIDTH } from '../../web/map-size.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
afterEach(cleanup);

describe('HexMap', () => {
  it('is as wide as its furthest row, 7 tiles, and its zone outlines are as wide as the map', () => {
    const { container } = render(<HexMap rowLengths={ROW_LENGTHS} cells={cells} />);
    expect(screen.getByRole('group', { name: 'Map' }).style.width).toBe(`${7 * 52}px`);
    expect(container.querySelector('svg.zone-outlines')?.getAttribute('width')).toBe(String(7 * 52));
  });

  it('follows the tile width it is given', () => {
    const { container } = render(<HexMap rowLengths={ROW_LENGTHS} cells={cells} tileWidth={RECORD_TILE_WIDTH} />);
    expect(screen.getByRole('group', { name: 'Map' }).style.width).toBe(`${RECORD_MAP_WIDTH}px`);
    expect(container.querySelector('svg.zone-outlines')?.getAttribute('width')).toBe(String(RECORD_MAP_WIDTH));
  });

  it('keeps the artifact slots inside the map', () => {
    render(<HexMap rowLengths={ROW_LENGTHS} cells={cells} tileWidth={RECORD_TILE_WIDTH} slotA={<span>A</span>} slotB={<span>B</span>} />);
    for (const name of ['A', 'B']) {
      const slot = screen.getByText(name).closest('.map-slot') as HTMLElement;
      expect(Number.parseFloat(slot.style.left) + Number.parseFloat(slot.style.width)).toBeLessThanOrEqual(RECORD_MAP_WIDTH);
    }
  });
});

describe('the record map size', () => {
  it('is 64 px tiles with a portrait of 78% of the tile, 7 tiles wide', () => {
    expect(RECORD_TILE_WIDTH).toBe(64);
    expect(RECORD_PORTRAIT_SIZE).toBe(50);
    expect(RECORD_MAP_WIDTH).toBe(448);
  });
});
