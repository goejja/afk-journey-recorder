import { useEffect, useRef, useState } from 'react';
import { useAction } from '../hooks/action.js';
import { joinNotices, stepAfterSave } from '../hooks/saved.js';
import { ARTIFACT_ONCE_MODES, heroesAlreadyUsed, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { api, type ArenaBattle, type ArenaMode, type Profile, type RoundDeploymentEntry } from '../backend.js';
import { SideProfileBar } from './BattleEditor.js';
import { formationBorrow } from './borrow.js';
import { swapParts } from '../swap.js';
import { withRosterStates, toPayload } from '../FormationEditor.js';
import { withRosterOpponent, toOpponentPayload } from './OpponentEditor.js';
import { RecordShell } from '../RecordShell.js';
import { type ImportRound } from '../reader/BattleImport.js';
import { nameOf } from '../reader/battle-import-edits.js';
import { ROUNDS, type Round } from '../../src/domain/tournament.js';
import { turnTeam, withPlacement, withSeenAs, type RoundTeam } from '../../src/domain/round-deployment.js';
import { RoundDeploymentBar } from './RoundDeploymentBar.js';
import { opponentFromTeam, ownFromTeam, teamOfOpponent, teamOfOwn, withoutGuess } from './round-deployment.js';
import { feedbackOf, knownPlacementOpponent, knownPlacementOwn } from '../reader/battle-import.js';
import { sendFeedback, useParkedToast } from '../reader/parked-toast.js';
import { recordedHeroes, useRosterSync } from '../reader/RosterSync.js';
import { useProfileRosters } from '../reader/useProfileRosters.js';
import { useConfirm, useNameDialog } from '../ui/Dialog.js';
import { FormationIdField } from '../FormationIdField.js';
import { useLoad, useNewest } from '../hooks/load.js';
import { type PatchReference, type Reference, type Draft, onMap, newDraft, weekly, withDefault, sharedTags, toInput, type Clone, loadRoundDeployments, profileByPlayerId, type Side } from './draft.js';
import { ArenaIdentity, WinnerField, Board, FightFormationIds, UnionLevels } from './BoardParts.js';
import { useToast } from '../ui/Toast.js';

/** Sets up one team per slot of the mode, greying out heroes the other teams use, then saves each as its own record. */
export function NewBattles({ reference, patchReference, initial, editing, savedRound, onSaved, onRecorded, onCancel, cancelLabel }: { reference: Reference; patchReference: PatchReference; initial?: Clone | null; /** The id of a saved battle that `initial` holds, to edit it as a whole. */ editing?: number | null; /** The Tournament and Round a saved Super League battle has now, to let the player move it to another Round. */ savedRound?: { tournamentId: number; round: Round } | null; onSaved: (notice?: string | null) => void; onRecorded: () => void; onCancel: () => void; /** What the cancel button says, when it leads back to the import. */ cancelLabel?: string }) {
  const [mode, setMode] = useState<ArenaMode>(initial?.mode ?? 'Arena');
  const [editedRound, setEditedRound] = useState<Round | null>(savedRound?.round ?? null);
  const [drafts, setDrafts] = useState<Draft[]>(() => initial?.drafts ?? [newDraft(reference)]);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: saveDialog } = useConfirm();
  const reportParked = useParkedToast();
  const [status, setStatus] = useState<string | null>(() => initial?.notes?.join(' ') || null);
  const toast = useToast();
  // The Formation ID of each side stands for the teams of the whole battle (ADR 0007); a battle of one team keeps its own on the team.
  const [formationIds, setFormationIds] = useState(() => initial?.formationIds ?? { a: '', b: '' });
  // The profile of each side holds for every team of the battle. One found from the Player ID of a saved battle is remembered (to offer
  // the roster sync) and its roster is loaded for heroes placed later; one chosen here also overwrites the states of the heroes already placed and gives the side's heroes its ranks and equipment.
  const [chosenProfile, setChosenProfile] = useState<Record<Side, number | null>>(() => ({
    A: initial?.profiles?.A ?? profileByPlayerId(reference.profiles, initial?.drafts[0]?.playerIdA),
    B: initial?.profiles?.B ?? profileByPlayerId(reference.profiles, initial?.drafts[0]?.playerIdB),
  }));
  const [profileRoster, setProfileRoster] = useProfileRosters(chosenProfile);
  const newestA = useNewest();
  const newestB = useNewest();
  const newestRoster = { A: newestA, B: newestB };
  const sync = useRosterSync();
  const { name: askName, dialog: nameDialog } = useNameDialog();
  // The saved fights of the mode, whose placements the "Place … as in saved fights" button offers; a saved battle being edited does not get them.
  const loadedFights = useLoad(() => api.arenaBattles({ mode: [mode], limit: '1000' }), [mode, editing], editing == null);
  const savedFights: ArenaBattle[] = Array.isArray(loadedFights.data) ? loadedFights.data : [];
  // What a click replaced, per side and team, to undo it while the side is as the click left it.
  const [replaced, setReplaced] = useState<Record<Side, { team: number; before: Draft['formation'] | Draft['opponent']; after: Draft['formation'] | Draft['opponent'] }[]>>({ A: [], B: [] });

  /** `known` is a profile just made, which `reference` does not hold until the page has drawn again. */
  async function chooseProfile(side: Side, id: number | null, known?: Profile) {
    const current = newestRoster[side](); // a roster that arrives after another profile was chosen for this side, or None, is dropped
    const after = known ?? reference.profiles.find((p) => p.id === id);
    setChosenProfile((old) => ({ ...old, [side]: id }));
    // The profile's Player ID goes on the side, and the previous profile's comes off.
    const key = side === 'A' ? 'playerIdA' : 'playerIdB';
    setDrafts((old) => old.map((d) => ({ ...d, [key]: after?.playerId ?? null })));
    if (id === null) return setProfileRoster((old) => ({ ...old, [side]: null }));
    try {
      const roster = await api.heroes(id);
      if (!current()) return;
      setProfileRoster((old) => ({ ...old, [side]: roster }));
      // Heroes already placed on the side, in every team, take the profile's state.
      // Editing a saved battle keeps the states it recorded (ADR 0001): only heroes with none take the profile's.
      const overwrite = editing == null;
      setDrafts((old) => old.map((d) => (side === 'A' ? { ...d, formation: withRosterStates(d.formation, roster, overwrite) } : { ...d, opponent: withRosterOpponent(d.opponent, roster, overwrite) })));
      setError(null);
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }

  /** Gives the profile a side holds its Player ID, which the side's records keep (ADR 0006); the side takes it. */
  async function givePlayerId(side: Side, playerId: string) {
    const profile = reference.profiles.find((p) => p.id === chosenProfile[side]);
    if (!profile) return;
    try {
      const updated = await api.updateProfile(profile.id, { playerId });
      patchReference((old) => ({ profiles: old.profiles.map((p) => (p.id === updated.id ? updated : p)) }));
      const key = side === 'A' ? 'playerIdA' : 'playerIdB';
      setDrafts((old) => old.map((d) => ({ ...d, [key]: updated.playerId })));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** A profile made from the form, named after the player of the picture; the side takes it. It has no Player ID: that is added in Profiles. */
  async function createProfile(side: Side) {
    const name = await askName({
      title: `Name of the new profile for Side ${side}`,
      initialValue: initial?.names?.[side] ?? '',
      confirmLabel: 'Create',
    });
    if (!name) return;
    try {
      const created = await api.createProfile({ name });
      patchReference((old) => ({ profiles: [...old.profiles, created] }));
      await chooseProfile(side, created.id, created);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // The Round Deployments of the battle's Round (Super League read from pictures): matched live with the teams in the form.
  // Editing a saved battle of a Tournament: its Round, as chosen in the form, so the player can confirm the Round Deployment from it too.
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
      (e: Error) => live && setError(`The Tournament of this battle could not be read: ${e.message}`),
    );
    return () => void (live = false);
  }, [savedTournamentId]);
  const round: ImportRound | null = initial?.round ?? (savedRound && editedRound && tournamentLabel !== null ? { tournamentId: savedRound.tournamentId, round: editedRound, label: tournamentLabel } : null);
  const [deployments, setDeployments] = useState<RoundDeploymentEntry[]>(initial?.deployments ?? []);
  const [deploying, setDeploying] = useState(false);
  /** Why the last confirmation was refused, shown beside the buttons so it is not missed. */
  const [deployError, setDeployError] = useState<string | null>(null);
  const newestDeployments = useNewest();
  /** Only the latest read counts, whether it is for the Round that was just chosen or after a confirmation: a slow one for another Round is dropped, failure included. */
  const reloadDeployments = async () => {
    if (!round) return;
    const current = newestDeployments();
    try {
      const loaded = await loadRoundDeployments(round, reference.profiles);
      if (current()) setDeployments(loaded);
    } catch (e) {
      if (current()) throw e;
    }
  };
  const reloadLatest = useRef(reloadDeployments);
  reloadLatest.current = reloadDeployments;
  const roundKey = round ? `${round.tournamentId}/${round.round}` : null;
  useEffect(() => {
    if (roundKey !== null) void reloadLatest.current().catch((e: Error) => setError(e.message)); // the read says what it was reading
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
  async function confirmSidesChosen(sides: Side[]) {
    if (!round) return;
    if (chosenProfile.A !== null && chosenProfile.A === chosenProfile.B) {
      setStatus(null);
      return setDeployError('Side A and Side B are the same Profile: a Battle is between two Players, so give one side the right Profile first.');
    }
    const chosen = sides.flatMap((side) => {
      const profile = reference.profiles.find((p) => p.id === chosenProfile[side]);
      return profile ? [{ side, profile }] : [];
    });
    if (chosen.length === 0) return;
    setDeploying(true);
    setDeployError(null);
    try {
      const entries = chosen.map(({ side, profile }) => ({ profileId: profile.id, teams: confirmTeams(side, profile.id) }));
      // one side keeps the single-Profile write; both sides go together, so a half-confirmed Battle cannot happen (ADR 0021)
      if (entries.length === 1) await api.saveRoundDeployment(round.tournamentId, round.round, entries[0]!.profileId, entries[0]!.teams);
      else await api.saveRoundDeployments(round.tournamentId, round.round, entries);
      await reloadDeployments();
      setError(null);
      setStatus(
        `Round Deployment of ${chosen.map((c) => c.profile.name).join(' and ')} saved for ${round.label}, ${round.round} with the tiles as placed here: later battles of this Round fill from it.`,
      );
    } catch (e) {
      setStatus(null);
      setDeployError(`${chosen.length > 1 ? 'The sides' : `Side ${chosen[0]!.side}`} ${chosen.length > 1 ? 'were' : 'was'} not saved as the Round Deployment: ${(e as Error).message}`);
    } finally {
      setDeploying(false);
    }
  }

  /** Saves one side as its Profile's Round Deployment (the per-side button). */
  const confirmDeployment = (side: Side) => void confirmSidesChosen([side]);

  /** Puts the Deployment's team over a team of the form. */
  function useDeployment(side: Side, slot: number, deployed: RoundTeam) {
    const cells = cellsOf(drafts[slot]!);
    setDrafts((old) => old.map((d, i) => (i !== slot ? d : side === 'A' ? { ...d, formation: ownFromTeam(deployed, cells) } : { ...d, opponent: opponentFromTeam(turnTeam(deployed), cells) })));
  }

  /** After a battle is saved: the Round Deployment teams with the saved teams' heroes and no tiles take the tiles just saved. */
  async function fillDeploymentTiles(saved: { d: Draft; index: number }[]) {
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

  /** After saving a new battle: each side with a profile is compared with that profile's roster as it is now. */
  async function syncRosters(saved: Draft[], attemptIds: number[]) {
    for (const side of ['A', 'B'] as const) {
      const profile = reference.profiles.find((p) => p.id === chosenProfile[side]);
      if (!profile) continue;
      const roster = await api.heroes(profile.id);
      const recorded = saved.flatMap((d) => recordedHeroes(side === 'A' ? toPayload(d.formation) : toOpponentPayload(d.opponent)));
      await sync.ask(recorded, roster, reference.heroRules, profile, { attemptIds, side });
      if (profileRoster[side]) setProfileRoster((old) => ({ ...old, [side]: roster })); // the sync may have changed it
    }
  }

  function changeMode(next: ArenaMode) {
    setMode(next);
    setDrafts((old) => Array.from({ length: TEAMS_PER_MODE[next] }, (_, i) => withDefault(reference, next, old[i] ?? { ...newDraft(reference), ...sharedTags(old[0]) }, i)));
    setCurrent(0);
  }

  const unavailable = new Map<string, string>();
  drafts.forEach((d, i) => {
    if (i === current) return;
    const used = heroesAlreadyUsed([{ heroes: d.formation.placed.map((p) => p.hero), assist: d.formation.assist || null }]);
    for (const name of used) unavailable.set(name, `Used in team ${i + 1}`);
  });

  const draft = drafts[current]!;
  // An update function, so taking a hero from another team and placing it here both apply.
  const change = (d: Draft) => setDrafts((old) => old.map((x, i) => (i === current ? d : x)));
  const cellsOf = (d: Draft) => reference.maps.find((m) => m.name === d.mapName)?.cells ?? [];
  // For each side, the placement a saved fight gives each team whose heroes it has exactly (ADR 0013): offered, never applied by itself.
  const known: Record<Side, (Draft['formation'] | Draft['opponent'] | null)[]> = {
    A: drafts.map((d, i) => (editing != null ? null : knownPlacementOwn(savedFights, mode, i + 1, d.playerIdA, d.formation, cellsOf(d)))),
    B: drafts.map((d, i) => (editing != null ? null : knownPlacementOpponent(savedFights, mode, i + 1, d.playerIdB, d.opponent, cellsOf(d)))),
  };
  const placement: Record<Side, { teams: number[]; canUndo: boolean; onApply: () => void; onUndo: () => void }> = Object.fromEntries(
    (['A', 'B'] as const).map((side) => {
      const part = side === 'A' ? 'formation' : 'opponent';
      const teams = known[side].flatMap((k, i) => (k ? [i] : []));
      const undo = replaced[side].filter((r) => drafts[r.team]?.[part] === r.after);
      return [
        side,
        {
          teams,
          canUndo: undo.length > 0,
          onApply: () => {
            setReplaced((old) => ({ ...old, [side]: teams.map((team) => ({ team, before: drafts[team]![part], after: known[side][team]! })) }));
            setDrafts((old) => old.map((d, i) => (known[side][i] ? { ...d, [part]: known[side][i] } : d)));
          },
          onUndo: () => {
            setDrafts((old) => old.map((d, i) => ({ ...d, ...(undo.find((r) => r.team === i) ? { [part]: undo.find((r) => r.team === i)!.before } : {}) })));
            setReplaced((old) => ({ ...old, [side]: [] }));
          },
        },
      ];
    }),
  ) as Record<Side, { teams: number[]; canUndo: boolean; onApply: () => void; onUndo: () => void }>;
  const borrow = formationBorrow(drafts, current, 'team', setDrafts, ARTIFACT_ONCE_MODES.includes(mode));
  // The tags describe the whole battle (and the players behind its sides), so every team of it carries the same ones.
  const shareTags = (tags: Partial<ReturnType<typeof sharedTags>>) => setDrafts((old) => old.map((d) => ({ ...d, ...tags })));

  async function setDefault() {
    const weeklyMode = weekly(mode);
    if (weeklyMode === null) return;
    try {
      const slots = drafts.map((d) => ({ boss: null, mapName: d.mapName || null, rule: mode === 'Supreme Arena' ? d.rule || null : null }));
      patchReference({ defaults: await api.saveDefaults(weeklyMode, slots) });
      setError(null);
      toast(`Saved as this week’s ${mode} default: new battles start with these maps${mode === 'Supreme Arena' ? ' and rules' : ''}.`);
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  }

  const saving = useAction();
  const save = (another: boolean) => saving.run(() => saveNow(another));

  async function saveNow(another: boolean) {
    const filled = drafts.map((d, index) => ({ d, index })).filter(({ d }) => d.formation.placed.length > 0 || d.opponent.placed.length > 0);
    if (filled.length === 0) return setError('Place at least one hero in a team');
    // a Battle of a Round is all five fights; saving fewer is possible, but only after the player says so (ADR 0021)
    if (
      initial?.round &&
      filled.length < TEAMS_PER_MODE[mode] &&
      !(await confirm({
        title: `Save ${filled.length} of ${TEAMS_PER_MODE[mode]} fights?`,
        message: `A ${mode} Battle has ${TEAMS_PER_MODE[mode]} fights. Saving now leaves the other ${TEAMS_PER_MODE[mode] - filled.length} out of the record.`,
        confirmLabel: `Save ${filled.length}`,
        danger: true,
      }))
    )
      return;
    let notice: string | null = null;
    try {
      // The teams of a Supreme Arena, Super League or Guild Duel battle are saved together, as one battle, or not at all.
      const codes = { formationId: formationIds.a, opponentFormationId: formationIds.b };
      let savedIds: number[] = [];
      if (editing != null) await api.updateArenaBattleGroup(editing, filled.map(({ d, index }) => ({ ...toInput(mode, d), position: index + 1 })), codes, savedRound && editedRound ? { tournamentId: savedRound.tournamentId, round: editedRound } : undefined);
      else if (TEAMS_PER_MODE[mode] > 1) savedIds = (await api.createArenaBattleGroup(mode, filled.map(({ d, index }) => ({ ...toInput(mode, d), position: index + 1 })), codes, initial?.round ? { tournamentId: initial.round.tournamentId, round: initial.round.round } : undefined)).fights.map((f) => f.id);
      else savedIds = [(await api.createArenaBattle(toInput(mode, filled[0]!.d))).id];
      // The tiles of the teams just saved go to the Round Deployment teams that have none yet (ADR 0020).
      const left: (string | null)[] = [];
      if (initial?.round && editing == null) left.push(await stepAfterSave(() => fillDeploymentTiles(filled), 'The Round Deployment could not be given the tiles'));
      // A new battle may carry upgrades the profiles' rosters have not heard of yet; editing a saved one does not ask.
      if (editing == null) left.push(await stepAfterSave(() => syncRosters(filled.map(({ d }) => d), savedIds)));
      // what the pictures said, set against what was kept: for measuring the readings and learning artifact and phantimal looks. A failure here changes nothing,
      // and the owner has no use for it (it is reported outside the app), so it stays silent. The save does not wait for the answer: a toast tells the
      // owner when readings were parked to confirm in Admin > Reader (ADR 0040).
      const feedback = feedbackOf(filled.map(({ d }) => d), profileRoster);
      if (editing == null && feedback.length > 0) reportParked([sendFeedback(mode, feedback)]);
      // the pictures the fights were read from stay with them (ADR 0016); one at a time, as each is about a megabyte
      const pictures = filled.flatMap(({ d }, i) => (editing == null && d.imported?.picture && savedIds[i] !== undefined ? [{ attemptId: savedIds[i]!, ...d.imported.picture }] : []));
      if (pictures.length > 0) left.push(await stepAfterSave(() => pictures.reduce((done, p) => done.then(() => api.keepPicture(p.attemptId, p.label, p.data)).then(() => undefined), Promise.resolve()), 'The pictures could not be kept'));
      notice = joinNotices(left);
    } catch (e) {
      setStatus(null);
      return setError((e as Error).message);
    }
    if (!another || editing != null) return onSaved(notice);
    // Everything stays, so the same teams can be tried again with only the winner changed.
    setDrafts((old) => old.map(({ imported: _sent, ...d }) => ({ ...d, outcome: 'Win' as const })));
    setError(null);
    setStatus(`${TEAMS_PER_MODE[mode] > 1 ? `Saved ${filled.length} ${filled.length === 1 ? 'team' : 'teams'} as one battle` : 'Saved 1 battle'}. The teams are still here: set the winner and save again.${notice ? ` ${notice}` : ''}`);
    onRecorded();
  }

  return (
    <>
    {sync.dialog}
    <RecordShell
      title={editing != null ? `Edit ${mode} battle` : 'New battles'}
      onSetDefault={weekly(mode) === null || editing != null ? undefined : () => void setDefault()}
      identity={<ArenaIdentity mode={mode} onMode={editing != null ? undefined : changeMode} draft={draft} reference={reference} onChange={change} />}
      result={<WinnerField draft={draft} onChange={change} />}
      note={draft.note}
      onNote={(note) => change({ ...draft, note })}
      tags={draft.tags}
      onTags={(tags) => shareTags({ tags })}
      deployment={round ? (
      <RoundDeploymentBar
        tournament={round.label}
        round={round.round}
        sides={{ A: { profileId: chosenProfile.A, name: reference.profiles.find((p) => p.id === chosenProfile.A)?.name ?? null, teams: teamsOf('A') }, B: { profileId: chosenProfile.B, name: reference.profiles.find((p) => p.id === chosenProfile.B)?.name ?? null, teams: teamsOf('B') } }}
        entries={deployments}
        busy={deploying}
        error={deployError}
        onConfirm={(side) => void confirmDeployment(side)}
        onUse={useDeployment}
      />
      ) : undefined}
      fields={
        <>
          <SideProfileBar
            profiles={reference.profiles}
            sideProfiles={chosenProfile}
            onSideProfile={(side, id) => void chooseProfile(side, id)}
            onNewProfile={editing == null ? (side) => void createProfile(side) : undefined}
            onSetPlayerId={(side, playerId) => void givePlayerId(side, playerId)}
            placement={editing == null ? placement : undefined}
          />
          <UnionLevels mode={mode} draft={draft} onChange={(d) => shareTags({ unionLevel: d.unionLevel, opponentUnionLevel: d.opponentUnionLevel })} />
          {savedRound && editedRound && (
            <label className="field">
              Round
              <select aria-label="Round" value={editedRound} onChange={(e) => setEditedRound(e.target.value as Round)}>
                {ROUNDS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          )}
        </>
      }
      formationIds={
        TEAMS_PER_MODE[mode] > 1 ? (
          // A code covers the teams of the whole battle: the units, tiles and artifacts of every team placed (ADR 0007).
          <>
            <FormationIdField label="Side A" value={formationIds.a} onChange={(a) => setFormationIds((old) => ({ ...old, a }))} teams={drafts.map((d) => ({ placed: d.formation.placed, phantimal: d.formation.phantimal, artifact: d.formation.artifact }))} />
            <FormationIdField label="Side B" value={formationIds.b} onChange={(b) => setFormationIds((old) => ({ ...old, b }))} teams={drafts.map((d) => ({ placed: d.opponent.placed, phantimal: d.opponent.phantimal, artifact: d.opponent.artifact }))} />
          </>
        ) : (
          <FightFormationIds draft={draft} onChange={change} />
        )
      }
      teams={{
        labels: drafts.map((d, i) => `Team ${i + 1}${d.formation.placed.length > 0 ? ` (${d.formation.placed.length})` : ''}`),
        current,
        onSelect: setCurrent,
        hint: `Heroes used by your other teams are greyed out: click one to move it here. Each team with heroes is saved as its own record.${editing != null ? ' A team left without heroes is removed from the battle.' : ''}`,
        onCopyPrevious: () => {
          const previous = drafts[current - 1];
          if (!previous) return;
          const sameMap = previous.mapName === draft.mapName;
          change({ ...draft, mapName: previous.mapName, rule: previous.rule, ...(sameMap ? {} : onMap(reference, previous.mapName, draft)) });
        },
        // The formations trade places, on one side or both; the map, rule and result stay with the team.
        swap: {
          sides: [{ value: 'mine', label: 'my formation' }, { value: 'opponent', label: 'the opponent’s formation' }, { value: 'both', label: 'both formations' }],
          onSwap: (other, side) =>
            setDrafts((old) => swapParts(old, current, other, side === 'mine' ? ['formation'] : side === 'opponent' ? ['opponent'] : ['formation', 'opponent'], (d) => ({ ...d, ...onMap(reference, d.mapName, d) }))),
        },
      }}
      error={error}
      status={status}
      saveLabel={editing != null ? 'Save changes' : `Save ${drafts.length > 1 ? 'battles' : 'battle'}`}
      onSave={() => void save(false)}
      onSaveAnother={editing != null ? undefined : () => void save(true)}
      saving={saving.busy}
      onCancel={onCancel}
      cancelLabel={cancelLabel}
    >
      <Board key={current} draft={draft} mode={mode} reference={reference} unavailable={unavailable} borrow={borrow} sideRosters={profileRoster} onChange={change} />
      {nameDialog}
      {saveDialog}
    </RecordShell>
    </>
  );
}
