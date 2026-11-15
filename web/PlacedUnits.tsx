import { Portrait, type ImageKind } from './Portrait.js';

export interface PlacedUnit {
  key: string;
  name: string;
  kind: ImageKind;
  onRemove: () => void;
}

interface Props {
  /** Whose units these are, for example "Side A"; names the list and the buttons. */
  label: string;
  units: PlacedUnit[];
}

/** The units placed on one side, each with its own remove button. Clicking the map never removes. */
export function PlacedUnits({ label, units }: Props) {
  return (
    <div className="placed">
      <span className="placed-label">{label}</span>
      <ul aria-label={`Placed on ${label}`}>
        {units.map((u) => (
          <li key={u.key}>
            <Portrait kind={u.kind} name={u.name} size={22} />
            {u.name}
            <button aria-label={`Remove ${u.name}`} title={`Remove ${u.name}`} onClick={u.onRemove}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {units.length === 0 && <span className="muted">none yet</span>}
    </div>
  );
}
