import { useMemo, useState } from 'react';
import { isSmallSample, SMALL_SAMPLE } from '../../src/domain/stats.js';
import { api, type PartnerStat } from '../backend.js';
import { percent, record } from '../format.js';
import { useLoad } from '../useLoad.js';
import { heroCell, rateColumns, StatsTable } from './StatsTable.js';

interface Filters {
  mode: string[];
  player: string[];
  playedIn: string[];
  excludeDefault: boolean;
  min: string;
}

const ANY = '';

/** The heroes fielded on the same side as one hero, counted from the owner's own records; the hero is picked from a mechanic tag's heroes or from all. */
export function Partners({ filters }: { filters: Filters }) {
  const [tag, setTag] = useState(ANY);
  const [hero, setHero] = useState('');
  const tags = useLoad(() => api.statsPartnerTags(), []);
  const heroList = useLoad(() => api.statsHeroes({ mode: filters.mode, playedIn: filters.playedIn }), [filters.mode, filters.playedIn]);
  const names = useMemo(() => {
    const tagged = tags.data?.find((t) => t.tag === tag)?.heroes;
    return tagged ?? (heroList.data ?? []).map((h) => h.hero).sort();
  }, [tag, tags.data, heroList.data]);
  const report = useLoad(
    () => (hero ? api.statsPartners({ hero, mode: filters.mode, player: filters.player, playedIn: filters.playedIn, excludeDefault: filters.excludeDefault ? 'true' : '', min: filters.min }) : Promise.resolve(null)),
    [hero, filters],
  );
  const data = report.data;

  return (
    <>
      <p className="muted">
        The heroes fielded on the same side as the hero you pick, from your recorded battles. It counts who stood in the same team, not who was the target of a protect, heal or buff skill. Fewer than {SMALL_SAMPLE} games together is anecdote.
      </p>
      <div className="filters">
        <label className="field">
          Mechanic tag
          <select value={tag} onChange={(e) => { setTag(e.target.value); setHero(''); }}>
            <option value={ANY}>All heroes</option>
            {(tags.data ?? []).map((t) => (
              <option key={t.tag} value={t.tag}>{`${t.tag} (${t.heroes.length})`}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Hero
          <select value={hero} onChange={(e) => setHero(e.target.value)}>
            <option value="">Pick a hero…</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {tags.error && <p className="error" role="alert">{tags.error}</p>}
      {report.error && <p className="error" role="alert">{report.error}</p>}
      {!hero && <p className="muted">Pick a hero to see who it is fielded with.</p>}
      {data && (
        <>
          <p>
            {data.hero}: {record(data)} of {data.games} games ({percent(data.winRate)}){isSmallSample(data.games) && <span className="badge few">few games</span>}
          </p>
          <StatsTable<PartnerStat>
            label={`Heroes fielded with ${data.hero}`}
            rows={data.partners}
            rowKey={(r) => r.hero}
            columns={[
              { key: 'hero', header: 'Fielded with', value: (r) => r.hero, render: (r) => heroCell(r.hero) },
              ...rateColumns<PartnerStat>(),
              { key: 'share', header: `Share of ${data.hero}'s games`, value: (r) => r.share, render: (r) => percent(r.share) },
            ]}
          />
        </>
      )}
    </>
  );
}
