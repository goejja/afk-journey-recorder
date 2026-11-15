import { useState } from 'react';
import type { Enemy } from '../backend.js';
import { dragProps } from '../placement.js';

interface Props {
  enemies: Enemy[];
  selected: string | null;
  onPick: (name: string) => void;
  /** Chips can be dragged onto the map; reports when a drag starts (with the name) and ends (null). */
  onDragEnemy?: (name: string | null) => void;
}

const CATEGORIES: Enemy['category'][] = ['Boss', 'Elite', 'Common'];
const MOST_USED = 8;

const describe = (e: Enemy) =>
  [e.name, e.category, e.class, e.damageType, e.uses > 0 ? `on ${e.uses} stage${e.uses === 1 ? '' : 's'}` : undefined].filter(Boolean).join(' · ');

/**
 * Enemies as compact name chips: the ones used on the most stages first, then the rest grouped as
 * Boss, Elite and Common. There are no enemy images to show, so names are what tells them apart.
 */
export function EnemyPicker({ enemies, selected, onPick, onDragEnemy }: Props) {
  const [search, setSearch] = useState('');
  const matching = enemies.filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()));
  const mostUsed = [...matching]
    .filter((e) => e.uses > 0)
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
    .slice(0, MOST_USED);

  const chip = (e: Enemy) => (
    <li key={e.name}>
      <button className={selected === e.name ? 'enemy-chip active' : 'enemy-chip'} aria-pressed={selected === e.name} title={describe(e)}
        {...dragProps(e.name, onDragEnemy)}
        onClick={() => onPick(e.name)}
      >
        {e.name}
      </button>
    </li>
  );

  return (
    <div className="enemy-picker">
      <input placeholder="Search enemies" aria-label="Search Enemies" value={search} onChange={(e) => setSearch(e.target.value)} />
      {mostUsed.length > 0 && (
        <>
          <h4>Most used</h4>
          <ul className="enemy-chips" aria-label="Most used enemies">
            {mostUsed.map(chip)}
          </ul>
        </>
      )}
      <div className="chip-groups">
        {CATEGORIES.map((category) => {
          const members = matching.filter((e) => e.category === category).sort((a, b) => a.name.localeCompare(b.name));
          return members.length === 0 ? null : (
            <section key={category}>
              <h4>
                {category} <span className="muted">{members.length}</span>
              </h4>
              <ul className="enemy-chips" aria-label={`${category} enemies`}>
                {members.map(chip)}
              </ul>
            </section>
          );
        })}
      </div>
      {matching.length === 0 && <p className="muted">No enemy matches.</p>}
    </div>
  );
}
