import { useMemo, useState } from 'react';
import { PARTNER_RELATIONS, PARTNER_RELATION_TEXT, type PartnerRelation } from '../../src/domain/partner-relation.js';
import { isSmallSample, SMALL_SAMPLE } from '../../src/domain/stats.js';
import { api, type PartnerStat, type PositionalPartnerStat } from '../backend.js';
import { percent, record } from '../format.js';
import { useLoad } from '../hooks/load.js';
import { heroCell, rateColumns, StatsTable, type Column } from './StatsTable.js';
import { Notice } from '../ui/Notice.js';

interface Filters {
  mode: string[];
  player: string[];
  playedIn: string[];
  excludeDefault: boolean;
  min: string;
}

const ANY = '';

// Column lists and row keys of the two tables: made once per hero, so a table skips its render when nothing it shows has changed.
const shareHeader = (hero: string) => `Share of ${hero}'s games`;
const positionalColumns = (hero: string): Column<PositionalPartnerStat>[] => [
  { key: 'hero', header: 'Stood there', value: (r) => r.hero, render: (r) => heroCell(r.hero) },
  ...rateColumns<PositionalPartnerStat>(),
  { key: 'share', header: shareHeader(hero), value: (r) => r.share, render: (r) => percent(r.share) },
  { key: 'players', header: 'Players', value: (r) => r.players },
  { key: 'layouts', header: 'Layouts', value: (r) => r.layouts, render: (r) => <>{r.layouts}{r.oneLayout && <span className="badge few" title="Half or more of these games are one exact formation">mostly one layout</span>}</> },
];
const partnerColumns = (hero: string): Column<PartnerStat>[] => [
  { key: 'hero', header: 'Fielded with', value: (r) => r.hero, render: (r) => heroCell(r.hero) },
  ...rateColumns<PartnerStat>(),
  { key: 'share', header: shareHeader(hero), value: (r) => r.share, render: (r) => percent(r.share) },
];
const partnerKey = (r: { hero: string }) => r.hero;

/** Who stood in one relation to the hero at the start of the fight; the relation is chosen in a select. */
function Positions({ hero, filters }: { hero: string; filters: Filters }) {
  const [relation, setRelation] = useState<PartnerRelation>('behind');
  const report = useLoad(
    () => api.statsPartnerPositions({ hero, relation, mode: filters.mode, player: filters.player, playedIn: filters.playedIn, excludeDefault: filters.excludeDefault ? 'true' : '', min: filters.min }),
    [hero, relation, filters],
  );
  const data = report.data;
  const columns = useMemo(() => positionalColumns(hero), [hero]);
  return (
    <>
      <h3>Where they stood</h3>
      <p className="muted">
        Who stood there at the start of the fight, from the recorded tiles; not necessarily the target of the skill. A side counts once for each ally in the place.
      </p>
      <label className="field">
        Place
        <select value={relation} onChange={(e) => setRelation(e.target.value as PartnerRelation)}>
          {PARTNER_RELATIONS.map((r) => <option key={r} value={r}>{PARTNER_RELATION_TEXT[r]}</option>)}
        </select>
      </label>
      {report.error && <Notice kind="error">{report.error}</Notice>}
      {data && (
        <>
          <p className="muted">{data.empty} of {data.games} games had nobody there.</p>
          <StatsTable<PositionalPartnerStat>
            label={`Heroes that stood ${PARTNER_RELATION_TEXT[relation].toLowerCase()} of ${hero}`}
            rows={data.partners}
            rowKey={partnerKey}
            columns={columns}
          />
        </>
      )}
    </>
  );
}

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
  const columns = useMemo(() => partnerColumns(data?.hero ?? ''), [data?.hero]);

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
      {tags.error && <Notice kind="error">{tags.error}</Notice>}
      {report.error && <Notice kind="error">{report.error}</Notice>}
      {!hero && <p className="muted">Pick a hero to see who it is fielded with.</p>}
      {data && (
        <>
          <p>
            {data.hero}: {record(data)} of {data.games} games ({percent(data.winRate)}){isSmallSample(data.games) && <span className="badge few">few games</span>}
          </p>
          <StatsTable<PartnerStat>
            label={`Heroes fielded with ${data.hero}`}
            rows={data.partners}
            rowKey={partnerKey}
            columns={columns}
          />
          <Positions hero={data.hero} filters={filters} />
        </>
      )}
    </>
  );
}
