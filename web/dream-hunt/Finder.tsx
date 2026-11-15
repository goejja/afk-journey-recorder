import { useId, useState } from 'react';
import { api, type BossRule, type GameMap, type Hero } from '../backend.js';
import { CompositionTable, type SendToSimulator } from './BestTeams.js';
import { TagFilter } from '../Tags.js';
import { useLoad } from '../useLoad.js';
import { useMaps } from '../useMaps.js';

interface Props {
  heroes: Hero[];
  rules: BossRule[];
  send?: SendToSimulator;
}

/** Heroes as removable chips; typing a hero's name and pressing Enter adds it. Every hero is offered, the ones the player lacks too. */
function HeroNames({ heroes, value, onChange }: { heroes: Hero[]; value: string[]; onChange: (names: string[]) => void }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();

  function add(raw: string) {
    const typed = raw.trim().toLowerCase();
    if (!typed) return;
    const hero = heroes.find((h) => h.name.toLowerCase() === typed);
    if (!hero) return setMessage(`"${raw.trim()}" is not a hero`);
    setText('');
    setMessage(null);
    if (!value.includes(hero.name)) onChange([...value, hero.name]);
  }

  return (
    <div className="field">
      Heroes
      <div className="tags">
        {value.map((name) => (
          <span key={name} className="badge tag" title={heroes.find((h) => h.name === name)?.owned ? undefined : 'Not in your roster'}>
            {name}
            <button type="button" className="tag-remove" aria-label={`Remove ${name}`} onClick={() => onChange(value.filter((n) => n !== name))}>
              ×
            </button>
          </span>
        ))}
        <input
          aria-label="Add hero"
          list={listId}
          placeholder="Add hero"
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
          {heroes.filter((h) => !value.includes(h.name)).map((h) => (
            <option key={h.name} value={h.name} label={h.owned ? undefined : 'not in your roster'} />
          ))}
        </datalist>
        {message && <span className="error">{message}</span>}
      </div>
    </div>
  );
}

/** The Dream Hunt teams that hold every hero asked for, per boss (the Finder). */
export function Finder({ heroes, rules, send }: Props) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [rule, setRule] = useState('any');
  const [tag, setTag] = useState<string[]>([]);
  const maps: GameMap[] = useMaps();
  const found = useLoad(() => api.finder(chosen, rule, tag), [chosen.join('|'), rule, tag.join('|')], chosen.length > 0);
  const result = chosen.length > 0 ? found.data : undefined;

  return (
    <div>
      <div className="filters">
        <HeroNames heroes={heroes} value={chosen} onChange={setChosen} />
        <label className="field">
          Rule
          <select value={rule} onChange={(e) => setRule(e.target.value)}>
            <option value="any">Any</option>
            <option value="none">No rule</option>
            {rules.map((r) => (
              <option key={r.name}>{r.name}</option>
            ))}
          </select>
        </label>
        <TagFilter value={tag} onChange={setTag} />
      </div>
      <p className="muted">
        Every team recorded in Dream Hunt that holds all the heroes asked for, grouped by boss because clear times only compare within one boss. Open a team to see where its heroes stood.
      </p>
      {found.error && chosen.length > 0 && (
        <p className="error" role="alert">
          {found.error}
        </p>
      )}
      {chosen.length === 0 && <p className="muted">Add one or more heroes to find the teams that used them.</p>}
      {result && result.bosses.length === 0 && <p className="muted">No recorded fight used {chosen.length === 1 ? 'this hero' : 'all these heroes together'}.</p>}
      {result?.bosses.map((b) => (
        <section key={b.boss} aria-label={`Teams against ${b.boss}`}>
          <h3>
            {b.boss} <span className="muted">({b.attempts} {b.attempts === 1 ? 'fight' : 'fights'})</span>
          </h3>
          <CompositionTable boss={b.boss} compositions={b.compositions} maps={maps} send={send} />
        </section>
      ))}
    </div>
  );
}
