import { useState, type ReactNode } from 'react';
import { Portrait, type ImageKind } from './Portrait.js';

interface Props {
  /** For example "Assist hero"; the buttons are named after it. */
  label: string;
  kind: ImageKind;
  /** The chosen unit's name, or empty. */
  value: string;
  /** Shown when nothing is chosen. */
  none: string;
  onClear: () => void;
  /** The icon grid to pick from; call close once a choice is made. */
  children: (close: () => void) => ReactNode;
}

/** One optional choice shown as its icon and name, with a button that opens an icon grid to change it. */
export function IconChoice({ label, kind, value, none, onClear, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="icon-choice">
      <div className="choice-head">
        <span className="choice-label">{label}</span>
        {value && <Portrait kind={kind} name={value} size={36} />}
        <strong>{value || none}</strong>
        <button aria-expanded={open} aria-label={`Choose ${label.toLowerCase()}`} onClick={() => setOpen(!open)}>
          {open ? 'Close' : value ? 'Change' : 'Choose'}
        </button>
        {value && (
          <button aria-label={`Clear ${label.toLowerCase()}`} onClick={onClear}>
            None
          </button>
        )}
      </div>
      {open && <div className="choice-body">{children(() => setOpen(false))}</div>}
    </div>
  );
}
