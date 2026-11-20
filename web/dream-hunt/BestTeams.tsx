import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { formatDuration, isRuleOnly, MIN_CLEARS_FOR_CONFIDENCE } from '../../src/domain/dream-hunt.js';
import type { LayoutSummary, RuleTimes } from '../../src/domain/dream-hunt.js';
import type { Layout } from '../../src/domain/layout.js';
import { api, type Boss, type BossRule, type Composition, type GameMap } from '../backend.js';
import { useLoad } from '../hooks/load.js';
import { useMaps } from '../hooks/maps.js';
import { UnitsOnMap, type MapUnit } from '../admin/UnitsOnMap.js';
import { TeamOverview } from '../stats/TeamOverview.js';
import { TagFilter } from '../Tags.js';
import { weekStart } from '../weeks.js';
import { toggled } from '../format.js';
import { HeroFilter } from './HeroFilter.js';
import { DisclosureMark } from '../ui/Icon.js';
import { Notice } from '../ui/Notice.js';

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

/** What the fights under a Rule came to, written apart from the fights without one. */
function RuleFacts({ rule, alone }: { rule: RuleTimes; alone: boolean }) {
  return (
    <div className="muted rule-line" title={`Under ${rule.rules.join(', ')}`}>
      {alone ? 'Only under a Rule: ' : 'Under a Rule: '}
      {rule.attempts} {rule.attempts === 1 ? 'fight' : 'fights'}, {rule.clears} {rule.clears === 1 ? 'clear' : 'clears'}
      {rule.clears > 0 && <>, best {formatDuration(rule.bestSeconds!)}, median {formatDuration(rule.medianSeconds!)}, worst {formatDuration(rule.worstSeconds!)}</>}
    </div>
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
            {(l.attempts > 0 || !l.rule) && (
              <>
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
              </>
            )}
            {l.rule && <RuleFacts rule={l.rule} alone={l.attempts === 0} />}
            {send && <SendButton boss={boss} composition={composition} layout={l} send={send} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where a composition's clear times fall: best to worst as a bar, with a tick for the median (or the average, `centre`), and a hollow dot for
 * each clear under a Rule. The track runs from `scaleMin` (0 by default) to `scaleMax`; `wide` stretches it over its cell instead of 140px.
 */
export function TimeSpread({ best, median, worst, ruleTimes = [], scaleMin = 0, scaleMax, centre = 'median', wide = false, format = formatDuration }: { best: number | null; median: number | null; worst: number | null; ruleTimes?: number[]; scaleMin?: number; scaleMax: number; centre?: 'median' | 'average'; wide?: boolean; format?: (seconds: number) => string }) {
  const pct = (seconds: number) => `${((seconds - scaleMin) / (scaleMax - scaleMin)) * 100}%`;
  const parts = [best !== null && `best ${format(best)}, ${centre} ${format(median!)}, worst ${format(worst!)}`, ruleTimes.length > 0 && `under a Rule ${ruleTimes.map(format).join(', ')}`];
  return (
    <span className={wide ? 'spread spread-wide' : 'spread'} role="img" aria-label={parts.filter(Boolean).join('; ')}>
      {best !== null && <span className="spread-range" style={{ left: pct(best), width: `max(4px, calc(${pct(worst!)} - ${pct(best)}))` }} />}
      {best !== null && <span className="spread-median" style={{ left: pct(median!) }} />}
      {ruleTimes.map((seconds, i) => (
        <span key={i} className="spread-dot" style={{ left: pct(seconds) }} />
      ))}
    </span>
  );
}

/** A cell with the figure of the fights without a Rule on one line and, under it, the figure of the fights under one. A team never fought under a Rule has the single line. */
function Stacked({ normal, rule, title }: { normal: ReactNode; rule: ReactNode | null; title?: string }) {
  if (rule === null) return <>{normal}</>;
  return (
    <>
      <div>{normal}</div>
      <div className="muted rule-line" title={title}>
        {rule}
      </div>
    </>
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

/** The Fights, Clear rate, Times, Median and Best–worst cells of a team: the fights without a Rule, and the ones under a Rule beneath them. */
function FigureCells({ composition: c, scaleMax }: { composition: Composition; scaleMax: number }) {
  const rule = c.rule ?? null;
  const title = rule ? `Under ${rule.rules.join(', ')}` : undefined;
  const none = <span className="muted">–</span>;
  const rate = (clears: number, attempts: number) => (
    <>
      {Math.round((clears / attempts) * 100)}% <span className="muted">({clears}/{attempts})</span>
    </>
  );
  const ruleOnly = isRuleOnly(c);
  return (
    <>
      <td>
        <Stacked normal={c.attempts > 0 ? c.attempts : none} rule={rule && `${rule.attempts} under a Rule`} title={title} />
      </td>
      <td>
        <Stacked normal={c.attempts > 0 ? rate(c.clears, c.attempts) : none} rule={rule && (rule.attempts > 0 ? rate(rule.clears, rule.attempts) : none)} title={title} />
      </td>
      <td>
        {c.clears > 0 || rule?.clears ? (
          <TimeSpread best={c.bestSeconds} median={c.medianSeconds} worst={c.worstSeconds} ruleTimes={rule?.times ?? []} scaleMax={scaleMax} />
        ) : (
          <span className="muted">never cleared</span>
        )}
      </td>
      <td>
        <Stacked
          normal={
            <>
              {c.medianSeconds !== null ? formatDuration(c.medianSeconds) : '–'}
              {c.clears > 0 && c.lowConfidence && <span className="badge few"> few clears</span>}
              {ruleOnly && <span className="badge few"> Rule only</span>}
            </>
          }
          rule={rule && (rule.medianSeconds !== null ? formatDuration(rule.medianSeconds) : '–')}
          title={title}
        />
      </td>
      <td>
        <Stacked
          normal={c.clears > 0 ? `${formatDuration(c.bestSeconds!)}–${formatDuration(c.worstSeconds!)}` : '–'}
          rule={rule && (rule.clears > 0 ? `${formatDuration(rule.bestSeconds!)}–${formatDuration(rule.worstSeconds!)}` : '–')}
          title={title}
        />
      </td>
    </>
  );
}

/** Teams as a table, best first, each openable to its placements. Used by Best teams and the Finder. */
export function CompositionTable({ boss, compositions, maps, send }: { boss: string; compositions: Composition[]; maps: GameMap[]; send?: SendToSimulator }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((current) => toggled(current, key));
  const scaleMax = Math.max(1, ...compositions.flatMap((c) => [c.worstSeconds ?? 0, c.rule?.worstSeconds ?? 0]));
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
                  <DisclosureMark open={open.has(c.key)} />
                </span>
              </div>
            </td>
            <FigureCells composition={c} scaleMax={scaleMax} />
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
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const { maps, error: mapsError } = useMaps();

  useEffect(() => {
    if (!boss && bosses.length) setBoss((bosses.find((b) => b.attempts > 0) ?? bosses[0]!).name);
  }, [bosses, boss]);

  // Only the latest request counts: a slow answer for an earlier boss or filter must not replace the one the player asked for last.
  const { data: board = null, error } = useLoad(
    () => api.leaderboard(boss, rule, tag, thisWeek ? weekStart(new Date().toISOString()) : '', include, exclude),
    [boss, rule, tag, thisWeek, include.join('|'), exclude.join('|')],
    boss !== '',
  );
  // The heroes offered are those with a recorded fight against this boss, so the list follows the boss.
  const { data: offered = [] } = useLoad(() => api.fightHeroes(boss), [boss], boss !== '');

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
        <HeroFilter offered={offered} include={include} exclude={exclude} onChange={(next) => (setInclude(next.include), setExclude(next.exclude))} />
      </div>
      <p className="muted">
        Clear times vary from fight to fight, so each team is judged on all its fights: the bar runs from its best to its worst time, the tick marks
        the median. Teams with at least {MIN_CLEARS_FOR_CONFIDENCE} clears are ranked first, fastest median first; teams with fewer are shown after,
        flagged, because one lucky run can mislead. Fights under a Rule have a boost you may not have, so with Rule = Any the figures and the bar
        are those of the fights without a Rule, the fights under one are written beneath in grey and shown as hollow dots, and a team cleared only
        under a Rule is ranked last of the cleared ones and flagged. The same heroes and artifact count as one team wherever they stand; open a team to see where its heroes stood, fastest placement first.
      </p>
      {mapsError && (
        <Notice kind="error">
          {mapsError}
        </Notice>
      )}
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      {board && board.compositions.length === 0 && (
        <p className="muted">{include.length + exclude.length > 0 ? 'No recorded team matches these heroes.' : 'No fights recorded for this boss yet.'}</p>
      )}
      {board && board.compositions.length > 0 && <CompositionTable boss={board.boss} compositions={board.compositions} maps={maps} send={send} />}
    </div>
  );
}
