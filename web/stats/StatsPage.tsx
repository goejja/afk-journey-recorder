import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RECORD_MODES } from '../../src/domain/arena.js';
import { weaponLabel } from '../../src/domain/exclusive-weapon.js';
import { isSmallSample, SMALL_SAMPLE } from '../../src/domain/stats.js';
import { STAGE_KINDS } from '../../src/domain/stage.js';
import { useLoad } from '../useLoad.js';
import { api, type ArtifactStat, type HeroStat, type MapStat, type RowStat, type RuleStat, type PairStat, type PlayerStat, type StageStat, type Summary, type TrioStat } from '../backend.js';
import { FormationGroups } from './FormationGroups.js';
import { Portrait } from '../Portrait.js';
import { MultiSelect } from '../MultiSelect.js';
import { TagFilter } from '../Tags.js';
import { percent, toggled } from '../format.js';

type View = 'overview' | 'players' | 'formations' | 'heroes' | 'pairs' | 'artifacts' | 'maps' | 'stages' | 'phantimals';


function WinBar({ wins, games }: { wins: number; games: number }) {
  const rate = games === 0 ? 0 : wins / games;
  return (
    <span className="winbar" role="img" aria-label={`${percent(rate)} of ${games}`}>
      <span className="winbar-fill" style={{ width: percent(rate) }} />
    </span>
  );
}

interface Column<Row> {
  key: string;
  header: string;
  value: (row: Row) => number | string;
  render?: (row: Row) => ReactNode;
}

