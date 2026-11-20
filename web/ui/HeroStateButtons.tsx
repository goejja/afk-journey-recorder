import { useCallback, useState } from 'react';
import { weaponLabel } from '../../src/domain/exclusive-weapon.js';
import { allowedEquipmentLevels, type HeroStateRules } from '../../src/domain/hero-state.js';
import { HeroStatePopover } from '../HeroStatePopover.js';
import { RankText } from '../RankText.js';
import { WeaponStars } from '../WeaponStars.js';

/**
 * A hero's rank and equipment as one button, the rank with the equipment under it, opening a `HeroStatePopover` where both can be set.
 * The list stays open after a pick, since a new rank moves the equipment into what it allows, and closes on a press elsewhere or a second
 * click on the button. There is no equipment line for a rank without equipment.
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
  // The button the list hangs under while it is open; a press anywhere else closes it.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const hasEquipment = allowedEquipmentLevels(rank, rules).length > 0;
  const equipment = level === null ? 'no equipment' : weaponLabel(level);

  return (
    <>
      <button
        type="button"
        className="state-value state-values"
        aria-expanded={anchor !== null}
        aria-label={`Rank and equipment of ${name}: ${rank ?? 'not set'}${hasEquipment ? `, ${equipment}` : ''}`}
        title="Change rank and equipment"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {rank === null && unknown !== undefined ? <span className="muted">{unknown}</span> : <RankText rank={rank} />}
        {hasEquipment && <span className="weapon-line">{level === null ? <span className="muted">No equipment</span> : <><WeaponStars level={level} /> <span>{weaponLabel(level)}</span></>}</span>}
      </button>
      {anchor && (
        <HeroStatePopover
          anchor={anchor}
          name={name}
          tier={tier}
          rank={rank ?? ''}
          equipment={level === null ? '' : String(level)}
          rules={rules}
          unknown={unknown ?? null}
          onChange={(nextRank, nextEquipment) => onChange(nextRank || null, nextEquipment === '' ? null : Number(nextEquipment))}
          onClose={close}
        />
      )}
    </>
  );
}
