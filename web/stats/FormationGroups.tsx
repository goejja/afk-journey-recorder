import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { isSmallSample } from '../../src/domain/stats.js';
import { useLoad } from '../hooks/load.js';
import { api, type ArchetypeStat, type GameMap, type PlacementMap, type FormationGroupRow, type FormationReport, type GroupCounterReport, type GroupCounterRow, type GroupHero, type Matchup, type RateRecord } from '../backend.js';
import { useMaps } from '../hooks/maps.js';
import { HexMap } from '../HexMap.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { Dialog } from '../ui/Dialog.js';
import { percent, points, record, toggled } from '../format.js';
import { DisclosureMark } from '../ui/Icon.js';
import { Notice } from '../ui/Notice.js';
import { Loading } from '../ui/ListStatus.js';

interface Filters {
  mode: string[];
  tag: string[];
  player: string[];
  playedIn: string[];
  excludeDefault: boolean;
  min: string;
}

const plain = (heroes: string[]) => heroes.join(' + ');
const coreNames = (core: GroupHero[]) => core.map((h) => h.hero);

/** Portraits of a group's heroes, each with its share of the group's appearances under it. */
export function GroupHeroes({ heroes, size }: { heroes: GroupHero[]; size: number }) {
  return (
    <span className="group-heroes">
      {heroes.map((h) => (
        <span key={h.hero} className="group-hero" title={`${h.hero} ${percent(h.share)}`}>
          <Portrait kind="hero" name={h.hero} size={size} />
          <small>{percent(h.share)}</small>
        </span>
      ))}
    </span>
  );
}

function Rate({ r }: { r: RateRecord }) {
  return (
    <>
      {record(r)} ({percent(r.winRate)}){isSmallSample(r.games) && <span className="badge few"> few games</span>}
    </>
  );
}

/** Where the group stands on one map: the example layout (each hero on its most used free tile) and the list behind it. */
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
          label={`Example Layout on ${current.map}`}
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

const MATRIX_SIZE = 12;
const PAIRS_SHOWN = 8;

/** A group's name in the counters report: its core heroes. */
const nameOf = (g: GroupCounterRow) => plain(g.core);

