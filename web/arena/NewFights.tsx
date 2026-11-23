import { useState } from 'react';
import { useAction } from '../hooks/action.js';
import { joinNotices, stepAfterSave } from '../hooks/saved.js';
import { ARTIFACT_ONCE_MODES, heroesAlreadyUsed, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { api, type ArenaFight, type ArenaMode } from '../backend.js';
import { SideProfileBar } from './FightTeamsEditor.js';
import { useSideProfiles } from './useSideProfiles.js';
import { useRoundDeployments } from './useRoundDeployments.js';
import { formationBorrow } from './borrow.js';
import { swapParts } from '../swap.js';
import { toPayload } from '../FormationEditor.js';
import { toOpponentPayload } from './OpponentEditor.js';
import { RecordShell } from '../RecordShell.js';
import { ROUNDS, type Round } from '../../src/domain/tournament.js';
import { RoundDeploymentBar } from './RoundDeploymentBar.js';
import { feedbackOf, knownPlacementOpponent, knownPlacementOwn } from '../reader/battle-import.js';
import { sendFeedback, useParkedToast } from '../reader/parked-toast.js';
import { recordedHeroes, useRosterSync } from '../reader/RosterSync.js';
import { useConfirm, useNameDialog } from '../ui/Dialog.js';
import { FormationIdField } from '../FormationIdField.js';
import { useLoad } from '../hooks/load.js';
import { type PatchReference, type Reference, type Draft, onMap, newDraft, weekly, withDefault, sharedTags, toInput, type Clone, profileByPlayerId, type Side } from './draft.js';
import { ArenaIdentity, WinnerField, FightEditor, FightFormationIds, UnionLevels } from './FightParts.js';

/** Sets up one team per slot of the mode, greying out heroes the other teams use, then saves each as its own record. */
export function NewFights({ reference, patchReference, initial, editing, savedRound, onSaved, onRecorded, onCancel, cancelLabel }: { reference: Reference; patchReference: PatchReference; initial?: Clone | null; /** The id of a saved battle that `initial` holds, to edit it as a whole. */ editing?: number | null; /** The Tournament and Round a saved Super League battle has now, to let the player move it to another Round. */ savedRound?: { tournamentId: number; round: Round } | null; onSaved: (notice?: string | null) => void; onRecorded: () => void; onCancel: () => void; /** What the cancel button says, when it leads back to the import. */ cancelLabel?: string }) {
  const [mode, setMode] = useState<ArenaMode>(initial?.mode ?? 'Arena');
  const [editedRound, setEditedRound] = useState<Round | null>(savedRound?.round ?? null);
  const [drafts, setDrafts] = useState<Draft[]>(() => initial?.drafts ?? [newDraft(reference)]);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: saveDialog } = useConfirm();
  const reportParked = useParkedToast();
  const [status, setStatus] = useState<string | null>(() => initial?.notes?.join(' ') || null);
  // The Formation ID of each side stands for the teams of the whole battle (ADR 0007); a battle of one team keeps its own on the team.
  const [formationIds, setFormationIds] = useState(() => initial?.formationIds ?? { a: '', b: '' });
  // The profile of each side holds for every team of the battle. One found from the Player ID of a saved battle is remembered (to offer
  // the roster sync) and its roster is loaded for heroes placed later; one chosen here also overwrites the states of the heroes already placed and gives the side's heroes its ranks and equipment.
  /** What the form does besides saving: a profile, the week's default. */
  const formAction = useAction({ toast: true });
  const { name: askName, dialog: nameDialog } = useNameDialog();
  const { chosenProfile, profileRoster, setProfileRoster, barProps } = useSideProfiles({
    profiles: reference.profiles,
    patchReference,
    opening: {
      A: initial?.profiles?.A ?? profileByPlayerId(reference.profiles, initial?.drafts[0]?.playerIdA),
      B: initial?.profiles?.B ?? profileByPlayerId(reference.profiles, initial?.drafts[0]?.playerIdB),
    },
    update: (change) => setDrafts((old) => old.map(change)),
    // Editing a saved battle keeps the states it recorded (ADR 0001): only heroes with none take the profile's.
    overwrite: editing == null,
    run: formAction.run,
    onError: (message) => {
      setError(message);
      formAction.setError(null);
    },
    // A profile made from the form is named after the player of the picture.
    askNewName: editing == null ? (side) => askName({ title: `Name of the new profile for Side ${side}`, initialValue: initial?.names?.[side] ?? '', confirmLabel: 'Create' }) : undefined,
  });
  const sync = useRosterSync();
  // The saved fights of the mode, whose placements the "Place … as in saved fights" button offers; a saved battle being edited does not get them.
  const loadedFights = useLoad(() => api.arenaFights({ mode: [mode], limit: '1000' }), [mode, editing], editing == null);
  const savedFights: ArenaFight[] = Array.isArray(loadedFights.data) ? loadedFights.data : [];
  // What a click replaced, per side and team, to undo it while the side is as the click left it.
  const [replaced, setReplaced] = useState<Record<Side, { team: number; before: Draft['formation'] | Draft['opponent']; after: Draft['formation'] | Draft['opponent'] }[]>>({ A: [], B: [] });

  const { round, deployments, deploying, deployError, teamsOf, confirm: confirmSides, place, fillTiles } = useRoundDeployments({
    initialRound: initial?.round,
    initialDeployments: initial?.deployments,
    savedRound,
    editedRound,
    profiles: reference.profiles,
    maps: reference.maps,
    drafts,
    updateTeam: (slot, change) => setDrafts((old) => old.map((d, i) => (i === slot ? change(d) : d))),
    chosenProfile,
    onStatus: setStatus,
    onError: setError,
  });

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
    const slots = drafts.map((d) => ({ boss: null, mapName: d.mapName || null, rule: mode === 'Supreme Arena' ? d.rule || null : null }));
    const saved = await formAction.run(
      () => api.saveDefaults(weeklyMode, slots),
      (defaults) => {
        patchReference({ defaults });
        setError(null);
      },
      `Saved as this week’s ${mode} default: new records start with these maps${mode === 'Supreme Arena' ? ' and rules' : ''}.`,
    );
    if (!saved) setStatus(null);
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
      if (editing != null) await api.updateArenaBattle(editing, filled.map(({ d, index }) => ({ ...toInput(mode, d), position: index + 1 })), codes, savedRound && editedRound ? { tournamentId: savedRound.tournamentId, round: editedRound } : undefined);
      else if (TEAMS_PER_MODE[mode] > 1) savedIds = (await api.createArenaBattle(mode, filled.map(({ d, index }) => ({ ...toInput(mode, d), position: index + 1 })), codes, initial?.round ? { tournamentId: initial.round.tournamentId, round: initial.round.round } : undefined)).fights.map((f) => f.id);
      else savedIds = [(await api.createArenaFight(toInput(mode, filled[0]!.d))).id];
      // The tiles of the teams just saved go to the Round Deployment teams that have none yet (ADR 0020).
      const left: (string | null)[] = [];
      if (initial?.round && editing == null) left.push(await stepAfterSave(() => fillTiles(filled), 'The Round Deployment could not be given the tiles'));
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
    setStatus(`${TEAMS_PER_MODE[mode] > 1 ? `Saved ${filled.length} ${filled.length === 1 ? 'team' : 'teams'} as one record` : 'Saved 1 record'}. The teams are still here: set the winner and save again.${notice ? ` ${notice}` : ''}`);
    onRecorded();
  }

  return (
    <>
    {sync.dialog}
    <RecordShell
      title={editing != null ? `Edit ${mode} record` : 'New record'}
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
        onConfirm={(side) => void confirmSides([side])}
        onUse={place}
      />
      ) : undefined}
      fields={
        <>
          <SideProfileBar {...barProps} placement={editing == null ? placement : undefined} />
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
      error={error ?? formAction.error}
      status={status}
      saveLabel={editing != null ? 'Save changes' : `Save ${drafts.length > 1 ? 'records' : 'record'}`}
      onSave={() => void save(false)}
      onSaveAnother={editing != null ? undefined : () => void save(true)}
      saving={saving.busy}
      onCancel={onCancel}
      cancelLabel={cancelLabel}
    >
      <FightEditor key={current} draft={draft} mode={mode} reference={reference} unavailable={unavailable} borrow={borrow} sideRosters={profileRoster} onChange={change} />
      {nameDialog}
      {saveDialog}
    </RecordShell>
    </>
  );
}
