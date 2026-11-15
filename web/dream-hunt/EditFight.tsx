import { useState } from 'react';
import { api, type DreamHuntAttempt } from '../backend.js';
import { RecordShell } from '../RecordShell.js';
import { FormationIdField } from '../FormationIdField.js';
import { type Reference, draftFromFight, toFight } from './draft.js';
import { FightIdentity, FightResult, FightBoard } from './FightParts.js';

export function EditFight({ fight, reference, onSaved, onCancel }: { fight: DreamHuntAttempt; reference: Reference; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => draftFromFight(fight));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const built = toFight(draft);
    if ('error' in built) return setError(built.error);
    try {
      await api.updateDreamHuntAttempt(fight.id, built.fight);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <RecordShell
      title="Edit boss fight"
      identity={<FightIdentity draft={draft} reference={reference} showRule onChange={setDraft} />}
      result={<FightResult draft={draft} onChange={setDraft} />}
      note={draft.note}
      onNote={(note) => setDraft({ ...draft, note })}
      tags={draft.tags}
      onTags={(tags) => setDraft({ ...draft, tags })}
      formationIds={fight.battleId === null ? <FormationIdField value={draft.formation.formationId} onChange={(formationId) => setDraft({ ...draft, formation: { ...draft.formation, formationId } })} teams={[{ placed: draft.formation.placed, phantimal: draft.formation.phantimal, artifact: draft.formation.artifact }]} /> : undefined}
      error={error}
      status={null}
      saveLabel="Save changes"
      onSave={() => void save()}
      onCancel={onCancel}
    >
      <FightBoard draft={draft} reference={reference} onChange={setDraft} />
    </RecordShell>
  );
}
