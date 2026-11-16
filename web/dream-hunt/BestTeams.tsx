import { Fragment, useEffect, useState } from 'react';
import { formatDuration, MIN_CLEARS_FOR_CONFIDENCE } from '../../src/domain/dream-hunt.js';
import type { LayoutSummary } from '../../src/domain/dream-hunt.js';
import type { Layout } from '../../src/domain/layout.js';
import { api, type Boss, type BossRule, type Composition, type GameMap } from '../backend.js';
import { useLoad } from '../useLoad.js';
import { useMaps } from '../useMaps.js';
import { UnitsOnMap, type MapUnit } from '../admin/UnitsOnMap.js';
import { TeamOverview } from '../stats/TeamOverview.js';
import { TagFilter } from '../Tags.js';
import { weekStart } from '../weeks.js';
import { toggled } from '../format.js';

const MINI_TILE_WIDTH = 26;

/** One Layout of a team on its map, read only and small. */
export function LayoutMap({ mapName, layout, map }: { mapName: string; layout: Layout; map: GameMap | undefined }) {
  if (!map) return <p className="muted">The map “{mapName}” no longer exists.</p>;
  const { units } = layout;
  const unitAt = (tile: number): MapUnit | undefined => {
    const unit = units.find((u) => u.tile === tile);
    if (!unit) return undefined;
    return { kind: unit.kind, name: unit.part || unit.hero };
  };
  return (
    <UnitsOnMap rowLengths={map.rowLengths} cells={map.cells} tileWidth={MINI_TILE_WIDTH} label={`Layout on ${mapName}`} unitAt={unitAt} portraitSize={MINI_TILE_WIDTH - 8} />
  );
}

