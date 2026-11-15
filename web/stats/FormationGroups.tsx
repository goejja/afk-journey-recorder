import { Fragment, useMemo, useState } from 'react';
import { isSmallSample } from '../../src/domain/stats.js';
import { useLoad } from '../useLoad.js';
import { api, type ArchetypeStat, type GameMap, type PlacementMap, type FormationGroupRow, type FormationProfileStat, type FormationReport, type GroupHero, type RateRecord } from '../backend.js';
import { useMaps } from '../useMaps.js';
import { HexMap } from '../HexMap.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { percent, points, record, toggled } from '../format.js';

interface Filters {
  mode: string[];
  tag: string[];
  player: string[];
  excludeDefault: boolean;
  min: string;
}

const plain = (heroes: string[]) => heroes.join(' + ');
const coreNames = (core: GroupHero[]) => core.map((h) => h.hero);

const heroChip = (h: GroupHero | { hero: string }, withShare: boolean) => (
  <span key={h.hero} className="unit-inline">
    <Portrait kind="hero" name={h.hero} size={24} /> {h.hero}
    {withShare && 'share' in h ? ` ${percent(h.share)}` : ''}
  </span>
);

function Rate({ r }: { r: RateRecord }) {
  return (
    <>
      {record(r)} ({percent(r.winRate)}){isSmallSample(r.games) && <span className="badge few"> few games</span>}
    </>
  );
}

