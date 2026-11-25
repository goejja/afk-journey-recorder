import { useState } from 'react';
import { useAction } from '../hooks/action.js';
import { api, type ArenaFight } from '../backend.js';
import { SideProfileBar } from './FightTeamsEditor.js';
import { useSideProfiles } from './useSideProfiles.js';
import { RecordShell } from '../RecordShell.js';
import { type PatchReference, type Reference, type Side, draftFromFight, swappedOnMap, toInput, profileByPlayerId } from './draft.js';
import { ArenaIdentity, WinnerField, FightEditor, FightFormationIds, UnionLevels } from './FightParts.js';

export function EditFight({ battle, reference, patchReference, onSaved, onCancel }: { battle: ArenaFight; reference: Reference; patchReference: PatchReference; onSaved: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState(battle.mode);
  const [side, setSide] = useState<Side>('A'); // the side the editor places, which the known layouts are offered for
  const [draft, setDraft] = useState(() => draftFromFight(battle));
  const { error, busy, setError, run } = useAction();
  // As in a new battle: the profile of each side, found from its Player ID; choosing one sets the side's Player ID (the recorded states stay).
  const { profileRoster, barProps } = useSideProfiles({
    profiles: reference.profiles,
    patchReference,
    opening: { A: profileByPlayerId(reference.profiles, battle.playerIdA), B: profileByPlayerId(reference.profiles, battle.playerIdB) },
    update: setDraft,
    overwrite: false,
    swapDraft: (d) => swappedOnMap(reference, d),
    run,
    onError: setError,
  });

  async function save() {
    await run(() => api.updateArenaFight(battle.id, toInput(mode, draft)), onSaved);
  }

  return (
    <RecordShell
      title="Edit record"
      identity={<ArenaIdentity mode={mode} onMode={setMode} draft={draft} reference={reference} onChange={setDraft} side={side} excludeAttempts={[battle.id]} />}
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
      <FightEditor draft={draft} mode={mode} reference={reference} sideRosters={profileRoster} side={side} onSide={setSide} onChange={setDraft} />
    </RecordShell>
  );
}
