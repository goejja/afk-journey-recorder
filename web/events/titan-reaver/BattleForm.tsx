import { useState } from 'react';
import { heroesAlreadyUsed } from '../../../src/domain/arena.js';
import { MAX_LEVEL, SEASON_PHASES, TITAN_MAP, TITAN_PHASES, formatDamage, type TitanPhase } from '../../../src/domain/titan-reaver.js';
import { api, type TitanReaverBattle } from '../../backend.js';
import { formationBorrow } from '../../arena/borrow.js';
import { FormationEditor } from '../../FormationEditor.js';
import { FormationIdField } from '../../FormationIdField.js';
import { useAction } from '../../hooks/action.js';
import { Portrait } from '../../Portrait.js';
import { RecordShell } from '../../RecordShell.js';
import { swapParts } from '../../swap.js';
import { Notice } from '../../ui/Notice.js';
import { type BattleDraft, type FightDraft, type Reference, hasSetupFor, newDraft, toBattle, totalOf, withPhases } from './draft.js';

interface Props {
  reference: Reference;
  /** Where the Battle starts: a saved one to edit, a saved one to record again, or nothing for a new one. */
  initial?: BattleDraft;
  /** The saved Battle being edited, if any. */
  editing?: TitanReaverBattle | null;
  onSaved: () => void;
  /** A Battle was saved while the form stays open, so the list can load again. */
  onRecorded: () => void;
  onCancel: () => void;
}

/** The two fights of a Titan Reaver Battle, one tab each, saved together as one record. */
export function BattleForm({ reference, initial, editing, onSaved, onRecorded, onCancel }: Props) {
  const [draft, setDraft] = useState<BattleDraft>(() => initial ?? newDraft(reference));
  const [current, setCurrent] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const saving = useAction();
  const [error, setError] = useState<string | null>(null);

  const fight = draft.fights[current]!;
  const change = (next: FightDraft) => setDraft((d) => ({ ...d, fights: d.fights.map((f, i) => (i === current ? next : f)) }));
  const setFights = (update: (old: FightDraft[]) => FightDraft[]) => setDraft((d) => ({ ...d, fights: update(d.fights) }));
  const map = reference.maps.find((m) => m.name === TITAN_MAP);
  const season = editing?.season ?? reference.season;
  const phantimals = reference.phantimals.filter((p) => p.seasons.includes(season));

  // The two teams share no hero or Artifact: what the other fight holds is greyed out, and can be taken from it once the player agrees.
  const unavailable = new Map<string, string>();
  draft.fights.forEach((f, i) => {
    if (i === current) return;
    for (const name of heroesAlreadyUsed([{ heroes: f.formation.placed.map((p) => p.hero), assist: null }])) unavailable.set(name, `Used in fight ${i + 1}`);
  });
  const borrow = formationBorrow(draft.fights, current, 'fight', setFights, true);

  const sum = totalOf(draft);
  const maxLevel = MAX_LEVEL[draft.seasonPhase]!;

  const phases = (seasonPhase: number, titanPhase: TitanPhase) => setDraft((d) => withPhases(reference, d, seasonPhase, titanPhase));

  async function saveNow(another: boolean) {
    const built = toBattle(draft);
    if ('error' in built) return setError(built.error);
    try {
      if (editing) await api.updateTitanReaverBattle(editing.id, built.battle);
      else await api.createTitanReaverBattle(built.battle);
    } catch (e) {
      setStatus(null);
      return setError((e as Error).message);
    }
    if (!another || editing) return onSaved();
    // The teams stay, so the same ones can be tried again with only the damage changed.
    setDraft((d) => ({ ...d, note: '', fights: d.fights.map((f) => ({ ...f, damage: '' })) }));
    setError(null);
    setStatus('Saved the Battle. The teams are still here: enter the new damage and save again.');
    onRecorded();
  }
  const save = (another: boolean) => saving.run(() => saveNow(another));

  const identity = (
    <>
      <label className="field">
        Season Phase
        <select value={draft.seasonPhase} onChange={(e) => phases(Number(e.target.value), draft.titanPhase)}>
          {SEASON_PHASES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Titan Reaver Phase
        <select value={draft.titanPhase} onChange={(e) => phases(draft.seasonPhase, e.target.value as TitanPhase)}>
          {TITAN_PHASES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Team level (up to {maxLevel})
        <input type="number" min={1} max={maxLevel} step={1} value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} />
      </label>
    </>
  );

  const result = (
    <>
      {fight.boss && <Portrait kind="boss" name={fight.boss} size={40} />}
      <label className="field">
        Boss
        <select value={fight.boss} onChange={(e) => change({ ...fight, boss: e.target.value })}>
          <option value="">Pick a boss</option>
          {reference.bosses.map((b) => (
            <option key={b.name}>{b.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Damage
        <input placeholder="1.2B or 1,234,567,890" value={fight.damage} onChange={(e) => change({ ...fight, damage: e.target.value })} />
      </label>
    </>
  );

  const fields = (
    <>
      <span className="badge" title="The two fights added up: what the game ranks">
        Total {sum === null ? '–' : formatDamage(sum)}
      </span>
      {!hasSetupFor(reference, draft.seasonPhase) && (
        <span className="muted">
          No Titan Reaver bosses set for Season Phase {draft.seasonPhase}: set them in <a href="#admin">Admin &gt; Weekly default</a>.
        </span>
      )}
    </>
  );

  return (
    <RecordShell
      title={editing ? 'Edit Titan Reaver record' : 'New Titan Reaver record'}
      identity={identity}
      result={result}
      fields={fields}
      note={draft.note}
      onNote={(note) => setDraft({ ...draft, note })}
      tags={draft.tags}
      onTags={(tags) => setDraft({ ...draft, tags })}
      // A code stands for both teams of the Battle: the units, tiles and artifacts of each fight placed (ADR 0007).
      formationIds={<FormationIdField label="both teams" value={draft.formationId} onChange={(formationId) => setDraft({ ...draft, formationId })} teams={draft.fights.map((f) => ({ placed: f.formation.placed, phantimal: f.formation.phantimal, artifact: f.formation.artifact }))} />}
      teams={{
        labels: draft.fights.map((f, i) => `Fight ${i + 1}${f.formation.placed.length > 0 ? ` (${f.formation.placed.length})` : ''}`),
        current,
        onSelect: setCurrent,
        hint: 'The two teams of a Battle share no hero or Artifact: those the other fight uses are greyed out, and a click moves one here. The map is always the Open map.',
        swap: { onSwap: (other) => setFights((old) => swapParts(old, current, other, ['formation'], (f) => f)) },
      }}
      error={error ?? saving.error}
      status={status}
      saveLabel={editing ? 'Save changes' : 'Save record'}
      onSave={() => void save(false)}
      onSaveAnother={editing ? undefined : () => void save(true)}
      saving={saving.busy}
      onCancel={onCancel}
    >
      {phantimals.length === 0 && <Notice kind="warning">No Phantimal is tagged for Season {season}, so no team gets one. Tag them in Admin &gt; Phantimals.</Notice>}
      {map ? (
        <FormationEditor
          key={current}
          map={map}
          heroes={reference.heroes}
          artifacts={reference.artifacts}
          phantimals={phantimals}
          autoPhantimal
          value={fight.formation}
          onChange={(formation) => change({ ...fight, formation })}
          unavailable={unavailable}
          borrow={borrow}
          rules={reference.heroRules}
          withAssist={false}
          stateTags={false}
        />
      ) : (
        <Notice kind="error">The {TITAN_MAP} map is missing: add it in Admin &gt; Maps.</Notice>
      )}
    </RecordShell>
  );
}
