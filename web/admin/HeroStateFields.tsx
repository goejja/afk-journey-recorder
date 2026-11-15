import { allowedEquipmentLevels, allowedRanks, equipmentForRank } from '../../src/domain/hero-state.js';
import type { Rules } from '../backend.js';
import { WeaponStars, weaponOptionText } from '../WeaponStars.js';

/** Rank and equipment selects for one hero; equipment is limited to what the rank allows. */
export function HeroStateFields({ rank, equipment, rules, label, tier = null, unknownRank = 'Rank unknown', onChange }: {
  rank: string;
  equipment: string;
  rules: Rules;
  label: string;
  /** The hero's tier, which limits the ranks offered (S from Epic, A from Rare, R only Rare). */
  tier?: string | null;
  unknownRank?: string;
  onChange: (rank: string, equipment: string) => void;
}) {
  const levels = allowedEquipmentLevels(rank || null, rules);
  // A rank already stored stays selectable even if the tier rule would not offer it, so an old record still shows it.
  const offered = allowedRanks(tier, rules.ranks);
  const ranks = rank && !offered.includes(rank) ? [...offered, rank] : offered;
  return (
    <>
      <select aria-label={`${label} rank`} value={rank} onChange={(e) => onChange(e.target.value, String(equipmentForRank(equipment === '' ? null : Number(equipment), e.target.value || null, rules) ?? ''))}>
        <option value="">{unknownRank}</option>
        {[...ranks].reverse().map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <select aria-label={`${label} equipment`} value={equipment} onChange={(e) => onChange(rank, e.target.value)}>
        <option value="">No equipment</option>
        {levels.map((l) => (
          <option key={l} value={l}>
            {weaponOptionText(l)}
          </option>
        ))}
      </select>
      <WeaponStars level={equipment === '' ? null : Number(equipment)} />
    </>
  );
}