/** The Layouts a team was fought with, fastest first. */
function LayoutList({ boss, composition, maps, send }: { boss: string; composition: Composition; maps: GameMap[]; send?: SendToSimulator }) {
  const { layouts } = composition;
  if (layouts.length === 0) return <p className="muted">No placement recorded.</p>;
  return (
    <ul className="layouts">
      {layouts.map((l, index) => (
        <li key={l.key} className="layout-card">
          <LayoutMap mapName={l.mapName} layout={l.layout} map={maps.find((m) => m.name === l.mapName)} />
          <div className="layout-facts">
            <strong>{l.mapName}</strong>
            {index === 0 && l.clears > 0 && <span className="badge"> fastest</span>}
            <div>
              {l.attempts} {l.attempts === 1 ? 'fight' : 'fights'}, {l.clears} {l.clears === 1 ? 'clear' : 'clears'}
              {l.clears > 0 && l.lowConfidence && <span className="badge few"> few clears</span>}
            </div>
            {l.clears > 0 ? (
              <div className="muted">
                best {formatDuration(l.bestSeconds!)}, median {formatDuration(l.medianSeconds!)}, worst {formatDuration(l.worstSeconds!)}
              </div>
            ) : (
              <div className="muted">never cleared</div>
            )}
            {send && <SendButton boss={boss} composition={composition} layout={l} send={send} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Where a composition's clear times fall: best to worst as a bar, with a tick for the median. */
function TimeSpread({ best, median, worst, scaleMax }: { best: number; median: number; worst: number; scaleMax: number }) {
  const pct = (seconds: number) => `${(seconds / scaleMax) * 100}%`;
  return (
    <span className="spread" role="img" aria-label={`best ${formatDuration(best)}, median ${formatDuration(median)}, worst ${formatDuration(worst)}`}>
      <span className="spread-range" style={{ left: pct(best), width: `max(4px, calc(${pct(worst)} - ${pct(best)}))` }} />
      <span className="spread-median" style={{ left: pct(median) }} />
    </span>
  );
}

/** What sending a team to the Simulator needs: the callback, and whether a team (on a Layout) is already on the shelf. */
export interface SendToSimulator {
  send: (boss: string, composition: Composition, layout?: LayoutSummary) => void;
  isSent: (composition: Composition, layout?: LayoutSummary) => boolean;
}

function SendButton({ boss, composition, layout, send }: { boss: string; composition: Composition; layout?: LayoutSummary; send: SendToSimulator }) {
  const sent = send.isSent(composition, layout);
  return (
    <button type="button" disabled={sent} title={sent ? 'On the Simulator shelf' : layout ? 'Send this placement to the Simulator' : 'Send the fastest placement to the Simulator'} onClick={(e) => (e.stopPropagation(), send.send(boss, composition, layout))}>
      {sent ? 'Sent' : 'Send to Simulator'}
    </button>
  );
}

/** Teams as a table, best first, each openable to its placements. Used by Best teams and the Finder. */
export function CompositionTable({ boss, compositions, maps, send }: { boss: string; compositions: Composition[]; maps: GameMap[]; send?: SendToSimulator }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((current) => toggled(current, key));
  const scaleMax = Math.max(1, ...compositions.map((c) => c.worstSeconds ?? 0));
  return (
    <table className="board">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Fights</th>
          <th>Clear rate</th>
          <th>Times</th>
          <th>Median</th>
          <th>Best–worst</th>
          {send && <th></th>}
        </tr>
      </thead>
      <tbody>
        {compositions.map((c, index) => (
          <Fragment key={c.key}>
          <tr className={c.lowConfidence ? 'low' : undefined}>
            <td>{index + 1}</td>
            <td>
              <div
                className="team-cell"
                role="button"
                tabIndex={0}
                aria-expanded={open.has(c.key)}
                aria-label={`${open.has(c.key) ? 'Hide' : 'Show'} placements of team ${index + 1}`}
                onClick={() => toggle(c.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  toggle(c.key);
                }}
              >
                <TeamOverview heroes={c.latest.heroes} artifact={c.latest.artifact} size={32} />
                <span className="muted" aria-hidden="true">
                  {open.has(c.key) ? '▾' : '▸'}
                </span>
              </div>
            </td>
            <td>{c.attempts}</td>
            <td>
              {Math.round(c.clearRate * 100)}% <span className="muted">({c.clears}/{c.attempts})</span>
            </td>
            <td>
              {c.clears > 0 ? (
                <TimeSpread best={c.bestSeconds!} median={c.medianSeconds!} worst={c.worstSeconds!} scaleMax={scaleMax} />
              ) : (
                <span className="muted">never cleared</span>
              )}
            </td>
            <td>
              {c.medianSeconds !== null ? formatDuration(c.medianSeconds) : '–'}
              {c.clears > 0 && c.lowConfidence && <span className="badge few"> few clears</span>}
            </td>
            <td>{c.clears > 0 ? `${formatDuration(c.bestSeconds!)}–${formatDuration(c.worstSeconds!)}` : '–'}</td>
            {send && (
              <td>
                <SendButton boss={boss} composition={c} send={send} />
              </td>
            )}
          </tr>
          {open.has(c.key) && (
            <tr>
              <td colSpan={send ? 8 : 7}>
                <LayoutList boss={boss} composition={c} maps={maps} send={send} />
              </td>
            </tr>
          )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function BestTeams({ bosses, rules, send }: { bosses: Boss[]; rules: BossRule[]; send?: SendToSimulator }) {
  const [boss, setBoss] = useState('');
  const [rule, setRule] = useState('any');
  const [tag, setTag] = useState<string[]>([]);
  const [thisWeek, setThisWeek] = useState(false);
  const maps = useMaps();

  useEffect(() => {
    if (!boss && bosses.length) setBoss((bosses.find((b) => b.attempts > 0) ?? bosses[0]!).name);
  }, [bosses, boss]);

  // Only the latest request counts: a slow answer for an earlier boss or filter must not replace the one the player asked for last.
  const { data: board = null, error } = useLoad(
    () => api.leaderboard(boss, rule, tag, thisWeek ? weekStart(new Date().toISOString()) : ''),
    [boss, rule, tag, thisWeek],
    boss !== '',
  );

  return (
    <div>
      <div className="filters">
        <label className="field">
          Boss
          <select value={boss} onChange={(e) => setBoss(e.target.value)}>
            {bosses.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} ({b.attempts})
              </option>
            ))}
          </select>
        </label>
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
        <label className="check">
          <input type="checkbox" checked={thisWeek} onChange={(e) => setThisWeek(e.target.checked)} /> This week only
        </label>
      </div>
      <p className="muted">
        Clear times vary from fight to fight, so each team is judged on all its fights: the bar runs from its best to its worst time, the tick marks
        the median. Teams with at least {MIN_CLEARS_FOR_CONFIDENCE} clears are ranked first, fastest median first; teams with fewer are shown after,
        flagged, because one lucky run can mislead. The same heroes and artifact count as one team wherever they stand; open a team to see where its heroes stood, fastest placement first.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {board && board.compositions.length === 0 && <p className="muted">No fights recorded for this boss yet.</p>}
      {board && board.compositions.length > 0 && <CompositionTable boss={board.boss} compositions={board.compositions} maps={maps} send={send} />}
    </div>
  );
}
