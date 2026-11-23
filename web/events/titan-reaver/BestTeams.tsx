import { Fragment, useMemo, useState } from 'react';
import { Damage } from '../../ui/Damage.js';
import { ANECDOTE_BELOW, MAX_LEVEL, TITAN_MAP, bestTeams, levelsOf, type BestTeam } from '../../../src/domain/titan-reaver.js';
import { layoutFrom } from '../../../src/domain/layout.js';
import { api, type TitanReaverBattle } from '../../backend.js';
import { LayoutMap } from '../../dream-hunt/BestTeams.js';
import { HeroFilter } from '../../dream-hunt/HeroFilter.js';
import { toggled } from '../../format.js';
import { useLoad } from '../../hooks/load.js';
import { useMaps } from '../../hooks/maps.js';
import { TeamOverview } from '../../stats/TeamOverview.js';
import { TagFilter } from '../../Tags.js';
import { DisclosureMark } from '../../ui/Icon.js';
import { Notice } from '../../ui/Notice.js';
import { ALL_BATTLES, type Reference } from './draft.js';

type Formation = TitanReaverBattle['fights'][number]['formation'];

const layoutOf = (formation: Formation) => layoutFrom({ heroes: formation.heroes.map((h) => ({ tile: h.tile, hero: h.name, part: h.part })), phantimal: formation.phantimal });

/** What is worth saying next to a team: how sure the figures are, that it has no fight at the level, and that it did better at a level both were recorded at. */
function Notes({ team }: { team: BestTeam<Formation> }) {
  return (
    <>
      {team.best !== null && team.anecdote && (
        <span className="badge few" title={`Fewer than ${ANECDOTE_BELOW} fights at this level`}>
          anecdote
        </span>
      )}
      {team.lowerLevel && (
        <span className="badge few" title="No fight at the chosen level: its best is at a lower one">
          lower level: best <Damage value={team.lowerLevel.best} /> at level {team.lowerLevel.level}
        </span>
      )}
      {team.beat && (
        <span className="muted" title="Damage is never scaled by level: levels are compared only when exactly equal">
          {' '}
          Beat the top team at level {team.beat.level}: <Damage value={team.beat.damage} /> vs <Damage value={team.beat.against} /> ({team.beat.fights} and {team.beat.againstFights} {team.beat.againstFights === 1 ? 'fight' : 'fights'})
        </span>
      )}
    </>
  );
}

/**
 * The teams recorded against a boss, best first at one team level: each judged on all its fights at that level (count, median, best), the
 * ones with none after them, and a note on any that beat the top team at a level both were recorded at. Opened, a team shows where its
 * heroes stood, best damage first.
 */
export function BestTeams({ reference }: { reference: Reference }) {
  const [tag, setTag] = useState<string[]>([]);
  const [bossChoice, setBossChoice] = useState('');
  const [levelChoice, setLevelChoice] = useState<number | null>(null);
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { maps, error: mapsError } = useMaps();
  const loaded = useLoad(() => api.titanReaverBattles({ limit: String(ALL_BATTLES), tag }), [tag.join('|')]);
  const battles = loaded.data;

  const fought = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of battles ?? []) for (const f of b.fights) counts.set(f.boss, (counts.get(f.boss) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [battles]);
  const boss = bossChoice || fought[0]?.[0] || '';
  const currentMax = MAX_LEVEL[reference.seasonPhase]!;
  const level = levelChoice ?? currentMax;
  const levels = useMemo(() => [...new Set([...(battles ? levelsOf(battles, boss) : []), currentMax])].sort((a, b) => b - a), [battles, boss, currentMax]);
  const teams = useMemo(() => (battles && boss ? bestTeams(battles, boss, level, { include, exclude }) : []), [battles, boss, level, include, exclude]);
  const offered = useMemo(() => [...new Set((battles ?? []).flatMap((b) => b.fights.filter((f) => f.boss === boss).flatMap((f) => f.formation.heroes.map((h) => h.name))))].sort(), [battles, boss]);
  const map = maps.find((m) => m.name === TITAN_MAP);

  return (
    <div>
      <div className="filters">
        <label className="field">
          Boss
          <select value={boss} onChange={(e) => (setBossChoice(e.target.value), setOpen(new Set()))}>
            {fought.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Team level
          <select value={level} onChange={(e) => setLevelChoice(Number(e.target.value))}>
            {levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <TagFilter value={tag} onChange={setTag} />
        <HeroFilter offered={offered} include={include} exclude={exclude} onChange={(next) => (setInclude(next.include), setExclude(next.exclude))} />
      </div>
      <p className="muted">
        Each team (the same heroes and Artifact count as one team wherever they stand) is judged on its fights against this boss at the chosen team level, in every event and Season: the count, the median and the best damage. Damage is never scaled by level, so levels are
        compared only when exactly equal. Teams with no fight at this level come after, with their best at their own highest level. A team with a lower damage than the top one that did better at a level both were recorded at says so. Under {ANECDOTE_BELOW} fights is an anecdote,
        not evidence. Open a team to see where its heroes stood.
      </p>
      {loaded.error && <Notice kind="error">{loaded.error}</Notice>}
      {mapsError && <Notice kind="error">{mapsError}</Notice>}
      {battles && battles.length >= ALL_BATTLES && <Notice kind="error">Only the newest {ALL_BATTLES.toLocaleString('en-US')} Battles are read: older ones are missing from these figures.</Notice>}
      {battles && fought.length === 0 && <p className="muted">No Titan Reaver fights recorded{tag.length > 0 ? ' with these tags' : ''} yet.</p>}
      {battles && fought.length > 0 && teams.length === 0 && <p className="muted">No recorded team matches these heroes.</p>}
      {teams.length > 0 && (
        <table className="data-table" aria-label="Best teams">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>Fights</th>
              <th>Median</th>
              <th>Best</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team, index) => (
              <Fragment key={team.key}>
                <tr className={team.anecdote ? 'low' : undefined}>
                  <td>{index + 1}</td>
                  <td>
                    <div
                      className="team-cell"
                      role="button"
                      tabIndex={0}
                      aria-expanded={open.has(team.key)}
                      aria-label={`${open.has(team.key) ? 'Hide' : 'Show'} placements of team ${index + 1}`}
                      onClick={() => setOpen((current) => toggled(current, team.key))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        setOpen((current) => toggled(current, team.key));
                      }}
                    >
                      <TeamOverview heroes={team.latest.heroes} phantimal={team.latest.phantimal} artifact={team.latest.artifact} size={32} />
                      <span className="muted" aria-hidden="true">
                        <DisclosureMark open={open.has(team.key)} />
                      </span>
                    </div>
                  </td>
                  <td>{team.fights}</td>
                  <td>{team.median !== null ? <Damage value={Math.round(team.median)} /> : '–'}</td>
                  <td>{team.best !== null ? <Damage value={team.best} /> : '–'}</td>
                  <td>
                    <Notes team={team} />
                  </td>
                </tr>
                {open.has(team.key) && (
                  <tr>
                    <td colSpan={6}>
                      <ul className="layouts">
                        {team.placements.map((p) => (
                          <li key={p.key} className="layout-card">
                            <LayoutMap mapName={TITAN_MAP} layout={layoutOf(p.formation)} map={map} />
                            <div className="layout-facts">
                              <strong>{TITAN_MAP}</strong>
                              <div>
                                {p.fights} {p.fights === 1 ? 'fight' : 'fights'}, best <Damage value={p.best} />
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
