import { Fragment, useMemo, useState } from 'react';
import { Damage } from '../../ui/Damage.js';
import { TITAN_MAP, TITAN_PHASES, BOSSES_PER_TITAN_PHASE, MAX_LEVEL, SEASON_PHASES, belowMaxLevel, formatDamageShort, groupBattles, type BattleGroup, type TitanPhase } from '../../../src/domain/titan-reaver.js';
import { layoutFrom } from '../../../src/domain/layout.js';
import { api, type TitanReaverBattle, type TitanReaverFight } from '../../backend.js';
import { LayoutMap } from '../../dream-hunt/BestTeams.js';
import { useLoad } from '../../hooks/load.js';
import { useMaps } from '../../hooks/maps.js';
import { Portrait } from '../../Portrait.js';
import { TeamCell } from '../../TeamCell.js';
import { toggled } from '../../format.js';
import { DisclosureMark } from '../../ui/Icon.js';
import { Notice } from '../../ui/Notice.js';
import { ALL_BATTLES, type Reference } from './draft.js';

/** How many groups a Titan Reaver Phase lists before `Show N more`. */
const GROUPS = 7;

const layoutOf = (fight: TitanReaverFight) => layoutFrom({ heroes: fight.formation.heroes.map((h) => ({ tile: h.tile, hero: h.name, part: h.part })), phantimal: fight.formation.phantimal });

/** The level of a group: its best Battle's, and the range when the group holds other levels. */
const levelText = (group: BattleGroup<TitanReaverBattle>) =>
  group.lowestLevel === group.highestLevel ? `level ${group.best.level}` : `level ${group.best.level} (${group.lowestLevel}–${group.highestLevel})`;

