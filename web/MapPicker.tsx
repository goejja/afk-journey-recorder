import { useCallback, useRef, useState } from 'react';
import type { GameMap } from './backend.js';
import { MapThumb } from './MapThumb.js';
import { useDismiss } from './reader/useDismiss.js';

interface Props {
  /** What is being chosen, for example "Map": names the button and the list. */
  label: string;
  maps: GameMap[];
  /** The chosen map's name, or null for none. */
  value: string | null;
  onChange: (name: string | null) => void;
}

/** Chooses a map by its layout: the chosen one drawn small with its name, and a list of every map drawn the same way to pick from. */
export function MapPicker({ label, maps, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, useCallback(() => setOpen(false), []));
  const chosen = maps.find((m) => m.name === value);
  const pick = (name: string | null) => (onChange(name), setOpen(false));

  return (
    <div className="map-picker" ref={root}>
      <button type="button" className="map-picker-button" aria-haspopup="true" aria-expanded={open} aria-label={`${label}: ${value ?? 'none'}`} onClick={() => setOpen(!open)}>
        {chosen ? <MapThumb map={chosen} decorative /> : <span className="map-thumb map-thumb-none" aria-hidden="true">+</span>}
        <span className="map-picker-name">{value ?? 'None'}</span>
      </button>
      {open && (
        <div className="map-picker-list" role="group" aria-label={label}>
          <button type="button" className="map-choice" aria-pressed={value === null} onClick={() => pick(null)}>
            <span className="map-thumb map-thumb-none" aria-hidden="true">–</span>
            <span>None</span>
          </button>
          {maps.map((m) => (
            <button key={m.name} type="button" className={value === m.name ? 'map-choice active' : 'map-choice'} aria-label={m.name} aria-pressed={value === m.name} onClick={() => pick(m.name)}>
              <MapThumb map={m} decorative />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
