import { useState } from 'react';
import { useNewest } from '../useLoad.js';
import { api, type ArenaBattle } from '../backend.js';
import { SideProfileBar } from './BattleEditor.js';
import { withRosterStates } from '../FormationEditor.js';
import { withRosterOpponent } from './OpponentEditor.js';
import { RecordShell } from '../RecordShell.js';
import { useProfileRosters } from '../reader/useProfileRosters.js';
import { type PatchReference, type Reference, draftFromBattle, toInput, profileByPlayerId, type Side } from './draft.js';
import { ArenaIdentity, WinnerField, Board, FightFormationIds, UnionLevels } from './BoardParts.js';

export function EditBattle({ battle, reference, patchReference, onSaved, onCancel }: { battle: ArenaBattle; reference: Reference; patchReference: PatchReference; onSaved: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState(battle.mode);
  const [draft, setDraft] = useState(() => draftFromBattle(battle));
  const [error, setError] = useState<string | null>(null);
  // As in a new battle: the profile of each side, found from its Player ID; choosing one sets the side's Player ID (the recorded states stay).
  const [chosenProfile, setChosenProfile] = useState<Record<Side, number | null>>(() => ({
    A: profileByPlayerId(reference.profiles, battle.playerIdA),
    B: profileByPlayerId(reference.profiles, battle.playerIdB),
  }));
  const [profileRoster, setProfileRoster] = useProfileRosters(chosenProfile);
  const newestA = useNewest();
  const newestB = useNewest();
  const newestRoster = { A: newestA, B: newestB };

  async function chooseProfile(side: Side, id: number | null) {
    const current = newestRoster[side](); // a roster that arrives after another profile was chosen for this side, or None, is dropped
    const after = reference.profiles.find((p) => p.id === id);
    setChosenProfile((old) => ({ ...old, [side]: id }));
    const key = side === 'A' ? 'playerIdA' : 'playerIdB';
    setDraft((old) => ({ ...old, [key]: after?.playerId ?? null }));
    if (id === null) return setProfileRoster((old) => ({ ...old, [side]: null }));
    try {
      const roster = await api.heroes(id);
      if (!current()) return;
      setProfileRoster((old) => ({ ...old, [side]: roster }));
      // A saved record keeps the states it recorded (ADR 0001): only heroes with none take the profile's.
      setDraft((old) => (side === 'A' ? { ...old, formation: withRosterStates(old.formation, roster, false) } : { ...old, opponent: withRosterOpponent(old.opponent, roster, false) }));
      setError(null);
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }

  async function givePlayerId(side: Side, playerId: string) {
    const profile = reference.profiles.find((p) => p.id === chosenProfile[side]);
    if (!profile) return;
    try {
      const updated = await api.updateProfile(profile.id, { playerId });
      patchReference((old) => ({ profiles: old.profiles.map((p) => (p.id === updated.id ? updated : p)) }));
      setDraft((old) => ({ ...old, [side === 'A' ? 'playerIdA' : 'playerIdB']: updated.playerId }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    try {
      await api.updateArenaBattle(battle.id, toInput(mode, draft));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
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
          <SideProfileBar
            profiles={reference.profiles}
            sideProfiles={chosenProfile}
            onSideProfile={(side, id) => void chooseProfile(side, id)}
            onSetPlayerId={(side, playerId) => void givePlayerId(side, playerId)}
          />
          <UnionLevels mode={mode} draft={draft} onChange={setDraft} />
        </>
      }
      formationIds={battle.battleId === null ? <FightFormationIds draft={draft} onChange={setDraft} /> : undefined}
      error={error}
      status={null}
      saveLabel="Save changes"
      onSave={() => void save()}
      onCancel={onCancel}
    >
      <Board draft={draft} mode={mode} reference={reference} sideRosters={profileRoster} onChange={setDraft} />
    </RecordShell>
  );
}
