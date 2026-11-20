import { useState } from 'react';
import { heroNamesOf, type RoundDeployment } from '../../src/domain/round-deployment.js';
import type { Round } from '../../src/domain/tournament.js';
import type { Artifact, GameMap, Hero, Phantimal, Profile, Rules } from '../backend.js';
import { TeamEditorDialog } from '../TeamEditorDialog.js';
import { toggled } from '../format.js';
import { DisclosureMark } from '../ui/Icon.js';

/** The reference data a team is placed with: the form's own controls, not a second editor. */
export interface TeamEditorReference {
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  phantimals: Phantimal[];
  rules: Rules;
}

/** One Player's five teams in a Round, with where the shown team came from. */
export interface DeploymentRow {
  profileId: number;
  name: string;
  playerId: string | null;
  teams: RoundDeployment;
  /** The team slots (0-based) a saved Battle of the Round shows, not a confirmed Deployment. */
  recorded?: number[];
  /** True when a Deployment was confirmed for this Profile (so it can be moved or deleted). */
  confirmed?: boolean;
}

/**
 * What every Player known in a Tournament and Round fields (ADR 0021). Collapsed to one line per Player — the name and five boxes, one per
 * team — because the table is a reference, not the work: clicking a Player opens its five teams, with the repair actions a wrong
 * Deployment needs (move it to the right Profile, or delete it). A team from a saved Battle is marked as such; it is not a confirmation
 * and is never written by this view.
 */
export function RoundDeploymentsView({ tournament, round, rows, profiles, busy, teamReference, onSaveTeam, onDelete, onMove }: {
  tournament: string;
  round: Round;
  rows: DeploymentRow[];
  profiles: Profile[];
  busy: boolean;
  /** The form's own editor, for a team's heroes and tiles; omitted when the page has no reference data. */
  teamReference?: TeamEditorReference;
  /** Saves the whole Deployment of a Profile with one team edited; omitted with `teamReference`. */
  onSaveTeam?: (profileId: number, teams: RoundDeployment) => Promise<unknown>;
  onDelete: (profileId: number) => void;
  onMove: (profileId: number, to: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openProfiles, setOpenProfiles] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<{ row: DeploymentRow; slot: number } | null>(null);
  const editable = teamReference !== undefined && onSaveTeam !== undefined;
  const confirmed = rows.filter((row) => row.confirmed).length;
  const toggleProfile = (profileId: number) => setOpenProfiles((old) => toggled(old, profileId));

  return (
    <section className="panel" aria-label="Round Deployments">
      <div className="deployment-head">
        <button className="deployment-toggle" aria-expanded={open} aria-controls="round-deployments-list" onClick={() => setOpen((old) => !old)}>
          <DisclosureMark open={open} /> Round Deployments · {tournament}, {round}
        </button>
        <span className="muted">
          {rows.length} {rows.length === 1 ? 'Player' : 'Players'} · {confirmed} confirmed
        </span>
      </div>
      {open && (
        <div id="round-deployments-list">
          {rows.length === 0 ? (
            <p className="muted">No Player is known in this Round yet: read pictures, or confirm a side in the form of a Battle.</p>
          ) : (
            rows.map((row) => {
              const expanded = openProfiles.has(row.profileId);
              return (
                <div key={row.profileId} className="deployment-profile">
                  <div className="deployment-line">
                    <button className="deployment-name" aria-expanded={expanded} onClick={() => toggleProfile(row.profileId)}>
                      {row.name}
                      {row.playerId && <span className="muted"> · {row.playerId}</span>}
                    </button>
                    <span className="deployment-boxes">
                      {row.teams.map((team, slot) => {
                        const state = !team ? 'empty' : row.recorded?.includes(slot) ? 'saved' : 'confirmed';
                        const label = `${`Team ${slot + 1} of ${row.name}`}: ${state === 'empty' ? 'not confirmed' : state === 'saved' ? 'from a saved Battle' : 'confirmed'}`;
                        return (
                          <button key={slot} className={`deployment-box ${state}`} title={label} aria-label={label} onClick={() => toggleProfile(row.profileId)}>
                            {slot + 1}
                          </button>
                        );
                      })}
                    </span>
                    <span className="muted">{row.confirmed ? 'confirmed' : 'from saved Battles only'}</span>
                  </div>
                  {expanded && (
                    <>
                      <ul className="deployment-teams" aria-label={`Teams of ${row.name}`}>
                        {row.teams.map((team, slot) => (
                          <li key={slot} className="deployment-team">
                            <span className="muted">Team {slot + 1}</span>
                            {team ? (
                              <>
                                <span>{heroNamesOf(team).join(', ')}</span>
                                {team.artifact && <span className="muted">· {team.artifact}</span>}
                                {row.recorded?.includes(slot) && <span className="badge few">saved battle</span>}
                                {editable && (
                                  <button className="small" onClick={() => setEditing({ row, slot })} disabled={busy} aria-label={`Edit team ${slot + 1} of ${row.name}`}>
                                    Edit
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="muted">not confirmed</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {row.confirmed && (
                        <div className="deployment-repair">
                          <label className="field">
                            Move this Deployment to
                            <select
                              aria-label={`Move the Deployment of ${row.name}`}
                              value=""
                              onChange={(e) => e.target.value !== '' && onMove(row.profileId, Number(e.target.value))}
                              disabled={busy}
                            >
                              <option value="">another Profile…</option>
                              {profiles
                                .filter((p) => p.id !== row.profileId)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button className="small danger" onClick={() => onDelete(row.profileId)} disabled={busy} aria-label={`Delete the Deployment of ${row.name}`}>
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
      {editing && teamReference && onSaveTeam && editing.row.teams[editing.slot] && (
        <TeamEditorDialog
          title={`${editing.row.name}, Team ${editing.slot + 1}`}
          team={editing.row.teams[editing.slot]!}
          {...teamReference}
          onSave={(team) => {
            const teams = editing.row.teams.map((old, i) => (i === editing.slot ? team : old));
            setEditing(null);
            void onSaveTeam(editing.row.profileId, teams);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
