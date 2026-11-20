import { resonanceColour, weaponLabel, weaponStars } from '../src/domain/exclusive-weapon.js';
import { allowedEquipmentLevels, equipmentForRank, type HeroStateRules } from '../src/domain/hero-state.js';
import { RankText } from './RankText.js';
import { EquipmentOptions, RankOptions } from './ui/HeroStateOptions.js';
import { Popover } from './ui/Popover.js';

/**
 * The rank and equipment of the hero clicked on the map, as two lists side by side next to its tile. It stays open after a pick, since
 * a new rank often moves the equipment too, and closes when the person presses anywhere else. Rank and equipment are the strings a
 * record keeps: '' is no rank or no equipment. `unknown` is the entry that sets no rank ("Rank unknown" by default); `null` offers none.
 */
export function HeroStatePopover({ anchor, name, tier, rank, equipment, rules, unknown = 'Rank unknown', onChange, onClose }: {
  anchor: HTMLElement;
  name: string;
  tier?: string | null;
  rank: string;
  equipment: string;
  rules: HeroStateRules;
  unknown?: string | null;
  onChange: (rank: string, equipment: string) => void;
  onClose: () => void;
}) {
  const current = rank || null;
  const level = equipment === '' ? null : Number(equipment);
  const set = (nextRank: string | null, nextLevel: number | null) => onChange(nextRank ?? '', nextLevel === null ? '' : String(nextLevel));
  return (
    <Popover anchor={anchor} label={`Rank and equipment of ${name}`} onClose={onClose}>
      <div className="popover-columns">
        <div className="popover-column" role="group" aria-label={`Rank of ${name}`}>
          <span className="popover-head">Rank</span>
          <RankOptions tier={tier ?? null} rank={current} rules={rules} unknown={unknown ?? undefined} onPick={(next) => set(next, equipmentForRank(level, next, rules))} />
        </div>
        <div className="popover-column" role="group" aria-label={`Equipment of ${name}`}>
          <span className="popover-head">Equipment</span>
          {allowedEquipmentLevels(current, rules).length > 0 ? (
            <EquipmentOptions rank={current} level={level} rules={rules} onPick={(next) => set(current, next)} />
          ) : (
            <span className="popover-head">None at this rank</span>
          )}
        </div>
      </div>
    </Popover>
  );
}

/** The rank and equipment of the hero on a tile as a small label under it, for example "P2 ★R3"; "?" when the rank is not known. R1 to R4 are painted like P1 to P4. */
export function StateTag({ rank, equipment }: { rank: string | null; equipment: number | null }) {
  return (
    <span className="tile-tag" aria-hidden="true">
      {rank === null ? <span className="muted">?</span> : <RankText rank={rank} short />}
      {equipment !== null && (
        <span>
          <span className={`weapon-stars-${weaponStars(equipment).color}`}>★</span>
          <span className={resonanceColour(equipment) ? `rank-colour rank-colour-${resonanceColour(equipment)}` : undefined}>{weaponLabel(equipment)}</span>
        </span>
      )}
    </span>
  );
}

/** Rank and equipment as short text for a tooltip, for example "Mythic+ +10" or "Paragon 1 R1". */
export const stateText = (rank: string | null | undefined, equipment: number | string | null | undefined) =>
  [rank, equipment === null || equipment === undefined || equipment === '' ? null : weaponLabel(Number(equipment))].filter(Boolean).join(' ');
