import { isDeploymentTile, TILE_CYCLE, TILE_LABELS, type TileType } from '../src/domain/map.js';
import { TileSwatch } from './HexMap.js';
import { Popover } from './ui/Popover.js';

/**
 * The type and the Boost of the tile clicked in the map editor, as two lists side by side next to it, like the rank and equipment of a
 * hero (`HeroStatePopover`). It stays open after a pick and closes when the person presses anywhere else. A tile that is not a
 * deployment tile has no Boost: the second list says so. The choices are the icons of the map's legend, named for a screen reader and a tooltip. Another type starts without a Boost, since a Boost belongs to one side.
 */
export function TilePopover({ anchor, index, tile, boosted, onChange, onClose }: {
  anchor: HTMLElement;
  /** The tile's number from 0, as the map stores it. */
  index: number;
  tile: number;
  boosted: boolean;
  onChange: (tile: number, boosted: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} label={`Type and Boost of tile ${index + 1}`} onClose={onClose}>
      <div className="popover-columns">
        <div className="popover-column" role="group" aria-label={`Type of tile ${index + 1}`}>
          <span className="popover-head">Tile</span>
          {TILE_CYCLE.map((type) => (
            <button key={type} type="button" aria-label={TILE_LABELS[type]} title={TILE_LABELS[type]} aria-pressed={type === tile} onClick={() => onChange(type, type === tile && boosted)}>
              <TileSwatch tile={type} />
            </button>
          ))}
        </div>
        <div className="popover-column" role="group" aria-label={`Boost of tile ${index + 1}`}>
          <span className="popover-head">Boost</span>
          {isDeploymentTile(tile) ? (
            <>
              <button type="button" aria-label="No boost" title="No boost" aria-pressed={!boosted} onClick={() => onChange(tile, false)}>
                <TileSwatch tile={tile as TileType} />
              </button>
              <button type="button" aria-label="Boost tile" title="Boost tile" aria-pressed={boosted} onClick={() => onChange(tile, true)}>
                <TileSwatch tile={tile as TileType} boosted />
              </button>
            </>
          ) : (
            <span className="popover-head">None on this tile</span>
          )}
        </div>
      </div>
    </Popover>
  );
}
