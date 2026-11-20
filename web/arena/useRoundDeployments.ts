import { useEffect, useRef, useState } from 'react';
import { api, type GameMap, type Profile, type RoundDeploymentEntry } from '../backend.js';
import { useAction } from '../hooks/action.js';
import { useNewest } from '../hooks/load.js';
import type { ImportRound } from '../reader/BattleImport.js';
import { nameOf } from '../reader/battle-import-edits.js';
import { turnTeam, withPlacement, withSeenAs, type RoundTeam } from '../../src/domain/round-deployment.js';
import type { Round } from '../../src/domain/tournament.js';
import { type Draft, loadRoundDeployments, type Side } from './draft.js';
import { opponentFromTeam, ownFromTeam, teamOfOpponent, teamOfOwn, withoutGuess } from './round-deployment.js';

export interface RoundDeploymentsOptions {
  /** The Round a Battle import came from. */
  initialRound?: ImportRound | null;
  initialDeployments?: RoundDeploymentEntry[];
  /** The Tournament and Round a saved Super League battle has now; with `editedRound`, the Round it is edited in. */
  savedRound?: { tournamentId: number; round: Round } | null;
  editedRound: Round | null;
  profiles: Profile[];
  maps: GameMap[];
  drafts: Draft[];
  /** Changes the draft of one team. */
  updateTeam: (slot: number, change: (d: Draft) => Draft) => void;
  chosenProfile: Record<Side, number | null>;
  onStatus: (message: string | null) => void;
  onError: (message: string | null) => void;
}

/**
 * The Round Deployments of the battle's Round (Super League read from pictures), matched live with the teams in the form: reading them,
 * confirming the sides the player corrected, putting a deployed team over a team of the form, and giving the confirmed teams the tiles
 * of a battle just saved. Editing a saved battle of a Tournament: the Round is the one chosen in the form, so the player can confirm the
 * Round Deployment from it too.
 */