/** One Titan Reaver Phase of the event: its score so far and its groups of Battles. */
function PhaseSection({
  phase,
  seasonPhase,
  battles,
  declared,
  onShowRecords,
}: {
  phase: TitanPhase;
  seasonPhase: number;
  battles: TitanReaverBattle[];
  declared: (string | null)[];
  onShowRecords: () => void;
}) {
  const { maps, error: mapsError } = useMaps();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const groups = useMemo(() => groupBattles(battles), [battles]);
  const listed = all ? groups : groups.slice(0, GROUPS);
  const best = groups[0]?.best;
  // the bosses the setup declares for this event, else the ones the best Battle fought
  const bosses = Array.from({ length: BOSSES_PER_TITAN_PHASE }, (_, i) => declared[i] ?? best?.fights[i]?.boss ?? null);
  const map = maps.find((m) => m.name === TITAN_MAP);

  return (
    <section aria-label={phase}>
      <h3>{phase}</h3>
      {mapsError && <Notice kind="error">{mapsError}</Notice>}
      <p>
        {best ? (
          <>
            Score so far <strong><Damage value={best.total} /></strong> · team level {best.level}
            {belowMaxLevel(seasonPhase, best.level) && <span className="muted"> (below the maximum, {MAX_LEVEL[seasonPhase]}: a run at the maximum might do better)</span>} · {battles.length} {battles.length === 1 ? 'Battle' : 'Battles'}
          </>
        ) : (
          <span className="muted">No Battle recorded for {phase} yet.</span>
        )}{' '}
        <button className="small" onClick={onShowRecords}>
          Show records
        </button>
      </p>
      {bosses.every((b) => b === null) && (
        <p className="muted">
          No bosses set for {phase}: set them in <a href="#admin">Admin &gt; Weekly default</a>.
        </p>
      )}
      {groups.length > 0 && (
        <table className="week-table" aria-label={`${phase} best groups`}>
          <thead>
            <tr>
              <th className="muted">Best total</th>
              {bosses.map((boss, i) => (
                <th key={i}>
                  {boss ? (
                    <span className="week-boss">
                      <Portrait kind="boss" name={boss} size={32} />
                      <strong>{boss}</strong>
                    </span>
                  ) : (
                    <span className="muted">Fight {i + 1}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listed.map((group, rank) => {
              const key = group.best.id;
              const shown = open.has(key);
              const label = `${phase} group ${rank + 1}`;
              return (
                <Fragment key={key}>
                  <tr className="week-day" aria-label={label} onClick={() => setOpen((current) => toggled(current, key))}>
                    <td>
                      <button className="week-toggle" aria-expanded={shown} aria-label={`${shown ? 'Hide' : 'Show'} the Battles of ${label.toLowerCase()}`}>
                        <span>
                          <DisclosureMark open={shown} /> <strong className="week-time"><Damage value={group.best.total} /></strong>
                        </span>
                        <span className="muted week-group-facts">
                          avg <Damage value={Math.round(group.average)} /> · ×{group.battles.length}
                        </span>
                        <span className="muted week-group-facts">{levelText(group)}</span>
                      </button>
                    </td>
                    {group.best.fights.map((fight) => (
                      <td key={fight.position}>
                        <TeamCell artifact={fight.formation.artifact} heroes={fight.formation.heroes.map((h) => h.name)}>
                          <span className="week-times muted">
                            <span className="week-time"><Damage value={fight.damage} /></span>
                          </span>
                        </TeamCell>
                      </td>
                    ))}
                  </tr>
                  {shown && (
                    <>
                      <tr className="week-placements" aria-label={`Placements of ${label.toLowerCase()}`}>
                        <td className="muted">Best Battle</td>
                        {group.best.fights.map((fight) => (
                          <td key={fight.position}>
                            <LayoutMap mapName={TITAN_MAP} layout={layoutOf(fight)} map={map} />
                          </td>
                        ))}
                      </tr>
                      <tr aria-label={`Battles of ${label.toLowerCase()}`}>
                        <td colSpan={1 + BOSSES_PER_TITAN_PHASE} className="muted">
                          {group.battles.map((b) => `${formatDamageShort(b.total)} at level ${b.level} (${b.createdAt})`).join(' · ')}
                        </td>
                      </tr>
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {groups.length > GROUPS && (
        <button className="small" onClick={() => setAll((old) => !old)}>
          {all ? 'Show fewer' : `Show ${groups.length - GROUPS} more`}
        </button>
      )}
    </section>
  );
}

/**
 * The best runs of the current Season's Titan Reaver event of a Season Phase, one section for each Titan Reaver Phase (they are independent and open together):
 * the score so far, and the Battles that fielded the same two formations as one group, ranked by their best total. Computed from the records.
 */
export function ThisEvent({ reference, onShowRecords }: { reference: Reference; onShowRecords: (seasonPhase: number, titanPhase: TitanPhase) => void }) {
  const [seasonPhase, setSeasonPhase] = useState(reference.seasonPhase);
  const loaded = useLoad(() => api.titanReaverBattles({ limit: String(ALL_BATTLES), season: String(reference.season), seasonPhase: String(seasonPhase) }), [seasonPhase, reference.season]);
  const isCurrent = seasonPhase === reference.seasonPhase;

  return (
    <div>
      <label className="field">
        Season Phase
        <select value={seasonPhase} onChange={(e) => setSeasonPhase(Number(e.target.value))}>
          {SEASON_PHASES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      {loaded.error && <Notice kind="error">{loaded.error}</Notice>}
      {loaded.data && loaded.data.length >= ALL_BATTLES && <Notice kind="error">Only the newest {ALL_BATTLES.toLocaleString('en-US')} Battles are read: older ones are missing from these figures.</Notice>}
      {loaded.data &&
        TITAN_PHASES.map((phase, index) => (
          <PhaseSection
            key={`${seasonPhase}-${phase}`}
            phase={phase}
            seasonPhase={seasonPhase}
            battles={loaded.data!.filter((b) => b.titanPhase === phase)}
            declared={isCurrent ? reference.setup.bosses.slice(index * BOSSES_PER_TITAN_PHASE, (index + 1) * BOSSES_PER_TITAN_PHASE) : []}
            onShowRecords={() => onShowRecords(seasonPhase, phase)}
          />
        ))}
      <p className="muted">
        The best Battles of Season {reference.season}'s Titan Reaver event of the Season Phase, for each Titan Reaver Phase on its own. Battles that fielded the same two teams (same heroes and Artifact, wherever they stood) are one group, whatever their team level, shown by its best Battle; a lower level has a lower total and so ranks lower. Open a group to see where the heroes stood and every Battle in it.
      </p>
    </div>
  );
}
