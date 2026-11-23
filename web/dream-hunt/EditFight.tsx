import { useState } from 'react';
import { useAction } from '../hooks/action.js';
import { api, type DreamHuntAttempt } from '../backend.js';
import { RecordShell } from '../RecordShell.js';
import { FormationIdField } from '../FormationIdField.js';
import { type Reference, draftFromFight, toFight } from './draft.js';
import { FightIdentity, FightResult, FightEditor } from './FightParts.js';

export function EditFight({ fight, reference, onSaved, onCancel }: { fight: DreamHuntAttempt; reference: Reference; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => draftFromFight(fight));
  const { error, busy, setError, run } = useAction();

  async function save() {
    const built = toFight(draft);
    if ('error' in built) return setError(built.error);
    await run(() => api.updateDreamHuntAttempt(fight.id, built.fight), onSaved);
  }

  return (
    <RecordShell
      title="Edit record"
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
      saving={busy}
      onSave={() => void save()}
      onCancel={onCancel}
    >
      <FightEditor draft={draft} reference={reference} onChange={setDraft} />
    </RecordShell>
  );
}