export function useRoundDeployments({ initialRound, initialDeployments, savedRound, editedRound, profiles, maps, drafts, updateTeam, chosenProfile, onStatus, onError }: RoundDeploymentsOptions) {
  // the form's latest, so the reads below need not start again when it draws
  const latest = useRef({ onError, onStatus });
  latest.current = { onError, onStatus };
  const [tournamentLabel, setTournamentLabel] = useState<string | null>(null);
  const savedTournamentId = savedRound?.tournamentId;
  useEffect(() => {
    if (savedTournamentId === undefined) return;
    let live = true;
    void api.tournaments().then(
      (all) => {
        const found = all.find((t) => t.id === savedTournamentId);
        if (live && found) setTournamentLabel(nameOf(found));
      },
      (e: Error) => live && latest.current.onError(`The Tournament of this battle could not be read: ${e.message}`),
    );
    return () => void (live = false);
  }, [savedTournamentId]);
  const round: ImportRound | null = initialRound ?? (savedRound && editedRound && tournamentLabel !== null ? { tournamentId: savedRound.tournamentId, round: editedRound, label: tournamentLabel } : null);

  const [deployments, setDeployments] = useState<RoundDeploymentEntry[]>(initialDeployments ?? []);
  /** Confirming the sides; `error` is why the last confirmation was refused, shown beside the buttons so it is not missed. */
  const confirming = useAction();
  const newestDeployments = useNewest();
  /** Only the latest read counts, whether it is for the Round that was just chosen or after a confirmation: a slow one for another Round is dropped, failure included. */
  const reloadDeployments = async () => {
    if (!round) return;
    const current = newestDeployments();
    try {
      const loaded = await loadRoundDeployments(round, profiles);
      if (current()) setDeployments(loaded);
    } catch (e) {
      if (current()) throw e;
    }
  };
  const reloadLatest = useRef(reloadDeployments);
  reloadLatest.current = reloadDeployments;
  const roundKey = round ? `${round.tournamentId}/${round.round}` : null;
  useEffect(() => {
    if (roundKey !== null) void reloadLatest.current().catch((e: Error) => latest.current.onError(e.message)); // the read says what it was reading
  }, [roundKey]);

  /** The teams of a side with Side A's tiles, one per team number. */
  const teamsOf = (side: Side, from: Draft[] = drafts): (RoundTeam | null)[] =>
    from.map((d) => {
      const team = side === 'A' ? teamOfOwn(d.formation) : teamOfOpponent(d.opponent);
      return team && side === 'B' ? turnTeam(team) : team;
    });

  /** The teams of one side as they would be confirmed: a team with no hero keeps the confirmed one, a team only a saved Battle shows is not copied. */
  function confirmTeams(side: Side, profileId: number) {
    const entry = deployments.find((e) => e.profileId === profileId);
    return drafts.map((d, i) => {
      const raw = side === 'A' ? teamOfOwn(d.formation) : teamOfOpponent(d.opponent);
      if (!raw) return entry?.recorded?.includes(i) ? null : (entry?.teams[i] ?? null);
      const guess = d.guess?.[side];
      const known = guess ? withoutGuess(raw, guess, d.mapName) : raw;
      const team = side === 'B' ? turnTeam(known) : known;
      // the readings the player corrected go with the team, so the same pictures are not flagged again
      return withSeenAs({ ...team, ...(entry?.teams[i]?.seenAs ? { seenAs: entry.teams[i]!.seenAs } : {}) }, d.seen?.[side] ?? []);
    });
  }

  /** Saves the sides the player corrected in the form as their Round Deployments, in one transaction (ADR 0021). */
  async function confirm(sides: Side[]) {
    if (!round) return;
    confirming.setError(null);
    if (chosenProfile.A !== null && chosenProfile.A === chosenProfile.B) {
      onStatus(null);
      return confirming.setError('Side A and Side B are the same Profile: a Battle is between two Players, so give one side the right Profile first.');
    }
    const chosen = sides.flatMap((side) => {
      const profile = profiles.find((p) => p.id === chosenProfile[side]);
      return profile ? [{ side, profile }] : [];
    });
    if (chosen.length === 0) return;
    const entries = chosen.map(({ side, profile }) => ({ profileId: profile.id, teams: confirmTeams(side, profile.id) }));
    await confirming.run(
      () =>
        (async () => {
          // one side keeps the single-Profile write; both sides go together, so a half-confirmed Battle cannot happen (ADR 0021)
          if (entries.length === 1) await api.saveRoundDeployment(round.tournamentId, round.round, entries[0]!.profileId, entries[0]!.teams);
          else await api.saveRoundDeployments(round.tournamentId, round.round, entries);
          await reloadDeployments();
        })().catch((e: Error) => {
          onStatus(null);
          const who = chosen.length > 1 ? 'The sides were' : `Side ${chosen[0]!.side} was`;
          throw new Error(`${who} not saved as the Round Deployment: ${e.message}`);
        }),
      () => {
        onError(null);
        onStatus(`Round Deployment of ${chosen.map((c) => c.profile.name).join(' and ')} saved for ${round.label}, ${round.round} with the tiles as placed here: later battles of this Round fill from it.`);
      },
    );
  }

  /** Puts the Deployment's team over a team of the form. */
  function place(side: Side, slot: number, deployed: RoundTeam) {
    const cells = maps.find((m) => m.name === drafts[slot]!.mapName)?.cells ?? [];
    updateTeam(slot, (d) => (side === 'A' ? { ...d, formation: ownFromTeam(deployed, cells) } : { ...d, opponent: opponentFromTeam(turnTeam(deployed), cells) }));
  }

  /** After a battle is saved: the Round Deployment teams with the saved teams' heroes and no tiles take the tiles just saved. */
  async function fillTiles(saved: { d: Draft; index: number }[]) {
    if (!round) return;
    for (const side of ['A', 'B'] as const) {
      const entry = deployments.find((e) => e.profileId === chosenProfile[side]);
      if (!entry) continue;
      // only the confirmed teams are written back: a team a saved Battle shows already has its tiles
      const teams = entry.teams.map((t, i) => (entry.recorded?.includes(i) ? null : t));
      let changed = false;
      for (const { d, index } of saved) {
        const deployed = teams[index];
        const [current] = teamsOf(side, [d]);
        const next = deployed && current ? withPlacement(deployed, current, d.mapName) : null;
        if (next && JSON.stringify(next) !== JSON.stringify(deployed)) (teams[index] = next, (changed = true));
      }
      if (changed) await api.saveRoundDeployment(round.tournamentId, round.round, entry.profileId, teams);
    }
  }

  return { round, deployments, deploying: confirming.busy, deployError: confirming.error, teamsOf, confirm, place, fillTiles };
}
