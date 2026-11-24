import { useEffect, useMemo, useState } from 'react';
import { RECORD_MODES } from '../../src/domain/arena.js';
import { weaponLabel } from '../../src/domain/exclusive-weapon.js';
import { HERO_SETS_SHOWN, isSmallSample, MAX_HERO_SET_ROWS, SMALL_SAMPLE } from '../../src/domain/stats.js';
import { useLoad } from '../hooks/load.js';
import { api, type ArtifactStat, type HeroStat, type MapStat, type RowStat, type PairStat, type PlayerStat, type StatRows, type Summary, type TrioStat } from '../backend.js';
import { BackCheckList } from './BackCheckList.js';
import { DunlingrCheckList } from './DunlingrCheckList.js';
import { FormationGroups } from './FormationGroups.js';
import { MapFormations } from './MapFormations.js';
import { Partners } from './Partners.js';
import { heroCell, rateColumns, StatsTable, WinBar, type Column } from './StatsTable.js';
import { RecordLink } from '../records/RecordLink.js';
import { MultiSelect } from '../MultiSelect.js';
import { TagFilter } from '../Tags.js';
import { percent } from '../format.js';
import { TabPanel, Tabs } from '../ui/Tabs.js';
import { Notice } from '../ui/Notice.js';
import { Loading } from '../ui/ListStatus.js';
import { ShowMore } from '../ui/ShowMore.js';

type View = 'overview' | 'players' | 'formations' | 'heroes' | 'pairs' | 'partners' | 'artifacts' | 'maps' | 'phantimals' | 'placement';

const VIEWS: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'players', label: 'Players' },
  { key: 'formations', label: 'Formations' },
  { key: 'heroes', label: 'Heroes' },
  { key: 'pairs', label: 'Hero pairs and trios' },
  { key: 'partners', label: 'Partners' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'maps', label: 'Maps' },
  { key: 'phantimals', label: 'Phantimal check' },
  { key: 'placement', label: 'Placement check' },
];


