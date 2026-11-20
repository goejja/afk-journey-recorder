import { useId, useState } from 'react';
import { Portrait } from '../Portrait.js';
import { IconButton } from '../ui/Icon.js';

const MAX_SUGGESTIONS = 8;

interface Props {
  /** The heroes the search offers: the ones with a recorded fight. */
  offered: string[];
  include: string[];
  exclude: string[];
  onChange: (next: { include: string[]; exclude: string[] }) => void;
}

/** A search box that filters the offered heroes as the player types; the first match is picked with Enter, any match with a click. */
function HeroSearch({ label, offered, taken, onPick }: { label: string; offered: string[]; taken: string[]; onPick: (name: string) => void }) {
  const [text, setText] = useState('');
  const listId = useId();
  const typed = text.trim().toLowerCase();
  const matches = typed ? offered.filter((name) => !taken.includes(name) && name.toLowerCase().includes(typed)).slice(0, MAX_SUGGESTIONS) : [];

  function pick(name: string) {
    onPick(name);
    setText('');
  }

  return (
    <div className="hero-search">
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        autoComplete="off"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setText('');
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault();
            pick(matches[0]);
          }
        }}
      />
      {typed && (
        <ul id={listId} role="listbox" aria-label={`${label}: matching heroes`} className="hero-matches">
          {matches.length === 0 && <li className="muted hero-none">No hero with a recorded fight matches “{text.trim()}”</li>}
          {matches.map((name) => (
            <li key={name} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(name)}>
                <Portrait kind="hero" name={name} size={24} />
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeroChips({ names, excluded, onRemove }: { names: string[]; excluded?: boolean; onRemove: (name: string) => void }) {
  return (
    <span className="tags">
      {names.map((name) => (
        <span key={name} className={`hero-chip${excluded ? ' excluded' : ''}`} title={excluded ? `Excluded: ${name}` : `Included: ${name}`}>
          <span className="hero-chip-portrait">
            <Portrait kind="hero" name={name} size={24} title={name} />
          </span>
          <span className="sr-only">{excluded ? `Excluded: ${name}` : `Included: ${name}`}</span>
          <IconButton icon="close" className="tag-remove" label={`Remove ${name}`} onClick={() => onRemove(name)} />
        </span>
      ))}
    </span>
  );
}

/**
 * The Include and Exclude hero filters of Best teams and the Finder. Include keeps the teams that hold every chosen hero, Exclude drops the
 * teams that hold any chosen hero. A hero chosen in one list is no longer offered in the other, so it can never be in both.
 * Renders its parts as direct children of the `.filters` row: the two search boxes line up with the other controls, and the chosen heroes of
 * both lists sit to the right of the Exclude box.
 */
export function HeroFilter({ offered, include, exclude, onChange }: Props) {
  const chosen = [...include, ...exclude];
  return (
    <>
      <div className="field">
        Include
        <HeroSearch label="Include hero" offered={offered} taken={chosen} onPick={(name) => onChange({ include: [...include, name], exclude })} />
      </div>
      <div className="field">
        Exclude
        <HeroSearch label="Exclude hero" offered={offered} taken={chosen} onPick={(name) => onChange({ include, exclude: [...exclude, name] })} />
      </div>
      {chosen.length > 0 && (
        <div className="hero-chips">
          <HeroChips names={include} onRemove={(name) => onChange({ include: include.filter((n) => n !== name), exclude })} />
          <HeroChips names={exclude} excluded onRemove={(name) => onChange({ include, exclude: exclude.filter((n) => n !== name) })} />
        </div>
      )}
    </>
  );
}
