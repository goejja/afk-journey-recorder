import { useState } from 'react';
import { matchTeam, type Change, type RoundTeam, type TeamMatch } from '../../src/domain/round-deployment.js';
import type { Round } from '../../src/domain/tournament.js';
import type { RoundDeploymentEntry } from '../backend.js';
import { readSideOfTeam } from './round-deployment.js';

type Side = 'A' | 'B';

export interface BarSide {
  profileId: number | null;
  name: string | null;
  /** The teams in the form with Side A's tiles, one per team number; null for a team with no hero. */
  teams: (RoundTeam | null)[];
}

/** One line for what a picture reads differently from a Round Deployment's team. */
export function describe(change: Change): string {
  switch (change.kind) {
    case 'hero':
      return `${change.gone.length > 0 ? change.gone.join(', ') : 'nobody'} replaced by ${change.added.length > 0 ? change.added.join(', ') : 'nobody'}`;
    case 'rank':
      return `${change.hero} rank ${change.from} to ${change.to}`;
    case 'equipment':
      return `${change.hero} equipment ${change.from} to ${change.to}`;
    case 'artifact':
      return `artifact ${change.from} to ${change.to}`;
    case 'phantimal':
      return `phantimal ${change.from} to ${change.to}`;
  }
}

type TeamState =
  | { state: 'empty' }
  | { state: 'unknown'; recorded?: boolean }
  | { state: 'ok'; recorded?: boolean }
  | { state: 'differs'; recorded?: boolean; match: Extract<TeamMatch, { state: 'changed' }>; deployed: RoundTeam };

/**
 * The Round Deployment of the two Profiles of a Super League battle being recorded (ADR 0020), condensed to one line for both Profiles: each one's name,
 * five boxes (one per team) saying whether the form matches the confirmed team, and the Confirm button. A matching or unconfirmed team needs
 * no words — the box says it. Only a team that differs speaks: clicking its box shows the changes a picture reads and the button that puts the
 * Deployment's team in the form, right beside the name instead of in a line below, so the panel stays a reference, not a wall.
 */
export function RoundDeploymentBar({ tournament, round, sides, entries, busy, error, onConfirm, onUse }: {
  tournament: string;
  round: Round;
  sides: Record<Side, BarSide>;
  entries: RoundDeploymentEntry[];
  busy: boolean;
  /** Why the last confirmation was refused. */
  error?: string | null;
  onConfirm: (side: Side) => void;
  onUse: (side: Side, slot: number, deployed: RoundTeam) => void;
}) {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  return (
    <section className="panel deployment-bar" aria-label="Round Deployment">
      <h4 className="deployment-title">
        Round Deployment · {tournament}, {round}
      </h4>
      {(['A', 'B'] as const).map((side) => {
        const { profileId, name, teams } = sides[side];
        const entry = entries.find((e) => e.profileId === profileId);
        if (profileId === null)
          return (
            <span key={side} className="muted">
              Side {side} has no profile: choose one to use or confirm its Round Deployment.
            </span>
          );
        const states = teams.map((team, slot): TeamState => {
          if (!team) return { state: 'empty' };
          const deployed = entry?.teams[slot] ?? null;
          const recorded = entry?.recorded?.includes(slot);
          if (!deployed) return { state: 'unknown', recorded };
          const match = matchTeam(deployed, readSideOfTeam(team), 'A');
          return match.state === 'changed' ? { state: 'differs', recorded, match, deployed } : { state: 'ok', recorded };
        });
        const label = (slot: number, state: TeamState) =>
          state.state === 'empty'
            ? `Team ${slot + 1} of Side ${side}: no hero in the form`
            : state.state === 'ok'
              ? `Team ${slot + 1} of Side ${side}: matches the Round Deployment${state.recorded ? ' (from a saved Battle)' : ''}`
              : state.state === 'unknown'
                ? `Team ${slot + 1} of Side ${side}: not confirmed`
                : `Team ${slot + 1} of Side ${side}: differs from the Round Deployment`;
        // Only a team that differs has anything to say, and it says it beside the name: an open box of any other state shows nothing.
        const openSlot = openTeam !== null && openTeam.startsWith(`${side}-`) ? Number(openTeam.slice(side.length + 1)) : null;
        const openDiffers = openSlot !== null && states[openSlot]?.state === 'differs' ? (states[openSlot] as Extract<TeamState, { state: 'differs' }>) : null;
        return (
          <div key={side} role="group" aria-label={`Round Deployment of Side ${side}`} className="deployment-profile">
            <div className="deployment-line">
              <span className="deployment-ident">
                <strong className="deployment-name">
                  Side {side} · {name ?? entry?.name ?? 'profile'}
                </strong>
                {openDiffers && (
                  <span className="deployment-note">
                    <span className="badge few" role="status">
                      Team {openSlot! + 1}
                      {openDiffers.recorded ? ' (saved battle)' : ''}: Deployment changed? {openDiffers.match.changes.map(describe).join('; ')}
                    </span>
                    <button className="small" onClick={() => onUse(side, openSlot!, openDiffers.deployed)} disabled={busy}>
                      Use the Deployment’s team {openSlot! + 1}
                    </button>
                  </span>
                )}
              </span>
              <span className="deployment-check">
                <span className="deployment-boxes">
                  {states.map((state, slot) => (
                    <button
                      key={slot}
                      className={`deployment-box ${state.state}`}
                      aria-expanded={state.state === 'differs' ? openTeam === `${side}-${slot}` : undefined}
                      aria-label={label(slot, state)}
                      title={label(slot, state)}
                      disabled={state.state === 'empty'}
                      onClick={state.state === 'differs' ? () => setOpenTeam((old) => (old === `${side}-${slot}` ? null : `${side}-${slot}`)) : undefined}
                    >
                      {slot + 1}
                    </button>
                  ))}
                </span>
                <button
                  className="small"
                  onClick={() => onConfirm(side)}
                  disabled={busy || teams.every((t) => t === null)}
                  aria-label={`Confirm Side ${side} as the Round Deployment of ${name ?? 'this profile'}`}
                  title={teams.every((t) => t === null) ? `No hero is placed on Side ${side}` : undefined}
                >
                  Confirm
                </button>
              </span>
            </div>
          </div>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
