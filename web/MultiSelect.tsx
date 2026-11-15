import { useCallback, useRef, useState } from 'react';
import { useDismiss } from './reader/useDismiss.js';

interface Props {
  /** What is filtered, for example "Mode": shown on the button and naming the list of choices. */
  label: string;
  options: string[];
  /** The chosen options; none means no filter. */
  value: string[];
  onChange: (value: string[]) => void;
  /** How an option reads, when that differs from its value (for example "Season 8" for 8). */
  format?: (option: string) => string;
}

/** What the button says: "All", the choices when there are one or two, else how many. */
const summary = (value: string[], format: (option: string) => string) =>
  value.length === 0 ? 'All' : value.length <= 2 ? value.map(format).join(', ') : `${value.length} selected`;

/** A filter that takes several choices: a button that opens a list of checkboxes. Choosing nothing filters nothing. */
export function MultiSelect({ label, options, value, onChange, format = (option) => option }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useDismiss(open, root, useCallback(() => setOpen(false), []));

  const toggle = (option: string) => onChange(value.includes(option) ? value.filter((v) => v !== option) : options.filter((o) => o === option || value.includes(o)));

  return (
    <div className="multi-select" ref={root}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}: {summary(value, format)}
      </button>
      {open && (
        <div className="multi-select-list" role="group" aria-label={label}>
          {options.map((option) => (
            <label key={option} className="check">
              <input type="checkbox" checked={value.includes(option)} onChange={() => toggle(option)} /> {format(option)}
            </label>
          ))}
          <button type="button" className="small" disabled={value.length === 0} onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