/** Which groups a group beats and loses to, from the head-to-head records under the same filters. */
function Counters({ core, report }: { core: string[]; report: GroupCounterReport | null }) {
  if (!report) return <Loading />;
  const key = core.join('/');
  const group = report.groups.find((g) => g.core.join('/') === key);
  const { winRate, minGames } = report.rule;
  const list = (title: string, matchups: Matchup[], mine: boolean) => (
    <>
      <h4>{title}</h4>
      {matchups.length === 0 ? (
        <p className="muted">No group met in at least {minGames} games with a win rate of {percent(winRate)} or more.</p>
      ) : (
        <ul className="stats-detail">
          {matchups.map((m) => (
            <li key={m.vs}>
              {`${nameOf(report.groups[m.vs]!)} — ${mine ? `${m.wins}–${m.losses}` : `${m.losses}–${m.wins}`} of ${m.games} (${percent(mine ? m.winRate : m.losses / m.games)})`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  if (!group) return <p className="muted">This group has no head-to-head record under these filters.</p>;
  const anecdotes = group.matchups.filter((m) => m.anecdote);
  return (
    <>
      {list('Beats', group.beats, true)}
      {list('Loses to', group.losesTo, false)}
      {anecdotes.length > 0 && (
        <>
          <h4>Met in too few games</h4>
          <ul className="stats-detail">
            {anecdotes.map((m) => (
              <li key={m.vs}>
                {`${nameOf(report.groups[m.vs]!)} — ${m.wins}–${m.losses} of ${m.games}`}
                <span className="badge few">anecdote</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** The most played groups against each other: each cell is the row group's win rate against the column group. */
function CounterMatrix({ report }: { report: GroupCounterReport }) {
  const shown = report.groups.slice(0, MATRIX_SIZE);
  if (shown.length < 2) return null;
  const cell = (row: number, column: number) => {
    if (row === column) return <td key={column} className="mirror" />;
    const m = shown[row]!.matchups.find((x) => x.vs === column);
    if (!m) return <td key={column} className="none" />;
    const heat = Math.round(Math.abs(m.winRate - 0.5) * 120);
    return (
      <td
        key={column}
        className={`${m.winRate >= 0.5 ? 'win' : 'loss'}${m.anecdote ? ' faded' : ''}`}
        style={{ '--heat': heat } as CSSProperties}
        title={`${nameOf(shown[row]!)} against ${nameOf(shown[column]!)}: ${m.wins}–${m.losses} of ${m.games}${m.anecdote ? ` (under ${report.rule.minGames} games: anecdote)` : ''}`}
      >
        {percent(m.winRate)}
        <span className="games">{m.games}</span>
      </td>
    );
  };
  return (
    <>
      <h3>Groups against each other</h3>
      <p className="muted">
        The {shown.length} most played groups. Each cell is the win rate of the row group against the column group, with the games under it; green is above 50%, red below, and a faded cell has fewer than {report.rule.minGames} games.
      </p>
      <table className="data-table counter-matrix" aria-label="Win rate of each group against each other">
        <thead>
          <tr>
            <th scope="col">Group</th>
            {shown.map((g, i) => <th key={nameOf(g)} scope="col" title={nameOf(g)}>{i + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((g, row) => (
            <tr key={nameOf(g)}>
              <th scope="row" aria-label={`${row + 1}. ${nameOf(g)}`} title={nameOf(g)}>
                <span className="group-rank">{row + 1}</span>
                <span className="group-heroes">{g.core.map((h) => <Portrait key={h} kind="hero" name={h} size={20} />)}</span>
              </th>
              {shown.map((_, column) => cell(row, column))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Profile({ core, filters, maps, counters }: { core: string[]; filters: Filters; maps: GameMap[]; counters: GroupCounterReport | null }) {
  // `core` is a new array on every render; its names are the dependency.
  const { data: profile, error } = useLoad(
    () => api.statsFormationProfile({ core, mode: filters.mode, tag: filters.tag, player: filters.player, playedIn: filters.playedIn, excludeDefault: filters.excludeDefault ? 'true' : '' }),
    [core.join('/'), filters],
  );

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!profile) return <Loading />;
  const gaps = [['ahead', 'Ahead'], ['near', 'Near level'], ['behind', 'Behind'], ['unknown', 'Unknown gap']] as const;
  return (
    <>
      <h4>Artifacts</h4>
      {profile.artifacts.length === 0 ? (
        <p className="muted">No artifact recorded.</p>
      ) : (
        <table className="data-table" aria-label="Artifacts of the group">
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
        <p className="muted">No Formation was recorded 3 times.</p>
      ) : (
        <ul className="stats-detail">
          {profile.variations.map((v) => (
            <li key={v.flex.join('/')}>
              {v.flex.length === 0 ? 'The core alone' : `+${v.flex.length} flex: ${plain(v.flex)}`} — <Rate r={v} />
            </li>
          ))}
        </ul>
      )}
      {profile.otherFormations.length > 0 && (
        <>
          <h4>Other recorded Formations</h4>
          <ul className="stats-detail">
            {profile.otherFormations.map((l) => (
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
      <Counters core={core} report={counters} />
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

/** A win-rate bar whose length is the games of the group, against the most played group, and whose fill is its win rate. */
function GamesBar({ group, most }: { group: { games: number; winRate: number }; most: number }) {
  return (
    <span className="group-bar" style={{ width: `${Math.max(6, (group.games / most) * 100)}%` }} role="img" aria-label={`${percent(group.winRate)} of ${group.games} games`}>
      <span className="group-bar-win" style={{ width: percent(group.winRate) }} />
    </span>
  );
}

/** The pairs of the group's own heroes, from the pairs statistics under the same mode and season filters. */
function GroupPairs({ heroes, filters }: { heroes: Set<string>; filters: Filters }) {
  // The most played pairs: the list is cut to its best rows, and the pairs of a group are the ones played most.
  const pairs = useLoad(() => api.statsPairs({ mode: filters.mode, playedIn: filters.playedIn, sort: 'games' }), [filters.mode, filters.playedIn]);
  if (pairs.error) return <Notice kind="error">{pairs.error}</Notice>;
  if (!pairs.data) return <Loading />;
  const own = pairs.data.rows.filter((p) => heroes.has(p.heroA) && heroes.has(p.heroB)).sort((a, b) => b.games - a.games).slice(0, PAIRS_SHOWN);
  return (
    <>
      <h4>Pairs in this group</h4>
      {own.length === 0 ? (
        <p className="muted">No pair of these heroes in the pairs statistics.</p>
      ) : (
        <ul className="stats-detail">
          {own.map((p) => (
            <li key={`${p.heroA}/${p.heroB}`}>{`${p.heroA} + ${p.heroB} — ${record(p)} of ${p.games} (${percent(p.winRate)})`}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The card of a group: who it is, then its pairs, counters, placement and the rest of its profile. */
function GroupCard({ group, baseline, filters, maps, counters }: { group: FormationGroupRow; baseline: number; filters: Filters; maps: GameMap[]; counters: GroupCounterReport | null }) {
  const core = coreNames(group.core);
  const heroes = new Set([...core, ...group.flex.map((h) => h.hero)]);
  return (
    <div role="region" aria-label={`Profile of ${plain(core)}`}>
      <div className="group-card-head">
        <GroupHeroes heroes={group.core} size={40} />
        <span className="group-sep" />
        <GroupHeroes heroes={group.flex} size={28} />
      </div>
      <p>
        {record(group)} of {group.games} games, {percent(group.winRate)}{' '}
        <span className="muted" title={`The win rate of all sides is ${percent(baseline)}`}>{points(group.vsAverage)}</span>
        {' · '}{group.players} players{group.artifact ? ` · ${group.artifact.artifact} ${percent(group.artifact.share)}` : ''}
        {group.labels.map((l) => (
          <span key={l.name} className="badge few">{l.detail ? `${l.name}: ${l.detail}` : l.name}</span>
        ))}
        {isSmallSample(group.games) && <span className="badge few">few games</span>}
      </p>
      <GroupPairs heroes={heroes} filters={filters} />
      <Profile core={core} filters={filters} maps={maps} counters={counters} />
    </div>
  );
}

/** The figures of a row, in the columns every row of the list shares: bar, win rate, record, games, players, evidence. */
function Figures({ stat, most, evidence }: { stat: { games: number; wins: number; winRate: number; players: number }; most: number; evidence: boolean }) {
  return (
    <>
      <GamesBar group={stat} most={most} />
      <strong className="num">{percent(stat.winRate)}</strong>
      <span className="num">{record(stat)}</span>
      <span className="num">{stat.games}</span>
      <span className="num">{stat.players}</span>
      <span>{evidence && isSmallSample(stat.games) && <span className="badge few">few games</span>}</span>
    </>
  );
}

function GroupRowButton({ group, most, onOpen }: { group: FormationGroupRow; most: number; onOpen: () => void }) {
  return (
    <button className={`group-row${isSmallSample(group.games) ? ' low' : ''}`} onClick={onOpen} aria-label={plain(coreNames(group.core))} aria-haspopup="dialog">
      <span />
      <GroupHeroes heroes={group.core} size={32} />
      <GroupHeroes heroes={group.flex} size={22} />
      <Figures stat={group} most={most} evidence />
    </button>
  );
}

function ArchetypeSection({ row, most, opened, toggle, children }: { row: ArchetypeStat; most: number; opened: boolean; toggle: () => void; children: ReactNode }) {
  return (
    <section className="group-archetype">
      <button className="group-row group-archetype-head" aria-expanded={opened} aria-label={`Archetype: ${plain(coreNames(row.core))}`} title={`${row.groups.length} groups`} onClick={toggle}>
        <DisclosureMark open={opened} />
        <GroupHeroes heroes={row.core} size={32} />
        <GroupHeroes heroes={row.flex} size={22} />
        <Figures stat={row} most={most} evidence={false} />
      </button>
      {opened && children}
    </section>
  );
}

/** The column titles of the list; the rows below read the same columns. */
function GroupListHead() {
  return (
    <div className="group-row group-list-head" aria-hidden="true">
      <span />
      <span>Core</span>
      <span>Flex</span>
      <span>Games (bar) and win rate</span>
      <span className="num">Win</span>
      <span className="num">W–L</span>
      <span className="num">Games</span>
      <span className="num">Players</span>
      <span />
    </div>
  );
}

/** The Formation groups of the recorded sides under their Archetype rows, counted from the owner's own records. */
export function FormationGroups({ filters }: { filters: Filters }) {
  const { maps, error: mapsError } = useMaps();
  const [picked, setPicked] = useState<string[]>([]);
  // the archetypes the owner folded or unfolded against the default; the group whose card is open
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<FormationGroupRow | null>(null);
  // an answer that arrives after the filters changed again is dropped (useLoad)
  const heroList = useLoad(() => api.statsHeroes({ mode: filters.mode, playedIn: filters.playedIn }), [filters.mode, filters.playedIn]);
  const heroes = useMemo(() => (heroList.data ?? []).map((x) => x.hero).sort(), [heroList.data]);
  const loaded = useLoad(
    () => api.statsFormationReport({ mode: filters.mode, tag: filters.tag, player: filters.player, playedIn: filters.playedIn, excludeDefault: filters.excludeDefault ? 'true' : '', min: filters.min, hero: picked }),
    [filters, picked],
  );
  // The counters read both sides of every battle, so the Hero and minimum-games filters of the table do not apply to them.
  const counters = useLoad(
    () => api.statsGroupCounters({ mode: filters.mode, tag: filters.tag, player: filters.player, playedIn: filters.playedIn, excludeDefault: filters.excludeDefault ? 'true' : '' }),
    [filters.mode, filters.tag, filters.player, filters.playedIn, filters.excludeDefault],
  );
  const report: FormationReport | null = loaded.data ?? null;
  const error = loaded.error;

  const most = report ? Math.max(1, ...report.rows.map((r) => r.games)) : 1;
  // every row has room for the longest Core and Flex lists, so the columns line up from row to row
  const slots = {
    '--core-n': Math.max(1, ...(report?.rows ?? []).flatMap((r) => [r.core.length, ...r.groups.map((g) => g.core.length)])),
    '--flex-n': Math.max(1, ...(report?.rows ?? []).flatMap((r) => [r.flex.length, ...r.groups.map((g) => g.flex.length)])),
  } as CSSProperties;

  return (
    <>
      <p className="muted">
        A group is a set of Formations that differ by one hero. A core hero is in at least 80% of the group's games and a flex hero in 15% to below 80%, each with its share. Groups that share two or more core heroes sit under one archetype. The win rate is set against all sides under these filters ({report ? percent(report.baseline) : '…'}).
      </p>
      <div className="filters">
        <MultiSelect label="Hero" options={heroes} value={picked} onChange={setPicked} />
      </div>
      {mapsError && <Notice kind="error">{mapsError}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {report && report.rows.length === 0 && <p className="muted">Nothing to show with these filters.</p>}
      {report && report.rows.length > 0 && (
        <div className="group-table" style={slots}>
          <GroupListHead />
          <div className="group-list" role="list" aria-label="Formation groups">
          {report.rows.map((row) => {
            const key = coreNames(row.groups[0]!.core).join('/');
            const buttons = row.groups.map((group) => (
              <GroupRowButton key={coreNames(group.core).join('/')} group={group} most={most} onOpen={() => setChosen(group)} />
            ));
            if (row.groups.length === 1) return <div key={key} role="listitem">{buttons}</div>;
            const opened = flipped.has(key);
            return (
              <div key={key} role="listitem">
                <ArchetypeSection row={row} most={most} opened={opened} toggle={() => setFlipped((old) => toggled(old, key))}>
                  {buttons}
                </ArchetypeSection>
              </div>
            );
          })}
          </div>
        </div>
      )}
      {chosen && report && (
        <Dialog title={plain(coreNames(chosen.core))} side closeOnBackdrop onCancel={() => setChosen(null)} actions={<button onClick={() => setChosen(null)}>Close</button>}>
          <GroupCard group={chosen} baseline={report.baseline} filters={filters} maps={maps} counters={counters.data ?? null} />
        </Dialog>
      )}
      {counters.error && <Notice kind="error">{counters.error}</Notice>}
      {counters.data && report && report.rows.length > 0 && <CounterMatrix report={counters.data} />}
    </>
  );
}
