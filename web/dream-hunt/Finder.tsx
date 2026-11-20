import { useState } from 'react';
import { api, type BossRule } from '../backend.js';
import { HeroFilter } from './HeroFilter.js';
import { CompositionTable, type SendToSimulator } from './BestTeams.js';
import { TagFilter } from '../Tags.js';
import { useLoad } from '../hooks/load.js';
import { useMaps } from '../hooks/maps.js';
import { Notice } from '../ui/Notice.js';

interface Props {
  rules: BossRule[];
  send?: SendToSimulator;
}

/** The Dream Hunt teams that hold every hero asked for, per boss (the Finder). */
export function Finder({ rules, send }: Props) {
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [rule, setRule] = useState('any');
  const [tag, setTag] = useState<string[]>([]);
  const { maps, error: mapsError } = useMaps();
  const asked = include.length + exclude.length > 0;
  const found = useLoad(() => api.finder(include, exclude, rule, tag), [include.join('|'), exclude.join('|'), rule, tag.join('|')], asked);
  const result = asked ? found.data : undefined;
  const { data: offered = [] } = useLoad(() => api.fightHeroes(), []);

  return (
    <div>
      <div className="filters">
        <HeroFilter offered={offered} include={include} exclude={exclude} onChange={(next) => (setInclude(next.include), setExclude(next.exclude))} />
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
        Every team recorded in Dream Hunt that holds all the included heroes and none of the excluded ones, grouped by boss because clear times only compare within one boss. Open a team to see where its heroes stood.
      </p>
      {mapsError && (
        <Notice kind="error">
          {mapsError}
        </Notice>
      )}
      {found.error && asked && (
        <Notice kind="error">
          {found.error}
        </Notice>
      )}
      {!asked && <p className="muted">Include or exclude one or more heroes to find the teams that used them.</p>}
      {result && result.bosses.length === 0 && <p className="muted">No recorded team matches these heroes.</p>}
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
