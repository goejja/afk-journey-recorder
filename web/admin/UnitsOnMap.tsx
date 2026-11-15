import type { ComponentProps } from 'react';
import type { ImageKind } from '../Portrait.js';
import { HexMap } from '../HexMap.js';
import { Portrait } from '../Portrait.js';

/** What stands on a tile; `side` is "a" (the default) or "b", `title` defaults to the name. */
export interface MapUnit {
  kind: ImageKind;
  name: string;
  side?: 'a' | 'b';
  title?: string;
}

/** A map read only, with a portrait on each tile `unitAt` answers for. */
export function UnitsOnMap({ unitAt, portraitSize = 30, ...map }: { unitAt: (tile: number) => MapUnit | undefined; portraitSize?: number } & Pick<ComponentProps<typeof HexMap>, 'rowLengths' | 'cells' | 'label' | 'tileWidth' | 'slotA' | 'slotB'>) {
  return (
    <HexMap
      {...map}
      tileTitle={(index) => {
        const unit = unitAt(index);
        return unit && (unit.title ?? unit.name);
      }}
      renderTile={(index) => {
        const unit = unitAt(index);
        return unit ? (
          <span className={`map-unit map-unit-${unit.side ?? 'a'}`}>
            <Portrait kind={unit.kind} name={unit.name} size={portraitSize} />
          </span>
        ) : undefined;
      }}
    />
  );
}
