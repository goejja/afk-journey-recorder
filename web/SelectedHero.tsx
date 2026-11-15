import { weaponLabel } from '../src/domain/exclusive-weapon.js';
import type { Rules } from './backend.js';
import { HeroStateFields } from './admin/HeroStateFields.js';
import { Portrait } from './Portrait.js';

/** The rank and equipment of the hero clicked on the map, editable right where the heroes are picked. */
export function SelectedHero({ name, tier, rank, equipment, rules, onChange, onClose }: {
  name: string;
  tier?: string | null;
  rank: string;
  equipment: string;
  rules: Rules;
  onChange: (rank: string, equipment: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="selected-hero" role="group" aria-label={`Selected hero ${name}`}>
      <Portrait kind="hero" name={name} size={32} />
      <strong>{name}</strong>
      <HeroStateFields rank={rank} equipment={equipment} rules={rules} label={name} tier={tier} onChange={onChange} />
      <button onClick={onClose} aria-label={`Done with ${name}`}>
        Done
      </button>
    </div>
  );
}

/** The chosen artifact drawn in a corner of the map, so the formation reads at a glance. */
export function ArtifactBadge({ name, side, size = 40 }: { name: string; side: 'a' | 'b'; size?: number }) {
  return (
    <span className={`artifact-badge artifact-badge-${side}`} title={name}>
      <Portrait kind="artifact" name={name} size={size} />
    </span>
  );
}

/** Rank and equipment as short text for a tooltip, for example "Mythic+ +10" or "Paragon 1 R1". */
export const stateText = (rank: string | null | undefined, equipment: number | string | null | undefined) =>
  [rank, equipment === null || equipment === undefined || equipment === '' ? null : weaponLabel(Number(equipment))].filter(Boolean).join(' ');
