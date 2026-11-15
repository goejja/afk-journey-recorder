import { ROW_OFFSETS, TILE } from '../src/domain/map.js';
import type { GameMap } from './backend.js';

const HEIGHT = 1.1547; // a pointy-top hexagon one unit wide
const ROW_STEP = HEIGHT * 0.75;
/** The colours of the Maps page, from the same tokens as the full map. */
const FILL: Record<number, string> = {
  [TILE.OPEN]: 'var(--tile-open)',
  [TILE.PLAYER]: 'var(--side-a-thumb)',
  [TILE.ENEMY]: 'var(--side-b-thumb)',
  [TILE.WOOD_WALL]: 'var(--tile-wood)',
  [TILE.STONE_WALL]: 'var(--tile-stone)',
};

/**
 * A map drawn very small, terrain only, so that a layout can be recognised at a glance. `decorative` hides it from assistive
 * technology, for when the name is written beside it.
 */
export function MapThumb({ map, width = 72, decorative = false }: { map: Pick<GameMap, 'rowLengths' | 'cells' | 'name'>; width?: number; decorative?: boolean }) {
  const height = HEIGHT + (map.rowLengths.length - 1) * ROW_STEP;
  let index = 0;
  const hexes = map.rowLengths.flatMap((length, row) => {
    const start = index;
    index += length;
    return map.cells.slice(start, start + length).map((tile, col) => {
      const x = (ROW_OFFSETS[row] ?? 0) + col;
      const y = row * ROW_STEP;
      const points = [[x + 0.5, y], [x + 1, y + HEIGHT * 0.25], [x + 1, y + HEIGHT * 0.75], [x + 0.5, y + HEIGHT], [x, y + HEIGHT * 0.75], [x, y + HEIGHT * 0.25]];
      return <polygon key={start + col} points={points.map((p) => p.join(',')).join(' ')} fill={FILL[tile] ?? FILL[TILE.OPEN]} stroke="var(--bg)" strokeWidth={0.06} />;
    });
  });
  return (
    <svg className="map-thumb" viewBox={`0 0 8 ${height}`} width={width} height={Math.round((width * height) / 8)} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `Layout of ${map.name}` })}>
      {hexes}
    </svg>
  );
}