/** A table whose columns sort on a click; rows with a small sample are dimmed and flagged. */
function StatsTable<Row extends { games: number; wins: number }>({ rows, columns, rowKey, detail, label }: {
  /** Names the table for screen readers, when a page holds several. */
  label?: string;
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  /** Rows that open on a click of their first cell, closed at first: the label of the opened region and what it holds. */
  detail?: { label: (row: Row) => string; render: (row: Row) => ReactNode };
}) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((old) => toggled(old, key));
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key);
    if (!column || !sort) return rows;
    return [...rows].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.descending ? -order : order;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0) return <p className="muted">Nothing to show with these filters.</p>;
  return (
    <table className="board" aria-label={label}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} aria-sort={sort?.key === c.key ? (sort.descending ? 'descending' : 'ascending') : undefined}>
              <button className="link" onClick={() => setSort({ key: c.key, descending: sort?.key === c.key ? !sort.descending : true })}>
                {c.header}
              </button>
            </th>
          ))}
          <th>Win rate</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const key = rowKey(row);
          const opened = detail !== undefined && open.has(key);
          return (
            <Fragment key={key}>
              <tr className={isSmallSample(row.games) ? 'low' : undefined}>
                {columns.map((c, i) => {
                  const cell = c.render ? c.render(row) : c.value(row);
                  return (
                    <td key={c.key}>
                      {detail && i === 0 ? (
                        <button className="link" aria-expanded={opened} onClick={() => toggle(key)}>
                          {opened ? '▾' : '▸'} {cell}
                        </button>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
                <td>
                  <WinBar wins={row.wins} games={row.games} />
                  {isSmallSample(row.games) && <span className="badge few"> few games</span>}
                </td>
              </tr>
              {opened && (
                <tr>
                  <td colSpan={columns.length + 1}>
                    <div role="region" aria-label={detail.label(row)}>
                      {detail.render(row)}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** Rank by equipment level, with how many Players fielded the hero in each state. It is asked for when a hero is opened. */
function HeroDistributionGrid({ hero, mode, tag, player }: { hero: string; mode: string[]; tag: string[]; player: string[] }) {
  const { data: distribution, error } = useLoad(() => api.statsHeroDistribution(hero, { mode, tag, player }), [hero, mode, tag, player]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!distribution) return <p className="muted">Loading…</p>;
  const ranks = [...new Set(distribution.cells.map((c) => c.rank))];
  const levels = [...new Set(distribution.cells.map((c) => c.equipmentLevel))].sort((a, b) => (a ?? -1) - (b ?? -1));
  return (
    <>
      <p className="muted">
        {distribution.players} players
        {distribution.unknown > 0 && ` · ${distribution.unknown} with no rank known`}
        {isSmallSample(distribution.players) && ' · few players, too few to trust'}. One count per player, from their latest record.
      </p>
      {ranks.length > 0 && (
        <table className="board" aria-label={`Rank and equipment of ${hero}`}>
          <thead>
            <tr>
              <th>Rank</th>
              {levels.map((l) => (
                <th key={String(l)}>{l === null ? 'No equipment' : weaponLabel(l)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranks.map((rank) => (
              <tr key={rank}>
                <th scope="row">{rank}</th>
                {levels.map((l) => (
                  <td key={String(l)}>{distribution.cells.find((c) => c.rank === rank && c.equipmentLevel === l)?.players}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** A hero's win rate by row of the board. Asked for when a hero is opened. */
function HeroRows({ hero, mode, tag, player }: { hero: string; mode: string[]; tag: string[]; player: string[] }) {
  const { data: rows, error } = useLoad(() => api.statsHeroRows(hero, { mode, tag, player }), [hero, mode, tag, player]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return null;
  return (
    <>
      <p className="muted">Win rate by game row: the diagonal rows of the board, counted from the back edge of the hero’s own side (row 1 is the back row, 15 the front one). A Side B tile is turned over, so both sides read the same way.</p>
      <StatsTable
        label={`Rows of ${hero}`}
        rows={rows}
        rowKey={(r) => String(r.row)}
        columns={[
          { key: 'row', header: 'Row', value: (r) => r.row, render: (r) => (r.row === 1 ? 'Row 1 (back edge)' : `Row ${r.row}`) },
          ...rateColumns<RowStat>(),
        ]}
      />
    </>
  );
}

const heroCell = (name: string) => (
  <span className="unit-inline">
    <Portrait kind="hero" name={name} size={24} /> {name}
  </span>
);
const formationCell = (heroes: string[]) => (
  <span className="unit-inline">
    {heroes.map((h, i) => (
      <span key={h}>{i > 0 && ' + '}{heroCell(h)}</span>
    ))}
  </span>
);
const rateColumns = <Row extends { games: number; wins: number; winRate: number }>(): Column<Row>[] => [
  { key: 'games', header: 'Games', value: (r) => r.games },
  { key: 'wins', header: 'Wins', value: (r) => r.wins },
  { key: 'winRate', header: 'Rate', value: (r) => r.winRate, render: (r) => percent(r.winRate) },
];

/** The stored records whose Phantimal its own heroes cannot have brought (ADR 0029). Read only: nothing here changes a record. */
function FactionMismatchList() {
  const { data, error } = useLoad(() => api.factionMismatches(), []);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Checking the records…</p>;
  if (data.length === 0) return <p className="muted">Every recorded Phantimal has the heroes that bring it.</p>;
  return (
    <>
      <p className="muted">
        A Phantimal stands only where the mode allows one, and only when three heroes of its faction are on the field. These records name one that could not have stood there, which usually
        means the reader misread the Phantimal or a hero of a Battle import. Nothing is changed here: check the record and its picture.
      </p>
      <table className="stats" aria-label="Phantimal check">
        <thead>
          <tr>
            <th>Battle</th>
            <th>Side</th>
            <th>Mode</th>
            <th>Map</th>
            <th>Phantimal</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={`${row.attemptId}-${row.side}`}>
              <td>{row.attemptId}</td>
              <td>{row.side}</td>
              <td>{row.mode}</td>
              <td>{row.mapName ?? '–'}</td>
              <td>{row.phantimal}</td>
              <td>{row.problem}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function StatsPage() {
  const [view, setView] = useState<View>('overview');
  const [mode, setMode] = useState<string[]>([]);
  // The Mode filter starts with the modes chosen in Admin; nothing is asked for before they are known, so no view first shows every mode.
  const [modesReady, setModesReady] = useState(false);
  const [tag, setTag] = useState<string[]>([]);
  const [player, setPlayer] = useState<string[]>([]);
  const [excludeDefault, setExcludeDefault] = useState(false);
  const [knownPlayers, setKnownPlayers] = useState<PlayerStat[] | null>(null);
  const [min, setMin] = useState('1');
  const [kind, setKind] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [heroes, setHeroes] = useState<HeroStat[]>([]);
  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [pairs, setPairs] = useState<PairStat[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactStat[]>([]);
  const [maps, setMaps] = useState<MapStat[]>([]);
  const [rules, setRules] = useState<RuleStat[]>([]);
  const [trios, setTrios] = useState<TrioStat[]>([]);
  const [size, setSize] = useState<2 | 3>(2);
  const [stages, setStages] = useState<StageStat[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.statsSettings().then(
      (settings) => setMode(settings.modes),
      () => undefined, // unreadable: start with every mode
    ).finally(() => setModesReady(true));
  }, []);

  useEffect(() => {
    if (!modesReady) return;
    const filters = { tag, player, excludeDefault: excludeDefault ? 'true' : '', min: String(Math.max(1, Number(min) || 1)) };
    const withMode = { ...filters, mode };
    // An answer that comes after the filters changed again is dropped, so a slow old request cannot overwrite a newer one.
    let live = true;
    const keep =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        if (live) set(value);
      };
    const load = {
      overview: () => api.statsSummary().then(keep(setSummary)),
      players: () => api.statsPlayers({ mode, excludeDefault: filters.excludeDefault, min: filters.min }).then(keep(setPlayers)),
      formations: () => Promise.resolve(), // the Formations view loads its own report
      heroes: () => api.statsHeroes(withMode).then(keep(setHeroes)),
      pairs: () => (size === 3 ? api.statsTrios(withMode).then(keep(setTrios)) : api.statsPairs(withMode).then(keep(setPairs))),
      artifacts: () => api.statsArtifacts(withMode).then(keep(setArtifacts)),
      maps: () => Promise.all([api.statsMaps(withMode).then(keep(setMaps)), api.statsRules(withMode).then(keep(setRules))]).then(() => undefined),
      stages: () => api.statsStages({ tag, min: filters.min, kind }).then(keep(setStages)),
      phantimals: () => Promise.resolve(), // the Phantimal check loads its own list
    }[view];
    load().then(
      () => live && setError(null),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [modesReady, view, mode, tag, player, min, kind, size, excludeDefault]);

  // The Players to choose from, read once when a view that filters by Player is first opened.
  const filtersByPlayer = view === 'formations' || view === 'heroes' || view === 'pairs' || view === 'artifacts' || view === 'maps';
  useEffect(() => {
    if (filtersByPlayer && knownPlayers === null) api.statsPlayers({}).then(setKnownPlayers, () => setKnownPlayers([]));
  }, [filtersByPlayer, knownPlayers]);

  /** Trios are rare, so a trio starts at 3 games and a pair at 1, unless the player typed another minimum. */
  function chooseSize(next: 2 | 3) {
    setSize(next);
    if (min === (next === 3 ? '1' : '3')) setMin(next === 3 ? '3' : '1');
  }

  const formationFilters = useMemo(() => ({ mode, tag, player, excludeDefault, min: String(Math.max(1, Number(min) || 1)) }), [mode, tag, player, excludeDefault, min]);
  const modes: readonly string[] = RECORD_MODES;

  return (
    <section>
      <p className="muted">
        Win rates are counted from your recorded battles, not simulated. Rows with fewer than {SMALL_SAMPLE} games are dimmed: too few to trust. In Arena, each
        hero is counted on both sides, with the result flipped for Side B.
      </p>
      <div className="tabs" role="tablist">
        {([['overview', 'Overview'], ['players', 'Players'], ['formations', 'Formations'], ['heroes', 'Heroes'], ['pairs', 'Hero groups'], ['artifacts', 'Artifacts'], ['maps', 'Maps & rules'], ['stages', 'Stages'], ['phantimals', 'Phantimal check']] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>
      {view !== 'overview' && (
        <div className="filters">
          {(view === 'players' || view === 'formations' || view === 'heroes' || view === 'pairs' || view === 'artifacts' || view === 'maps') && (
            <MultiSelect label="Mode" options={[...modes]} value={mode} onChange={setMode} />
          )}
          {view === 'pairs' && (
            <div className="field" role="radiogroup" aria-label="Group size">
              {([[2, 'Pairs'], [3, 'Trios']] as const).map(([n, label]) => (
                <label key={n} className="check">
                  <input type="radio" name="group-size" checked={size === n} onChange={() => chooseSize(n)} /> {label}
                </label>
              ))}
            </div>
          )}
          {view === 'stages' && (
            <MultiSelect label="Kind" options={[...STAGE_KINDS]} value={kind} onChange={setKind} />
          )}
          {filtersByPlayer && (
            <MultiSelect
              label="Player"
              options={(knownPlayers ?? []).map((p) => p.playerId)}
              value={player}
              onChange={setPlayer}
              format={(id) => {
                const known = knownPlayers?.find((p) => p.playerId === id);
                return known?.name ?? `ID ${id}`;
              }}
            />
          )}
          {(view === 'players' || filtersByPlayer) && (
            <label className="check">
              <input type="checkbox" checked={excludeDefault} onChange={(e) => setExcludeDefault(e.target.checked)} /> Leave out my own records
            </label>
          )}
          {view !== 'players' && <TagFilter value={tag} onChange={setTag} />}
          <label className="field">
            At least (games)
            <input type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {view === 'overview' && summary && (
        <>
          {summary.records.length === 0 && <p className="muted">No records yet.</p>}
          <table className="board">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Records</th>
                <th>Wins</th>
                <th>Win rate</th>
                <th>First</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {summary.records.map((r) => (
                <tr key={r.mode}>
                  <td>{r.mode}</td>
                  <td>{r.records}</td>
                  <td>{r.wins}</td>
                  <td>
                    <WinBar wins={r.wins} games={r.records} /> {percent(r.wins / r.records)}
                  </td>
                  <td>{r.first}</td>
                  <td>{r.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.tags.length > 0 && (
            <p className="muted">
              Tags: {summary.tags.map((t) => `${t.tag} (${t.records})`).join(', ')}
            </p>
          )}
        </>
      )}
      {view === 'players' && (
        <StatsTable
          rows={players}
          rowKey={(r) => r.playerId}
          detail={{
            label: (r) => `Formations of ${r.name ?? `ID ${r.playerId}`}`,
            render: (r) => (
              <ul className="stats-detail">
                {r.formations.map((f) => (
                  <li key={f.heroes.join('/')}>
                    {formationCell(f.heroes)} <span className="muted">{f.games} games · {percent(f.winRate)}</span>
                  </li>
                ))}
              </ul>
            ),
          }}
          columns={[
            {
              key: 'player',
              header: 'Player',
              value: (r) => r.name ?? r.playerId,
              render: (r) => (
                <>
                  {r.name ?? `ID ${r.playerId}`} {r.name && <span className="muted">ID {r.playerId}</span>}
                </>
              ),
            },
            ...rateColumns<PlayerStat>(),
            { key: 'modes', header: 'Modes', value: (r) => r.modes.join(', ') },
            { key: 'last', header: 'Last record', value: (r) => r.last },
          ]}
        />
      )}
      {view === 'formations' && modesReady && <FormationGroups filters={formationFilters} />}
      {view === 'phantimals' && <FactionMismatchList />}
      {view === 'artifacts' && (
        <StatsTable
          rows={artifacts}
          rowKey={(r) => r.artifact}
          columns={[{ key: 'artifact', header: 'Artifact', value: (r) => r.artifact }, ...rateColumns<ArtifactStat>()]}
        />
      )}
      {view === 'maps' && (
        <>
          <p className="muted">Both sides of a battle share the map and the rule, so counting both would always give half: only Side A is counted.</p>
          <h3>Maps</h3>
          <StatsTable label="Maps" rows={maps} rowKey={(r) => r.map} columns={[{ key: 'map', header: 'Map', value: (r) => r.map }, ...rateColumns<MapStat>()]} />
          <h3>Rules</h3>
          <StatsTable label="Rules" rows={rules} rowKey={(r) => r.rule} columns={[{ key: 'rule', header: 'Rule', value: (r) => r.rule }, ...rateColumns<RuleStat>()]} />
        </>
      )}
      {view === 'heroes' && (
        <StatsTable
          rows={heroes}
          rowKey={(r) => r.hero}
          detail={{
            label: (r) => `Rank and equipment of ${r.hero}`,
            render: (r) => (
              <>
                <HeroDistributionGrid hero={r.hero} mode={mode} tag={tag} player={player} />
                <HeroRows hero={r.hero} mode={mode} tag={tag} player={player} />
              </>
            ),
          }}
          columns={[
            { key: 'hero', header: 'Hero', value: (r) => r.hero, render: (r) => heroCell(r.hero) },
            ...rateColumns<HeroStat>(),
            { key: 'pickRate', header: 'Pick rate', value: (r) => r.pickRate, render: (r) => percent(r.pickRate) },
          ]}
        />
      )}
      {view === 'pairs' && size === 3 && (
        <StatsTable
          rows={trios}
          rowKey={(r) => `${r.heroA}/${r.heroB}/${r.heroC}`}
          columns={[
            { key: 'trio', header: 'Trio', value: (r) => `${r.heroA} + ${r.heroB} + ${r.heroC}`, render: (r) => <span className="unit-inline">{heroCell(r.heroA)} + {heroCell(r.heroB)} + {heroCell(r.heroC)}</span> },
            ...rateColumns<TrioStat>(),
          ]}
        />
      )}
      {view === 'pairs' && size === 2 && (
        <StatsTable
          rows={pairs}
          rowKey={(r) => `${r.heroA}/${r.heroB}`}
          columns={[
            { key: 'pair', header: 'Pair', value: (r) => `${r.heroA} + ${r.heroB}`, render: (r) => <span className="unit-inline">{heroCell(r.heroA)} + {heroCell(r.heroB)}</span> },
            ...rateColumns<PairStat>(),
          ]}
        />
      )}
      {view === 'stages' && (
        <StatsTable
          rows={stages}
          rowKey={(r) => `${r.season}/${r.phase}/${r.kind}/${r.number}`}
          columns={[
            { key: 'stage', header: 'Stage', value: (r) => `S${r.season} ${r.kind}${r.phase ? ` p${r.phase}` : ''} ${String(r.number).padStart(5, '0')}`, render: (r) => `S${r.season} · ${r.kind}${r.phase ? ` (phase ${r.phase})` : ''} · ${r.number}` },
            ...rateColumns<StageStat>(),
            { key: 'last', header: 'Last attempt', value: (r) => r.last },
          ]}
        />
      )}
    </section>
  );
}