/** Where the group stands on one map: the example board (each hero on its most used free tile) and the list behind it. */
function Placement({ placement, maps }: { placement: PlacementMap[]; maps: GameMap[] }) {
  const [chosen, setChosen] = useState(placement[0]?.map ?? '');
  const current = placement.find((p) => p.map === chosen) ?? placement[0];
  if (!current) return null;
  const map = maps.find((m) => m.name === current.map);
  const heroAt = new Map(current.heroes.filter((h) => h.tile !== null).map((h) => [h.tile!, h.hero]));
  return (
    <>
      <h4>Placement</h4>
      <p className="muted">Where each hero stood most often on the map, as if the group always stood on the half of Side A.</p>
      <label className="field">
        Map
        <select value={current.map} onChange={(e) => setChosen(e.target.value)}>
          {placement.map((p) => (
            <option key={p.map} value={p.map}>{p.map}</option>
          ))}
        </select>
      </label>
      <p>{record(current)} on {current.map} ({current.games} games)</p>
      {map && (
        <HexMap
          rowLengths={map.rowLengths}
          cells={map.cells}
          label={`Example board on ${current.map}`}
          tileTitle={(index) => heroAt.get(index)}
          renderTile={(index) => (heroAt.has(index) ? <Portrait kind="hero" name={heroAt.get(index)!} size={30} /> : undefined)}
        />
      )}
      <ul className="stats-detail">
        {current.heroes.map((h) => (
          <li key={h.hero}>
            {`${h.hero} — placed here ${percent(h.share)} of ${h.games} games`}
            {h.secondChoice && <span className="badge few">second choice</span>}
            {h.tile === null && <span className="badge few">no free tile</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function Profile({ core, filters, maps }: { core: string[]; filters: Filters; maps: GameMap[] }) {
  // `core` is a new array on every render; its names are the dependency.
  const { data: profile, error } = useLoad(
    () => api.statsFormationProfile({ core, mode: filters.mode, tag: filters.tag, player: filters.player, excludeDefault: filters.excludeDefault ? 'true' : '' }),
    [core.join('/'), filters],
  );

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!profile) return <p className="muted">Loading…</p>;
  const matchups = (title: string, rows: FormationProfileStat['strongAgainst']) => (
    <>
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="muted">No enemy group with at least 5 games.</p>
      ) : (
        <ul className="stats-detail">
          {rows.map((m) => (
            <li key={m.enemy.join('/')}>
              {`${plain(m.enemy)} — ${record(m)} (${percent(m.winRate)})`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const gaps = [['ahead', 'Ahead'], ['near', 'Near level'], ['behind', 'Behind'], ['unknown', 'Unknown gap']] as const;
  return (
    <>
      <h4>Artifacts</h4>
      {profile.artifacts.length === 0 ? (
        <p className="muted">No artifact recorded.</p>
      ) : (
        <table className="board" aria-label="Artifacts of the group">
          <thead><tr><th>Artifact</th><th>Used on</th><th>Record</th></tr></thead>
          <tbody>
            {profile.artifacts.map((a) => (
              <tr key={a.artifact} className={isSmallSample(a.games) ? 'low' : undefined}>
                <td>{a.artifact}</td>
                <td>{percent(a.share)} · {a.games} teams</td>
                <td><Rate r={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>Common variations</h4>
      {profile.variations.length === 0 ? (
        <p className="muted">No lineup was recorded 3 times.</p>
      ) : (
        <ul className="stats-detail">
          {profile.variations.map((v) => (
            <li key={v.flex.join('/')}>
              {v.flex.length === 0 ? 'The core alone' : `+${v.flex.length} flex: ${plain(v.flex)}`} — <Rate r={v} />
            </li>
          ))}
        </ul>
      )}
      {profile.otherLineups.length > 0 && (
        <>
          <h4>Other recorded lineups</h4>
          <ul className="stats-detail">
            {profile.otherLineups.map((l) => (
              <li key={l.heroes.join('/')}>
                {plain(l.heroes)} — <Rate r={l} />
              </li>
            ))}
          </ul>
        </>
      )}
      {profile.heroImpact.length > 0 && (
        <>
          <h4>Hero impact</h4>
          <p className="muted">Results with and without each flex hero, over all the group's games. It does not isolate the effect of one swap.</p>
          <ul className="stats-detail">
            {profile.heroImpact.map((h) => (
              <li key={h.hero}>
                {h.hero}: with <Rate r={h.with} />, without <Rate r={h.without} />
              </li>
            ))}
          </ul>
        </>
      )}
      {matchups('Strong against', profile.strongAgainst)}
      {matchups('Weak against', profile.weakAgainst)}
      <Placement placement={profile.placement} maps={maps} />
      <h4>Results by upgrade gap</h4>
      <p className="muted">Ranks and equipment of the group's side against the other side, from the snapshots of each battle; unknown when a rank is missing.</p>
      <ul className="stats-detail">
        {gaps.map(([key, label]) => (
          <li key={key}>{`${label}: ${record(profile.gapRecords[key])} of ${profile.gapRecords[key].games}`}</li>
        ))}
      </ul>
      {profile.gapAdjustment && (
        <p className="muted">
          With equal upgrades the expected win rate would move by {points(profile.gapAdjustment.shift)} ({profile.gapAdjustment.games} battles with a known gap).
        </p>
      )}
    </>
  );
}

function GroupRow({ group, baseline, filters, maps, opened, toggle }: { group: FormationGroupRow; baseline: number; filters: Filters; maps: GameMap[]; opened: boolean; toggle: () => void }) {
  const core = coreNames(group.core);
  return (
    <Fragment>
      <tr className={isSmallSample(group.games) ? 'low' : undefined}>
        <td>
          <button className="link" aria-expanded={opened} onClick={toggle}>
            {opened ? '▾' : '▸'} <span className="unit-inline">{core.map((h) => <Portrait key={h} kind="hero" name={h} size={24} />)}</span> {plain(core)}
          </button>
        </td>
        <td>{group.flex.map((h) => heroChip(h, true))}</td>
        <td>{group.artifact ? `${group.artifact.artifact} ${percent(group.artifact.share)}` : ''}</td>
        <td>{record(group)} of {group.games}</td>
        <td>
          {percent(group.winRate)} <span className="muted" title={`The win rate of all sides is ${percent(baseline)}`}>{points(group.vsAverage)}</span>
        </td>
        <td>{group.players}</td>
        <td>
          {group.labels.map((l) => (
            <span key={l.name} className="badge few">{l.detail ? `${l.name}: ${l.detail}` : l.name}</span>
          ))}
          {isSmallSample(group.games) && <span className="badge few">few games</span>}
        </td>
      </tr>
      {opened && (
        <tr>
          <td colSpan={7}>
            <div role="region" aria-label={`Profile of ${plain(core)}`}>
              <Profile core={core} filters={filters} maps={maps} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function ArchetypeHeader({ row }: { row: ArchetypeStat }) {
  return (
    <tr>
      <th colSpan={7} scope="colgroup">
        {`Archetype: ${plain(coreNames(row.core))} · ${row.groups.length} groups · ${row.games} games (${record(row)}) · ${row.players} players`}
      </th>
    </tr>
  );
}

/** The Formation groups of the recorded sides under their Archetype rows, counted from the owner's own records. */
export function FormationGroups({ filters }: { filters: Filters }) {
  const maps = useMaps();
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // an answer that arrives after the filters changed again is dropped (useLoad)
  const heroList = useLoad(() => api.statsHeroes({ mode: filters.mode }), [filters.mode]);
  const heroes = useMemo(() => (heroList.data ?? []).map((x) => x.hero).sort(), [heroList.data]);
  const loaded = useLoad(
    () => api.statsFormationReport({ mode: filters.mode, tag: filters.tag, player: filters.player, excludeDefault: filters.excludeDefault ? 'true' : '', min: filters.min, hero: picked }),
    [filters, picked],
  );
  const report: FormationReport | null = loaded.data ?? null;
  const error = loaded.error;

  const toggle = (key: string) => setOpen((old) => toggled(old, key));

  return (
    <>
      <p className="muted">
        A group is a set of lineups that differ by one hero. A core hero is in at least 80% of the group's games and a flex hero in 15% to below 80%, each with its share. Groups that share two or more core heroes sit under one archetype. The win rate is set against all sides under these filters ({report ? percent(report.baseline) : '…'}).
      </p>
      <div className="filters">
        <MultiSelect label="Hero" options={heroes} value={picked} onChange={setPicked} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {report && report.rows.length === 0 && <p className="muted">Nothing to show with these filters.</p>}
      {report && report.rows.length > 0 && (
        <table className="board" aria-label="Formation groups">
          <thead>
            <tr>
              <th>Core</th>
              <th>Flex</th>
              <th>Artifact</th>
              <th>Record</th>
              <th>Win rate</th>
              <th>Players</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <Fragment key={coreNames(row.groups[0]!.core).join('/')}>
                {row.groups.length > 1 && <ArchetypeHeader row={row} />}
                {row.groups.map((group) => {
                  const key = coreNames(group.core).join('/');
                  return <GroupRow key={key} group={group} baseline={report.baseline} filters={filters} maps={maps} opened={open.has(key)} toggle={() => toggle(key)} />;
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