/** Rank by equipment level, with how many Players fielded the hero in each state. It is asked for when a hero is opened. */
function HeroDistributionGrid({ hero, mode, tag, player, playedIn }: { hero: string; mode: string[]; tag: string[]; player: string[]; playedIn: string[] }) {
  const { data: distribution, error } = useLoad(() => api.statsHeroDistribution(hero, { mode, tag, player, playedIn }), [hero, mode, tag, player, playedIn]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!distribution) return <Loading />;
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
        <table className="data-table" aria-label={`Rank and equipment of ${hero}`}>
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

/** A hero's win rate by row of the map. Asked for when a hero is opened. */
function HeroRows({ hero, mode, tag, player, playedIn }: { hero: string; mode: string[]; tag: string[]; player: string[]; playedIn: string[] }) {
  const { data: rows, error } = useLoad(() => api.statsHeroRows(hero, { mode, tag, player, playedIn }), [hero, mode, tag, player, playedIn]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!rows) return null;
  return (
    <>
      <p className="muted">Win rate by game row: the diagonal rows of the map, counted from the back edge of the hero’s own side (row 1 is the back row, 15 the front one). A Side B tile is turned over, so both sides read the same way.</p>
      <StatsTable
        label={`Rows of ${hero}`}
        rows={rows}
        rowKey={heroRowKey}
        columns={heroRowColumns}
      />
    </>
  );
}

const formationCell = (heroes: string[]) => (
  <span className="unit-inline">
    {heroes.map((h, i) => (
      <span key={h}>{i > 0 && ' + '}{heroCell(h)}</span>
    ))}
  </span>
);
// The columns, row keys and details of the tables are made once: a table skips its render when the rows it was given are the ones it drew
// (see StatsTable). A column list made inside a component would be a new array on every render of the page.
const heroRowColumns: Column<RowStat>[] = [
  { key: 'row', header: 'Row', value: (r) => r.row, render: (r) => (r.row === 1 ? 'Row 1 (back edge)' : `Row ${r.row}`) },
  ...rateColumns<RowStat>(),
];
const heroRowKey = (r: RowStat) => String(r.row);

const playerColumns: Column<PlayerStat>[] = [
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
];
const playerKey = (r: PlayerStat) => r.playerId;
const playerDetail = {
  label: (r: PlayerStat) => `Formations of ${r.name ?? `ID ${r.playerId}`}`,
  render: (r: PlayerStat) => (
    <ul className="stats-detail">
      {r.formations.map((f) => (
        <li key={f.heroes.join('/')}>
          {formationCell(f.heroes)} <span className="muted">{f.games} games · {percent(f.winRate)}</span>
        </li>
      ))}
    </ul>
  ),
};

const artifactColumns: Column<ArtifactStat>[] = [{ key: 'artifact', header: 'Artifact', value: (r) => r.artifact }, ...rateColumns<ArtifactStat>()];
const artifactKey = (r: ArtifactStat) => r.artifact;

const mapColumns: Column<MapStat>[] = [{ key: 'map', header: 'Map', value: (r) => r.map }, ...rateColumns<MapStat>()];
const mapKey = (r: MapStat) => r.map;

const heroColumns: Column<HeroStat>[] = [
  { key: 'hero', header: 'Hero', value: (r) => r.hero, render: (r) => heroCell(r.hero) },
  ...rateColumns<HeroStat>(),
  { key: 'pickRate', header: 'Pick rate', value: (r) => r.pickRate, render: (r) => percent(r.pickRate) },
];
const heroKey = (r: HeroStat) => r.hero;

const trioColumns: Column<TrioStat>[] = [
  { key: 'trio', header: 'Trio', value: (r) => `${r.heroA} + ${r.heroB} + ${r.heroC}`, render: (r) => <span className="unit-inline">{heroCell(r.heroA)} + {heroCell(r.heroB)} + {heroCell(r.heroC)}</span> },
  ...rateColumns<TrioStat>(),
];
const trioKey = (r: TrioStat) => `${r.heroA}/${r.heroB}/${r.heroC}`;

const pairColumns: Column<PairStat>[] = [
  { key: 'pair', header: 'Pair', value: (r) => `${r.heroA} + ${r.heroB}`, render: (r) => <span className="unit-inline">{heroCell(r.heroA)} + {heroCell(r.heroB)}</span> },
  ...rateColumns<PairStat>(),
];
const pairKey = (r: PairStat) => `${r.heroA}/${r.heroB}`;

type HeroSetSort = 'winRate' | 'games';
const NO_HERO_SETS = { rows: [], total: 0 };

/** Says that a list of pairs or trios is cut to its best rows, by what, and offers the next rows; nothing when the whole list is shown. */
function HeroSetCut({ shown, total, noun, sort, limit, onMore }: { shown: number; total: number; noun: string; sort: HeroSetSort; limit: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <>
      <p className="muted">
        Showing the top {shown} of {total} {noun} by {sort === 'games' ? 'games played' : 'win rate'}.
        {limit >= MAX_HERO_SET_ROWS && ' That is the most the list can show: raise “At least (games)” to narrow it.'}
      </p>
      {limit < MAX_HERO_SET_ROWS && <ShowMore label={`Show ${Math.min(HERO_SETS_SHOWN, total - shown)} more`} onMore={onMore} />}
    </>
  );
}

/** The stored records whose Phantimal its own heroes cannot have brought (ADR 0029). Read only: nothing here changes a record. */
function FactionMismatchList() {
  const { data, error } = useLoad(() => api.factionMismatches(), []);
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="muted">Checking the records…</p>;
  if (data.length === 0) return <p className="muted">Every recorded Phantimal has the heroes that bring it.</p>;
  return (
    <>
      <p className="muted">
        A Phantimal stands only where the mode allows one, and only when three heroes of its faction are on the field. These records name one that could not have stood there, which usually
        means the reader misread the Phantimal or a hero of a Battle import. Nothing is changed here: check the record and its picture.
      </p>
      <table className="data-table" aria-label="Phantimal check">
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
              <td><RecordLink mode={row.mode} id={row.attemptId} /></td>
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
  // The seasons records were played in (ADR 0038), as numbers written out; none means every season.
  const [playedIn, setPlayedIn] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [excludeDefault, setExcludeDefault] = useState(false);
  const [knownPlayers, setKnownPlayers] = useState<PlayerStat[] | null>(null);
  const [min, setMin] = useState('1');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [heroes, setHeroes] = useState<HeroStat[]>([]);
  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [pairs, setPairs] = useState<StatRows<PairStat>>(NO_HERO_SETS);
  const [artifacts, setArtifacts] = useState<ArtifactStat[]>([]);
  const [maps, setMaps] = useState<MapStat[]>([]);
  const [trios, setTrios] = useState<StatRows<TrioStat>>(NO_HERO_SETS);
  const [heroSetSort, setGroupSort] = useState<HeroSetSort>('winRate');
  /** How many pairs or trios were asked for, and under which filters: another filter starts again from the first page. */
  const [asked, setAsked] = useState<{ key: string; limit: number }>({ key: '', limit: HERO_SETS_SHOWN });
  const [size, setSize] = useState<2 | 3>(2);
  const [error, setError] = useState<string | null>(null);
  // The lists the filters offer (seasons, Players) are read apart from the report, so a failure to read them is kept apart too: the report's own load clears `error`.
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    api.statsSettings().then(
      (settings) => setMode(settings.modes),
      () => undefined, // unreadable: start with every mode
    ).finally(() => setModesReady(true));
  }, []);

  const heroSetsKey = JSON.stringify([mode, tag, player, playedIn, excludeDefault, min, size, heroSetSort]);
  const heroSetLimit = asked.key === heroSetsKey ? asked.limit : HERO_SETS_SHOWN;

  useEffect(() => {
    if (!modesReady) return;
    const filters = { tag, player, playedIn, excludeDefault: excludeDefault ? 'true' : '', min: String(Math.max(1, Number(min) || 1)) };
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
      players: () => api.statsPlayers({ mode, playedIn, excludeDefault: filters.excludeDefault, min: filters.min }).then(keep(setPlayers)),
      formations: () => Promise.resolve(), // the Formations view loads its own report
      partners: () => Promise.resolve(), // the Partners view loads its own report
      heroes: () => api.statsHeroes(withMode).then(keep(setHeroes)),
      pairs: () => {
        // what the server does when nothing is said (the best 500 by win rate) is left unsaid
        const cut = { ...withMode, ...(heroSetLimit > HERO_SETS_SHOWN ? { limit: String(heroSetLimit) } : {}), ...(heroSetSort === 'games' ? { sort: heroSetSort } : {}) };
        return size === 3 ? api.statsTrios(cut).then(keep(setTrios)) : api.statsPairs(cut).then(keep(setPairs));
      },
      artifacts: () => api.statsArtifacts(withMode).then(keep(setArtifacts)),
      maps: () => api.statsMaps(withMode).then(keep(setMaps)),
      phantimals: () => Promise.resolve(), // the Phantimal check loads its own list
      placement: () => Promise.resolve(), // the placement check loads its own list
    }[view];
    load().then(
      () => live && setError(null),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [modesReady, view, mode, tag, player, playedIn, min, size, excludeDefault, heroSetSort, heroSetLimit]);

  // The seasons to choose from, read once when a view that filters by season is first opened.
  const filtersBySeason = view !== 'overview' && view !== 'phantimals' && view !== 'placement';
  useEffect(() => {
    if (filtersBySeason && seasons.length === 0) api.seasons().then((all) => setSeasons(all.filter((s) => s.records > 0).map((s) => String(s.number))), (e: Error) => setOptionsError(`The seasons to choose from could not be read: ${e.message}`));
  }, [filtersBySeason, seasons.length]);

  // The Players to choose from, read once when a view that filters by Player is first opened.
  const filtersByPlayer = view === 'formations' || view === 'heroes' || view === 'pairs' || view === 'partners' || view === 'artifacts' || view === 'maps';
  useEffect(() => {
    if (filtersByPlayer && knownPlayers === null) api.statsPlayers({}).then(setKnownPlayers, (e: Error) => (setKnownPlayers([]), setOptionsError(`The Players to choose from could not be read: ${e.message}`)));
  }, [filtersByPlayer, knownPlayers]);

  /** Trios are rare, so a trio starts at 3 games and a pair at 1, unless the player typed another minimum. */
  function chooseSize(next: 2 | 3) {
    setSize(next);
    if (min === (next === 3 ? '1' : '3')) setMin(next === 3 ? '3' : '1');
  }

  const formationFilters = useMemo(() => ({ mode, tag, player, playedIn, excludeDefault, min: String(Math.max(1, Number(min) || 1)) }), [mode, tag, player, playedIn, excludeDefault, min]);
  const modes: readonly string[] = RECORD_MODES;
  // What opens under a row of the Maps and Heroes tables depends on the filters, so it is made again only when they change.
  const mapDetail = useMemo(
    () => ({
      label: (r: MapStat) => `Best formations on ${r.map}`,
      render: (r: MapStat) => <MapFormations map={r.map} filters={{ mode, tag, player, playedIn, excludeDefault: excludeDefault ? 'true' : '' }} />,
    }),
    [mode, tag, player, playedIn, excludeDefault],
  );
  const heroDetail = useMemo(
    () => ({
      label: (r: HeroStat) => `Rank and equipment of ${r.hero}`,
      render: (r: HeroStat) => (
        <>
          <HeroDistributionGrid hero={r.hero} mode={mode} tag={tag} player={player} playedIn={playedIn} />
          <HeroRows hero={r.hero} mode={mode} tag={tag} player={player} playedIn={playedIn} />
        </>
      ),
    }),
    [mode, tag, player, playedIn],
  );

  return (
    <section>
      <p className="muted">
        Win rates are counted from your recorded battles, not simulated. Rows with fewer than {SMALL_SAMPLE} games are dimmed: too few to trust. In Arena, each
        hero is counted on both sides, with the result flipped for Side B.
      </p>
      <Tabs id="stats" label="Statistics views" tabs={VIEWS} value={view} onChange={setView} />
      <TabPanel id="stats" value={view}>
        {view !== 'overview' && (
          <div className="filters">
            {(view === 'players' || view === 'formations' || view === 'heroes' || view === 'pairs' || view === 'partners' || view === 'artifacts' || view === 'maps') && (
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
            {view === 'pairs' && (
              <label className="field">
                Sort by
                <select value={heroSetSort} onChange={(e) => setGroupSort(e.target.value as HeroSetSort)}>
                  <option value="winRate">Win rate</option>
                  <option value="games">Games played</option>
                </select>
              </label>
            )}
            {filtersBySeason && <MultiSelect label="Played in season" options={seasons} value={playedIn} onChange={setPlayedIn} format={(s) => `Season ${s}`} />}
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
          <Notice kind="error">
            {error}
          </Notice>
        )}
        {optionsError && (
          <Notice kind="error">
            {optionsError}
          </Notice>
        )}

        {view === 'overview' && summary && (
          <>
            {summary.records.length === 0 && <p className="muted">No records yet.</p>}
            <table className="data-table">
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
          <StatsTable rows={players} rowKey={playerKey} detail={playerDetail} columns={playerColumns} />
        )}
        {view === 'formations' && modesReady && <FormationGroups filters={formationFilters} />}
        {view === 'partners' && modesReady && <Partners filters={formationFilters} />}
        {view === 'phantimals' && <FactionMismatchList />}
        {view === 'placement' && (
          <>
            <BackCheckList />
            <DunlingrCheckList />
          </>
        )}
        {view === 'artifacts' && (
          <StatsTable rows={artifacts} rowKey={artifactKey} columns={artifactColumns} />
        )}
        {view === 'maps' && (
          <>
            <p className="muted">
              The rows count Side A only: both sides of a battle share the map, so counting both would always give half. Open a map to see its best win-rate formations, counted from both sides.
            </p>
            <StatsTable
              label="Maps"
              rows={maps}
              rowKey={mapKey}
              columns={mapColumns}
              detail={mapDetail}
            />
          </>
        )}
        {view === 'heroes' && (
          <StatsTable rows={heroes} rowKey={heroKey} detail={heroDetail} columns={heroColumns} />
        )}
        {view === 'pairs' && (
          <HeroSetCut
            shown={(size === 3 ? trios : pairs).rows.length}
            total={(size === 3 ? trios : pairs).total}
            noun={size === 3 ? 'trios' : 'pairs'}
            sort={heroSetSort}
            limit={heroSetLimit}
            onMore={() => setAsked({ key: heroSetsKey, limit: Math.min(heroSetLimit + HERO_SETS_SHOWN, MAX_HERO_SET_ROWS) })}
          />
        )}
        {view === 'pairs' && size === 3 && <StatsTable rows={trios.rows} rowKey={trioKey} columns={trioColumns} />}
        {view === 'pairs' && size === 2 && <StatsTable rows={pairs.rows} rowKey={pairKey} columns={pairColumns} />}
      </TabPanel>
    </section>
  );
}
