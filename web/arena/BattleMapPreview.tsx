import type { ArenaBattle, GameMap } from '../backend.js';
import { ArtifactSlot } from '../ArtifactSlot.js';
import { UnitsOnMap, type MapUnit } from '../admin/UnitsOnMap.js';
import { phantimalAt, rowName } from '../units.js';

/** A saved battle on its map: both formations where they stood, and each side's artifact. Read only. */
export function BattleMapPreview({ battle, map }: { battle: ArenaBattle; map: GameMap | undefined }) {
  if (!map) return <p className="muted">The map “{battle.mapName}” no longer exists.</p>;
  const a = battle.formation;
  const b = battle.opponent;
  const unitAt = (tile: number): MapUnit | undefined => {
    const hero = a.heroes.find((h) => h.tile === tile);
    if (hero) return { side: 'a' as const, kind: 'hero' as const, name: rowName({ hero: hero.name, part: hero.part }) };
    const partA = phantimalAt(a.phantimal, tile);
    if (partA) return { side: 'a' as const, kind: 'phantimal' as const, name: partA };
    const enemy = b.heroes.find((h) => h.tile === tile);
    if (enemy) return { side: 'b' as const, kind: 'hero' as const, name: rowName({ hero: enemy.name, part: enemy.part }) };
    const partB = phantimalAt(b.phantimal, tile);
    if (partB) return { side: 'b' as const, kind: 'phantimal' as const, name: partB };
    return undefined;
  };
  return (
    <div className="battle-map">
      <UnitsOnMap
        rowLengths={map.rowLengths}
        cells={map.cells}
        label={`Map of battle ${battle.id}`}
        unitAt={unitAt}
        slotA={<ArtifactSlot readOnly side="a" label="Side A artifact" artifacts={[]} value={a.artifact ?? ''} onChange={() => undefined} />}
        slotB={<ArtifactSlot readOnly side="b" label="Side B artifact" artifacts={[]} value={b.artifact ?? ''} onChange={() => undefined} />}
      />
    </div>
  );
}
