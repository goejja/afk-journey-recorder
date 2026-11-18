import { useCallback, useState } from 'react';
import { weaponLabel } from '../../src/domain/exclusive-weapon.js';
import { allowedEquipmentLevels, equipmentForRank, type HeroStateRules } from '../../src/domain/hero-state.js';
import { RankText } from '../RankText.js';
import { WeaponStars } from '../WeaponStars.js';
import { EquipmentOptions, RankOptions } from './HeroStateOptions.js';
import { Popover } from './Popover.js';

/**
 * A hero's rank and equipment as two buttons, each opening a `Popover` of the values it can take under it. A pick changes the value
 * and closes the list; a new rank moves the equipment into what it allows. There is no equipment button for a rank without equipment.
 * With `unknown`, a hero with no rank shows that text and the list offers it as an entry to pick.
 */
export function HeroStateButtons({ name, tier, rank, level, rules, unknown, onChange }: {
  name: string;
  tier: string | null;
  rank: string | null;
  level: number | null;
  rules: HeroStateRules;
  unknown?: string;
  onChange: (rank: string | null, level: number | null) => void;
}) {
  // The value whose list is open, and the button it hangs under; a press anywhere else closes it.
  const [editing, setEditing] = useState<'rank' | 'equipment' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const toggle = (field: 'rank' | 'equipment', button: HTMLElement) => {
    setAnchor(button);
    setEditing(editing === field ? null : field);
  };
  const pick = (nextRank: string | null, nextLevel: number | null) => {
    onChange(nextRank, nextLevel);
    setEditing(null);
  };

  return (
    <>
      <button type="button" className="state-value" aria-expanded={editing === 'rank'} aria-label={`Rank of ${name}: ${rank ?? 'not set'}`} title="Change the rank" onClick={(e) => toggle('rank', e.currentTarget)}>
        {rank === null && unknown !== undefined ? <span className="muted">{unknown}</span> : <RankText rank={rank} />}
      </button>
      {allowedEquipmentLevels(rank, rules).length > 0 && (
        <button type="button" className="state-value weapon-line" aria-expanded={editing === 'equipment'} aria-label={`Equipment of ${name}: ${level === null ? 'none' : weaponLabel(level)}`} title="Change the equipment" onClick={(e) => toggle('equipment', e.currentTarget)}>
          {level === null ? <span className="muted">No equipment</span> : <><WeaponStars level={level} /> <span>{weaponLabel(level)}</span></>}
        </button>
      )}
      {editing && anchor && (
        <Popover anchor={anchor} label={editing === 'rank' ? `Rank of ${name}` : `Equipment of ${name}`} onClose={close}>
          {editing === 'rank' ? (
            <RankOptions tier={tier} rank={rank} rules={rules} unknown={unknown} onPick={(next) => pick(next, equipmentForRank(level, next, rules))} />
          ) : (
            <EquipmentOptions rank={rank} level={level} rules={rules} onPick={(next) => pick(rank, next)} />
          )}
        </Popover>
      )}
    </>
  );
}
