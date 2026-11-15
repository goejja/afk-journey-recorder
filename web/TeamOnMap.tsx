import type { GameMap, GeneratedBoard } from './backend.js';
import { UnitsOnMap, type MapUnit } from './admin/UnitsOnMap.js';

/** A proposed team drawn on its map, every Unit on its tile (both parts of a pair, the summons, both wedge tiles). A suggested tile says so in its title. */
export function TeamOnMap({ board, map, label }: { board: GeneratedBoard; map: GameMap | undefined; label: string }) {
  if (!board.team) return null;
  if (!map) return <p className="muted">The map “{board.map}” no longer exists.</p>;
  const heroAt = new Map(board.team.filter((t) => t.tile !== null).map((t) => [t.tile!, t]));
  const units = new Map((board.units ?? []).map((u) => [u.tile, u]));
  const unitAt = (tile: number): MapUnit | undefined => {
    const unit = units.get(tile);
    if (unit) {
      const hero = heroAt.get(tile);
      return { kind: unit.kind, name: unit.part || unit.hero, title: hero?.source === 'engine' ? `${unit.part || unit.hero} (suggested tile)` : unit.part || unit.hero };
    }
    const hero = heroAt.get(tile);
    if (hero) return { kind: 'hero' as const, name: hero.hero, title: hero.source === 'engine' ? `${hero.hero} (suggested tile)` : hero.hero };
    const phantimal = board.phantimal;
    if (phantimal && phantimal.tile === tile) return { kind: 'phantimal' as const, name: phantimal.name, title: phantimal.name };
    return undefined;
  };
  return (
    <div className="battle-map">
      <UnitsOnMap rowLengths={map.rowLengths} cells={map.cells} label={label} unitAt={unitAt} />
    </div>
  );
}
