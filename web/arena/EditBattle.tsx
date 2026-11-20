import { useState } from 'react';
import { useAction } from '../hooks/action.js';
import { api, type ArenaBattle } from '../backend.js';
import { SideProfileBar } from './BattleEditor.js';
import { useSideProfiles } from './useSideProfiles.js';
import { RecordShell } from '../RecordShell.js';
import { type PatchReference, type Reference, draftFromBattle, toInput, profileByPlayerId } from './draft.js';
import { ArenaIdentity, WinnerField, Board, FightFormationIds, UnionLevels } from './BoardParts.js';

export function EditBattle({ battle, reference, patchReference, onSaved, onCancel }: { battle: ArenaBattle; reference: Reference; patchReference: PatchReference; onSaved: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState(battle.mode);
  const [draft, setDraft] = useState(() => draftFromBattle(battle));
  const { error, busy, setError, run } = useAction();
  // As in a new battle: the profile of each side, found from its Player ID; choosing one sets the side's Player ID (the recorded states stay).
  const { profileRoster, barProps } = useSideProfiles({
    profiles: reference.profiles,
    patchReference,
    opening: { A: profileByPlayerId(reference.profiles, battle.playerIdA), B: profileByPlayerId(reference.profiles, battle.playerIdB) },
    update: setDraft,
    overwrite: false,
    run,
    onError: setError,
  });

  async function save() {
    await run(() => api.updateArenaBattle(battle.id, toInput(mode, draft)), onSaved);
  }

  return (
    <RecordShell
      title="Edit battle"
      identity={<ArenaIdentity mode={mode} onMode={setMode} draft={draft} reference={reference} onChange={setDraft} />}
      result={<WinnerField draft={draft} onChange={setDraft} />}
      note={draft.note}
      onNote={(note) => setDraft({ ...draft, note })}
      tags={draft.tags}
      onTags={(tags) => setDraft({ ...draft, tags })}
      fields={
        <>
          <SideProfileBar {...barProps} />
          <UnionLevels mode={mode} draft={draft} onChange={setDraft} />
        </>
      }
      formationIds={battle.battleId === null ? <FightFormationIds draft={draft} onChange={setDraft} /> : undefined}
      error={error}
      status={null}
      saveLabel="Save changes"
      saving={busy}
      onSave={() => void save()}
      onCancel={onCancel}
    >
      <Board draft={draft} mode={mode} reference={reference} sideRosters={profileRoster} onChange={setDraft} />
    </RecordShell>
  );
}
