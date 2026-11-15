import { useMemo, type ReactNode } from 'react';
import { nextTile, ROW_OFFSETS, TILE, TILE_CYCLE, TILE_LABELS, zoneEdges, type TileType } from '../src/domain/map.js';

const DEFAULT_TILE_WIDTH = 52;

/** The sizes of a map drawn with tiles `width` wide: pointy-top hexagons, each row overlapping the one above. */
const dimensions = (width: number) => {
  const height = Math.round(width * 1.1547);
  return { width, height, overlap: Math.round(height * 0.25) };
};
type Dimensions = ReturnType<typeof dimensions>;

const TILE_STYLE: Record<TileType, { className: string; glyph: string }> = {
  [TILE.OPEN]: { className: 'tile-open', glyph: '' },
  [TILE.PLAYER]: { className: 'tile-player', glyph: 'P' },
  [TILE.ENEMY]: { className: 'tile-enemy', glyph: 'E' },
  [TILE.WOOD_WALL]: { className: 'tile-wood', glyph: 'W' },
  [TILE.STONE_WALL]: { className: 'tile-stone', glyph: 'S' },
};

interface HexMapProps {
  rowLengths: number[];
  cells: number[];
  /** When set, clicking a tile asks for the next tile type at that index (map editing). */
  onChange?: (index: number, tile: TileType) => void;
  /** When set, clicking a clickable tile reports its index instead (placing units). */
  onTileClick?: (index: number) => void;
  /** With onTileClick: which tiles accept clicks. Defaults to all. */
  isClickable?: (index: number, tile: number) => boolean;
  /** Content drawn on a tile instead of its default letter, for example a portrait. */
  renderTile?: (index: number, tile: number) => ReactNode;
  /** Tooltip for a tile, for example the name of the unit standing on it. */
  tileTitle?: (index: number, tile: number) => string | undefined;
  /** Extra class for a tile, for example to dim the tiles you are not editing. */
  tileClassName?: (index: number, tile: number) => string | undefined;
  /** Tiles that accept a dragged unit; a drop on one reports its index. */
  canDrop?: (index: number, tile: number) => boolean;
  onTileDrop?: (index: number) => void;
  /** Tiles whose unit can be picked up and dropped on another tile; these report when such a drag starts and ends. */
  canDrag?: (index: number, tile: number) => boolean;
  onTileDragStart?: (index: number) => void;
  onTileDragEnd?: () => void;
  /** Artifact slots drawn as tiles of the grid: Side A's left of the bottom row, Side B's right of the top row. */
  slotA?: ReactNode;
  slotB?: ReactNode;
  /** Accessible name of the whole map, needed when a page shows more than one. */
  label?: string;
  /** Width of a tile in pixels, to draw a small map; defaults to 52. */
  tileWidth?: number;
}

/** Draws the outline of each deployment zone, and a faint line between its tiles. Only the outside of a connected zone is bright. */
function ZoneOutlines({ rowLengths, cells, size }: { rowLengths: number[]; cells: number[]; size: Dimensions }) {
  // The lattice of zoneEdges: x counts half tile widths, y counts quarter tile heights.
  const sx = size.width / 2;
  const sy = size.height / 4;
  const zones = useMemo(
    () =>
      [
        { tile: TILE.PLAYER, name: 'player' },
        { tile: TILE.ENEMY, name: 'enemy' },
      ].map((zone) => ({ ...zone, ...zoneEdges(rowLengths, cells, zone.tile) })),
    [rowLengths, cells],
  );
  if (zones.every((z) => z.outer.length === 0)) return null;
  const lines = (segments: [[number, number], [number, number]][], className: string) =>
    segments.map(([a, b], i) => <line key={`${className}${i}`} className={className} x1={a[0] * sx} y1={a[1] * sy} x2={b[0] * sx} y2={b[1] * sy} />);
  return (
    <svg className="zone-outlines" aria-hidden="true" width={size.width * 8} height={size.height + (rowLengths.length - 1) * (size.height - size.overlap)}>
      {zones.map((z) => lines(z.inner, `zone-inner zone-${z.name}`))}
      {zones.map((z) => lines(z.outer, `zone-outer zone-${z.name}`))}
    </svg>
  );
}

