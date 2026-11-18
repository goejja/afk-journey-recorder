import { allowedEquipmentLevels, allowedRanks, type HeroStateRules } from '../../src/domain/hero-state.js';
import { RankText } from '../RankText.js';
import { weaponOptionText } from '../WeaponStars.js';

/**
 * The buttons of a hero's rank list, highest first so the strongest options are at the top; put them in a `Popover`. Only the ranks
 * the tier allows are offered, plus a rank already stored that the tier would not offer, so an old record still shows it.
 * Without `unknown`, a hero with no rank gets a disabled "Not set" at the top; with it, "unknown" is an entry to pick, at the bottom.
 */
export function RankOptions({ tier, rank, rules, unknown, onPick }: {
  tier: string | null;
  rank: string | null;
  rules: Pick<HeroStateRules, 'ranks'>;
  unknown?: string;
  onPick: (rank: string | null) => void;
}) {
  const offered = allowedRanks(tier, rules.ranks);
  const ranks = (rank !== null && !offered.includes(rank) ? [...offered, rank] : offered).slice().reverse();
  return (
    <>
      {rank === null && unknown === undefined && (
        <button type="button" aria-pressed disabled>
          Not set
        </button>
      )}
      {ranks.map((r) => (
        <button key={r} type="button" aria-pressed={r === rank} onClick={() => onPick(r)}>
          <RankText rank={r} />
        </button>
      ))}
      {unknown !== undefined && (
        <button type="button" aria-pressed={rank === null} onClick={() => onPick(null)}>
          {unknown}
        </button>
      )}
    </>
  );
}

/** The buttons of an equipment list for a hero of this rank, highest level first, then "None"; put them in a `Popover`. */
export function EquipmentOptions({ rank, level, rules, onPick }: {
  rank: string | null;
  level: number | null;
  rules: HeroStateRules;
  onPick: (level: number | null) => void;
}) {
  const levels = allowedEquipmentLevels(rank, rules).slice().reverse();
  return (
    <>
      {levels.map((l) => (
        <button key={l} type="button" aria-pressed={l === level} onClick={() => onPick(l)}>
          {weaponOptionText(l)}
        </button>
      ))}
      <button type="button" aria-pressed={level === null} onClick={() => onPick(null)}>
        None
      </button>
    </>
  );
}
