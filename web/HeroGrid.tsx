import { Fragment, useState } from 'react';
import type { Hero } from './backend.js';
import { distinct, heroMatches, TIER_ORDER } from './heroFilter.js';
import { MultiSelect } from './MultiSelect.js';
import { Portrait } from './Portrait.js';
import { dragProps } from './placement.js';

interface Props {
  heroes: Hero[];
  selected: string | null;
  onPick: (name: string) => void;
  /** Heroes that cannot be picked, mapped to why. */
  disabled?: Map<string, string>;
  /** Heroes another team holds but that can be taken from it, mapped to where they are: greyed, yet clickable. */
  held?: Map<string, string>;
  /** Accessible name of the grid and its search box. */
  label: string;
  /** Extra text in a hero's tooltip, for example its roster rank. */
  hint?: (hero: Hero) => string | undefined;
  /** Icons can be dragged onto the map; these report when a drag starts and ends. */
  onDragHero?: (name: string | null) => void;
}

/** Faction order of the Yaphalla builder; anything else follows. */
const FACTION_ORDER = ['Lightbearer', 'Mauler', 'Wilder', 'Graveborn', 'Celestial', 'Hypogean', 'Dimensional'];

/** Heroes grouped by faction, strongest tier first, then by name. */
export function groupByFaction(heroes: Hero[]): { faction: string; heroes: Hero[] }[] {
  const rank = (faction: string) => (FACTION_ORDER.includes(faction) ? FACTION_ORDER.indexOf(faction) : FACTION_ORDER.length);
  const groups = new Map<string, Hero[]>();
  for (const hero of heroes) groups.set(hero.faction ?? 'Other', [...(groups.get(hero.faction ?? 'Other') ?? []), hero]);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([faction, members]) => ({
      faction,
      heroes: members.sort((a, b) => TIER_ORDER.indexOf(a.tier ?? 'R') - TIER_ORDER.indexOf(b.tier ?? 'R') || a.name.localeCompare(b.name)),
    }));
}

/** Heroes as portrait icons, filtered by name, faction and class, to pick one to place. */
export function HeroGrid({ heroes, selected, onPick, disabled, held, label, hint, onDragHero }: Props) {
  const [search, setSearch] = useState('');
  const [faction, setFaction] = useState<string[]>([]);
  const [heroClass, setHeroClass] = useState<string[]>([]);
  const visible = heroes.filter((h) => heroMatches(h, { search, faction, heroClass }));

  return (
    <div>
      <div className="picker-controls filters">
        <input placeholder="Search heroes" aria-label={`Search ${label}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <MultiSelect label="Faction" options={distinct(heroes.map((h) => h.faction))} value={faction} onChange={setFaction} />
        <MultiSelect label="Class" options={distinct(heroes.map((h) => h.class))} value={heroClass} onChange={setHeroClass} />
      </div>
      <ul className="hero-grid" aria-label={label}>
        {groupByFaction(visible).map((group) => (
          <Fragment key={group.faction}>
            <li className="hero-group">{group.faction}</li>
            {group.heroes.map((h) => {
              const reason = disabled?.get(h.name) ?? (held?.has(h.name) ? `In ${held.get(h.name)}: click to move it here` : undefined);
              return (
                <li key={h.name}>
                  <button
                    className={['hero-icon', selected === h.name ? 'active' : '', held?.has(h.name) ? 'held' : ''].filter(Boolean).join(' ')}
                    aria-label={h.name}
                    aria-pressed={selected === h.name}
                    disabled={disabled?.has(h.name)}
                    title={[h.name, h.class, hint?.(h), reason].filter(Boolean).join(' · ')}
                    {...dragProps(h.name, onDragHero)}
                    draggable={Boolean(onDragHero) && !disabled?.has(h.name)}
                    onClick={() => onPick(h.name)}
                  >
                    <Portrait kind="hero" name={h.name} size={44} />
                  </button>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
      {heroes.length > 0 && visible.length === 0 && <p className="muted">No heroes match.</p>}
    </div>
  );
}
