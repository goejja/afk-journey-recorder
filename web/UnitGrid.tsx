import { useState } from 'react';
import { Portrait, type ImageKind } from './Portrait.js';
import { dragProps } from './placement.js';

export interface Unit {
  name: string;
  /** A category the grid can be narrowed by, for example an enemy's Common / Elite / Boss. */
  group?: string | null;
}

interface Props {
  kind: ImageKind;
  units: Unit[];
  selected: string | null;
  onPick: (name: string) => void;
  /** Accessible name of the grid; its search box and group filter are named after it. */
  label: string;
  /** Name of the group filter, shown only when given. */
  groupLabel?: string;
  /** Named views shown first in the filter, the first being the default (for example "Current season", "All"). */
  views?: { label: string; show: (unit: Unit) => boolean }[];
  /** Icons can be dragged onto the map; reports when a drag starts (with the name) and ends (null). */
  onDragUnit?: (name: string | null) => void;
  /** Units another team holds but that can be taken from it, mapped to where they are: greyed, yet clickable. */
  held?: Map<string, string>;
}

const LIMIT = 200;

/** Enemies or phantimals as portrait icons, to pick one to place. */
export function UnitGrid({ kind, units, selected, onPick, label, groupLabel, views, onDragUnit, held }: Props) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState(views?.[0] ? `view:0` : '');
  const groups = [...new Set(units.map((u) => u.group).filter((g): g is string => Boolean(g)))].sort();
  const view = group.startsWith('view:') ? views?.[Number(group.slice(5))] : undefined;
  const matching = units.filter(
    (u) => (!search || u.name.toLowerCase().includes(search.toLowerCase())) && (view ? view.show(u) : !group || u.group === group),
  );

  return (
    <div>
      <div className="picker-controls">
        <input placeholder="Search" aria-label={`Search ${label}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        {groupLabel && groups.length > 0 && (
          <div className="filters">
            <select aria-label={`${groupLabel} of ${label}`} value={group} onChange={(e) => setGroup(e.target.value)}>
              {views ? views.map((v, i) => <option key={v.label} value={`view:${i}`}>{v.label}</option>) : <option value="">All</option>}
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <ul className="hero-grid" aria-label={label}>
        {matching.slice(0, LIMIT).map((u) => (
          <li key={u.name}>
            <button
              className={['hero-icon', selected === u.name ? 'active' : '', held?.has(u.name) ? 'held' : ''].filter(Boolean).join(' ')}
              aria-label={u.name}
              aria-pressed={selected === u.name}
              title={[u.name, u.group, held?.has(u.name) ? `In ${held.get(u.name)}: click to move it here` : undefined].filter(Boolean).join(' · ')}
              {...dragProps(u.name, onDragUnit)}
              onClick={() => onPick(u.name)}
            >
              <Portrait kind={kind} name={u.name} size={44} />
              <span>{u.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {matching.length > LIMIT && <p className="muted">Showing the first {LIMIT} of {matching.length}. Search to narrow them.</p>}
      {matching.length === 0 && <p className="muted">Nothing matches.</p>}
    </div>
  );
}
