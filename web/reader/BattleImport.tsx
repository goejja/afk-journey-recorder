import { useState } from 'react';
import { api, type ArenaMode, type Profile } from '../backend.js';
import { useAttempt, useBattleQueue } from './useBattleQueue.js';
import { useRoundChoice } from '../arena/useRoundChoice.js';
import { GroupCard, QueueStatus, ReadForm, RoundTable } from './BattleImportParts.js';
import { useOpenNext, useRoundReview, type RoundReview, type TeamChange } from '../arena/useRoundReview.js';
import { fetchCrops, fetchOriginal, type ImportGroup } from './battle-import.js';
import { lastChoices, type BatchOptions, type ImportRound, type ImportStart } from './battle-import-edits.js';
import type { RoundTeam, RoundDeployment } from '../../src/domain/round-deployment.js';
import { RoundDeploymentsView, type DeploymentRow, type TeamEditorReference } from '../arena/RoundDeploymentsView.js';

export type { BatchOptions, ImportRound, ImportStart };

/**
 * Battle import: read screenshots of PvP battle reports and start the records from them. The pictures are read one after another by the
 * agent; the ones of one battle are grouped by the two players. Opening a group fills the new-battles form, where the positions are
 * checked and the record saved. Nothing is saved here.
 */
export function BattleImport({ start: restore, onClose, onOpen, onReview, onSaveBatch, onProfileCreated, onRepair, onTeamChange, teamEditing }: { /** Where to stand when the wizard comes back from the form. */ start?: ImportStart; onClose: () => void; /** Why each group (by key) cannot be saved without a look, for the batch table of a Super League Round. */ onReview?: (groups: ImportGroup[], options: BatchOptions) => Promise<RoundReview>; /** Saves the groups as battles of the Round; returns the keys saved and what went wrong. */ onSaveBatch?: (groups: ImportGroup[], options: BatchOptions) => Promise<{ saved: string[]; errors: string[] }>; /** Opens a group in the form. The pictures stay in the queue until the form saves: `dismiss` lists them. */ onOpen: (group: ImportGroup, options: { reuse: boolean; groups: ImportGroup[]; round: ImportRound | null; dismiss: number[] }) => void | Promise<void>; /** Called with a profile made here, so the form's list of profiles has it. */ onProfileCreated?: (profile: Profile) => void; /** Moves or deletes a Deployment saved under the wrong Profile (ADR 0021). */ onRepair?: (action: { kind: 'delete'; profileId: number } | { kind: 'move'; profileId: number; to: number }, round: ImportRound) => Promise<unknown>; /** Confirms a Team change the player says is real (ADR 0021). */ onTeamChange?: (change: { profileId: number; slot: number; team: RoundTeam }, round: ImportRound) => Promise<unknown>; /** The form's own editor for a team of a Round Deployment, with where to save it (ADR 0021). */ teamEditing?: TeamEditorReference & { onSave: (round: ImportRound, profileId: number, teams: RoundDeployment) => Promise<unknown> } }) {
  const { busy, error, setError, attempt } = useAttempt();
  const { state, refresh, reading, groups, failed, waiting, profiles, giveNumber, moveTo, start: readPictures, createProfile, assignProfile } = useBattleQueue({ attempt, setError, onProfileCreated });
  const [mode, setMode] = useState<ArenaMode>(() => restore?.mode ?? lastChoices().mode ?? 'Guild Duel');
  const [files, setFiles] = useState<File[]>([]);
  /** Whether a known placement is reused and a misread hero corrected (ADR 0013); remembered in the browser. */
  const [reuse, setReuse] = useState(() => {
    try {
      return localStorage.getItem('battle-import-reuse') !== 'off';
    } catch {
      return true;
    }
  });
  const chooseReuse = (on: boolean) => {
    setReuse(on);
    try {
      localStorage.setItem('battle-import-reuse', on ? 'on' : 'off');
    } catch {
      // the choice then lasts until the page is closed
    }
  };
  const choice = useRoundChoice(mode, restore, attempt);
  const { chosen } = choice;
  const superLeague = mode === 'Super League';
  const start = () => readPictures(files, mode, () => setFiles([]));
  const dismiss = (ids?: number[]) =>
    attempt(async () => {
      await api.dismissBattleImport(ids);
      await refresh();
    });
  const retry = (id: number) =>
    attempt(async () => {
      await api.retryBattleImport(id);
      await refresh();
    });
  const { problems, info, deployments, changes, ready, recheck } = useRoundReview({ groups, chosen, reuse, onReview });

  /** A repair of the Round Deployments (move or delete): the table is worked out again afterwards (ADR 0021). */
  const repair = (action: { kind: 'delete'; profileId: number } | { kind: 'move'; profileId: number; to: number }, round: ImportRound) =>
    attempt(async () => {
      await onRepair?.(action, round);
      recheck();
    });
  const teamChanged = (change: TeamChange, round: ImportRound) =>
    attempt(async () => {
      await onTeamChange?.(change, round);
      recheck();
    });
  // Every Player known in the Round: those with a Deployment (confirmed or from a saved Battle) and those still only in the queue.
  const deploymentRows: DeploymentRow[] = (() => {
    const rows: DeploymentRow[] = deployments.map((entry) => ({ ...entry, confirmed: entry.confirmed ?? false }));
    const known = new Set(rows.map((row) => row.profileId));
    for (const group of groups)
      for (const picture of group.pictures)
        for (const side of [picture.draft.sideA, picture.draft.sideB])
          if (side.profile && !known.has(side.profile.id)) {
            known.add(side.profile.id);
            rows.push({ profileId: side.profile.id, name: side.profile.name, playerId: side.profile.playerId, teams: [null, null, null, null, null], confirmed: false });
          }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  })();
  const [notice, setNotice] = useState<string | null>(null);

  const saveReady = () =>
    attempt(async () => {
      if (!chosen || !onSaveBatch || ready.length === 0) return;
      // the crops and pictures are fetched first: the server forgets a picture once it is dismissed
      const withPictures = await Promise.all(ready.map(async (g) => ({ ...g, pictures: await Promise.all(g.pictures.map(async (p) => ({ ...p, cropData: await fetchCrops(p), original: await fetchOriginal(p) }))) })));
      const { saved, errors } = await onSaveBatch(withPictures, { reuse, round: chosen, groups });
      const ids = withPictures.filter((g) => saved.includes(g.key)).flatMap((g) => g.pictures.map((p) => p.id));
      if (ids.length > 0) await api.dismissBattleImport(ids);
      await refresh();
      setNotice(`Saved ${saved.length} ${saved.length === 1 ? 'battle' : 'battles'} in ${chosen.label}, ${chosen.round}.`);
      if (errors.length > 0) setError(errors.join(' | '));
    });

  const open = (group: ImportGroup) =>
    attempt(async () => {
      // the crops are fetched first: the server forgets a picture once it is dismissed, which the form does when it saves
      const pictures = await Promise.all(group.pictures.map(async (p) => ({ ...p, cropData: await fetchCrops(p), original: await fetchOriginal(p) })));
      await onOpen({ ...group, pictures }, { reuse, groups, round: group.mode === 'Super League' ? chosen : null, dismiss: group.pictures.map((p) => p.id) });
    });

  useOpenNext({ initial: restore?.openNext ?? false, queueLoaded: state !== null, busy, reading, groups, superLeague, problems, open: (group) => void open(group) });

  return (
    <section className="panel" aria-label="Import battles from pictures">
      <div className="toolbar">
        <h3>Import battles from pictures</h3>
        <button onClick={onClose}>Close</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ReadForm state={state} mode={mode} setMode={setMode} files={files} setFiles={setFiles} reuse={reuse} chooseReuse={chooseReuse} choice={choice} busy={busy} onStart={() => void start()} />
      <QueueStatus waiting={waiting} failed={failed} busy={busy} onCancel={() => void dismiss()} onRetry={(id) => void retry(id)} onDiscard={(ids) => void dismiss(ids)} />
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      {chosen && (
        <RoundDeploymentsView
          tournament={chosen.label}
          round={chosen.round}
          rows={deploymentRows}
          profiles={profiles}
          busy={busy}
          teamReference={teamEditing}
          onSaveTeam={
            teamEditing
              ? async (profileId, teams) => {
                  await attempt(async () => {
                    await teamEditing.onSave(chosen, profileId, teams);
                    recheck();
                  });
                }
              : undefined
          }
          onDelete={(profileId) => void repair({ kind: 'delete', profileId }, chosen)}
          onMove={(profileId, to) => void repair({ kind: 'move', profileId, to }, chosen)}
        />
      )}
      {chosen && problems && groups.length > 0 && (
        <RoundTable chosen={chosen} groups={groups} problems={problems} info={info} changes={changes} ready={ready} busy={busy} onSave={() => void saveReady()} onOpen={(group) => void open(group)} onTeamChanged={(change) => void teamChanged(change, chosen)} />
      )}

      {groups.map((group, index) => (
        <GroupCard
          key={group.key}
          group={group}
          index={index}
          groups={groups}
          profiles={profiles}
          busy={busy}
          onNumber={giveNumber}
          onMove={moveTo}
          onCreateProfile={(name) => void createProfile(name)}
          onAssignProfile={assignProfile}
          onOpen={() => void open(group)}
          onDiscard={() => void dismiss(group.pictures.map((p) => p.id))}
        />
      ))}
    </section>
  );
}