/** Where a tile of the grid sits: its row, and its offset in tiles from the left edge. */
const slotStyle = (size: Dimensions, row: number, offset: number) => ({ left: offset * size.width, top: 8 + row * (size.height - size.overlap), width: size.width, height: size.height });

/** Draws a map as staggered hex rows; clicking a tile steps it through the tile types. */
export function HexMap({ rowLengths, cells, onChange, onTileClick, isClickable, renderTile, tileClassName, tileTitle, canDrop, onTileDrop, canDrag, onTileDragStart, onTileDragEnd, slotA, slotB, label, tileWidth }: HexMapProps) {
  const size = dimensions(tileWidth ?? DEFAULT_TILE_WIDTH);
  let index = 0;
  return (
    <div className="hexmap" role="group" aria-label={label ?? 'Map'} style={{ width: size.width * 8 }}>
      {rowLengths.map((length, row) => {
        const start = index;
        index += length;
        return (
          <div
            key={row}
            className="hexrow"
            style={{ marginLeft: (ROW_OFFSETS[row] ?? 0) * size.width, marginTop: row === 0 ? 0 : -size.overlap }}
          >
            {cells.slice(start, start + length).map((tile, offset) => {
              const style = TILE_STYLE[tile as TileType] ?? TILE_STYLE[TILE.OPEN];
              const tileLabel = TILE_LABELS[tile as TileType] ?? 'Unknown';
              const tileIndex = start + offset;
              const interactive = onTileClick ? (isClickable?.(tileIndex, tile) ?? true) : Boolean(onChange);
              const content = renderTile?.(tileIndex, tile);
              const tip = tileTitle?.(tileIndex, tile);
              return (
                <span
                  key={offset}
                  className="hex-cell"
                  style={{ width: size.width, height: size.height }}
                  onDragOver={(e) => {
                    if (onTileDrop && canDrop?.(tileIndex, tile)) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (!onTileDrop || !canDrop?.(tileIndex, tile)) return;
                    e.preventDefault();
                    onTileDrop(tileIndex);
                  }}
                >
                  <button
                    type="button"
                    className={`hex ${style.className}${tileClassName?.(tileIndex, tile) ? ` ${tileClassName(tileIndex, tile)}` : ''}`}
                    style={{ width: size.width, height: size.height }}
                    title={tip ? undefined : interactive ? `${tileLabel} (click to change)` : tileLabel}
                    aria-label={`Tile ${tileIndex + 1}: ${tileLabel}`}
                    disabled={!interactive}
                    draggable={interactive && Boolean(canDrag?.(tileIndex, tile))}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(tileIndex)); // Firefox starts no drag without data
                      e.dataTransfer.effectAllowed = 'move';
                      onTileDragStart?.(tileIndex);
                    }}
                    onDragEnd={() => onTileDragEnd?.()}
                    onClick={() => (onTileClick ? onTileClick(tileIndex) : onChange?.(tileIndex, nextTile(tile)))}
                  >
                    {content ?? style.glyph}
                  </button>
                  {tip && (
                    <span className="tile-tip" role="tooltip">
                      {tip}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        );
      })}
      <ZoneOutlines rowLengths={rowLengths} cells={cells} size={size} />
      {slotA && <div className="map-slot" style={slotStyle(size, rowLengths.length - 1, (ROW_OFFSETS[rowLengths.length - 1] ?? 0) - 1)}>{slotA}</div>}
      {slotB && <div className="map-slot" style={slotStyle(size, 0, (ROW_OFFSETS[0] ?? 0) + (rowLengths[0] ?? 0))}>{slotB}</div>}
    </div>
  );
}

export function Legend() {
  return (
    <ul className="legend">
      {TILE_CYCLE.map((tile) => (
        <li key={tile}>
          <span className={`swatch ${TILE_STYLE[tile].className}`}>{TILE_STYLE[tile].glyph}</span> {TILE_LABELS[tile]}
        </li>
      ))}
    </ul>
  );
}
