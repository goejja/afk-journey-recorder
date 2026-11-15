import { useId, useState } from 'react';
import type { Enemy, Hero, StageEnemy } from '../backend.js';

interface Props {
  enemies: Enemy[];
  heroes: Hero[];
  value: StageEnemy[];
  onChange: (value: StageEnemy[]) => void;
}

const nameOf = (e: StageEnemy) => e.enemy ?? e.hero ?? '';
const same = (a: StageEnemy, b: StageEnemy) => a.enemy === b.enemy && a.hero === b.hero;

/**
 * The Stage Enemies as chips (ADR 0034): "Grunt ×3". Typing a name from the Enemy list or a hero and pressing Enter adds it, and adding
 * one that is already there counts one more. The computer may field the same enemy several times, so a chip carries a count, not a tile.
 */
export function StageEnemiesField({ enemies, heroes, value, onChange }: Props) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();

  function add(raw: string) {
    const typed = raw.trim().toLowerCase();
    if (!typed) return;
    const enemy = enemies.find((e) => e.name.toLowerCase() === typed);
    const hero = enemy ? undefined : heroes.find((h) => h.name.toLowerCase() === typed);
    if (!enemy && !hero) return setMessage(`"${raw.trim()}" is not an enemy or a hero`);
    const entry: StageEnemy = { enemy: enemy?.name ?? null, hero: hero?.name ?? null, count: 1 };
    setText('');
    setMessage(null);
    onChange(value.some((e) => same(e, entry)) ? value.map((e) => (same(e, entry) ? { ...e, count: e.count + 1 } : e)) : [...value, entry]);
  }

  const fewer = (entry: StageEnemy) => onChange(entry.count > 1 ? value.map((e) => (e === entry ? { ...e, count: e.count - 1 } : e)) : value.filter((e) => e !== entry));

  return (
    <div className="field">
      <span className="field-caption">Stage enemies</span>
      <div className="tags">
        {value.map((entry) => (
          <span key={`${entry.enemy ? 'enemy' : 'hero'}:${nameOf(entry)}`} className="badge tag" title={entry.hero ? 'Hero' : 'Enemy'}>
            {nameOf(entry)} ×{entry.count}
            {entry.count > 1 && (
              <button type="button" className="tag-remove" aria-label={`One fewer ${nameOf(entry)}`} onClick={() => fewer(entry)}>
                −
              </button>
            )}
            <button type="button" className="tag-remove" aria-label={`Remove ${nameOf(entry)}`} onClick={() => onChange(value.filter((e) => e !== entry))}>
              ×
            </button>
          </span>
        ))}
        <input
          aria-label="Add stage enemy"
          list={listId}
          placeholder="Add enemy or hero"
          value={text}
          onChange={(e) => (setText(e.target.value), setMessage(null))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => add(text)}
        />
        <datalist id={listId}>
          {enemies.map((e) => (
            <option key={`enemy:${e.name}`} value={e.name} label={e.category} />
          ))}
          {heroes.map((h) => (
            <option key={`hero:${h.name}`} value={h.name} label="Hero" />
          ))}
        </datalist>
        {message && <span className="error">{message}</span>}
      </div>
    </div>
  );
}
