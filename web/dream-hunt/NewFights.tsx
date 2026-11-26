import { useState } from 'react';
import { useAction } from '../hooks/action.js';
import { stepAfterSave } from '../hooks/saved.js';
import { heroesAlreadyUsed } from '../../src/domain/arena.js';
import { DREAM_HUNT_FIGHTS } from '../../src/domain/dream-hunt.js';
import { api, type DreamHuntAttempt } from '../backend.js';
import { formationBorrow } from '../arena/borrow.js';
import { swapParts } from '../swap.js';
import { RecordShell } from '../RecordShell.js';
import { recordedHeroes, useRosterSync } from '../reader/RosterSync.js';
import { FormationIdField } from '../FormationIdField.js';
import { type Reference, type Draft, onMap, sharedTags, newDraft, draftFromFight, toFight } from './draft.js';
import { FightIdentity, FightResult, FightEditor } from './FightParts.js';

/** The five fights of a Dream Hunt day, one tab each, saved together as one battle of separate records. */
interface NewFightsProps {
  reference: Reference;
  /** Saved fights to start a new day from: the same boss, map, formation and tags, but not the result, time or note. */
  cloneOf?: DreamHuntAttempt[] | null;
  /** A saved day to edit as a whole, with every fight as it is now. */
  editing?: { id: number; fights: DreamHuntAttempt[] } | null;
  /** Fights to start the day with, each at its place: the teams of a plan of the Advisor or the Simulator. */
  seed?: { index: number; draft: Draft }[] | null;
  onSaved: (notice?: string | null) => void;
  onRecorded: () => void;
  onCancel: () => void;
}

/** The fights of a day, one tab each: a new day (empty, or cloned from a saved one), or a saved day being edited. */
export function NewFights({ reference, cloneOf, editing, seed, onSaved, onRecorded, onCancel }: NewFightsProps) {
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const source = editing?.fights ?? cloneOf;
    const tags = sharedTags(seed?.[0]?.draft ?? (source?.[0] ? draftFromFight(source[0]) : undefined));
    return Array.from({ length: DREAM_HUNT_FIGHTS }, (_, i) => {
      const planned = seed?.find((s) => s.index === i);
      if (planned) return { ...planned.draft, ...tags };
      const saved = source?.find((f) => (f.battlePosition ?? 1) - 1 === i);
      if (!saved) return { ...newDraft(reference, i), ...tags };
      return editing ? { ...draftFromFight(saved), ...tags } : { ...draftFromFight(saved), ...tags, outcome: 'Win' as const, time: '', note: '' };
    });
  });
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The Formation ID stands for the fights of the whole day (ADR 0007), not for one of them.
  const [formationId, setFormationId] = useState(() => (editing?.fights ?? cloneOf)?.[0]?.battleFormationId ?? '');
  const sync = useRosterSync();

  const draft = drafts[current]!;
  // An update function, so taking a unit from another fight and placing it here both apply.
  const change = (d: Draft) => setDrafts((old) => old.map((x, i) => (i === current ? d : x)));
  // The tags describe the whole day, so every fight of it carries the same ones.
  const shareTags = (tags: string[]) => setDrafts((old) => old.map((d) => ({ ...d, tags })));

  const unavailable = new Map<string, string>();
  drafts.forEach((d, i) => {
    if (i === current) return;
    for (const name of heroesAlreadyUsed([{ heroes: d.formation.placed.map((p) => p.hero), assist: d.formation.assist || null }])) unavailable.set(name, `Used in fight ${i + 1}`);
  });

  const borrow = formationBorrow(drafts, current, 'fight', setDrafts, true);

  const saving = useAction();
  const save = (another: boolean) => saving.run(() => saveNow(another));

  async function saveNow(another: boolean) {
    const filled = drafts.map((d, index) => ({ d, index })).filter(({ d }) => d.formation.placed.length > 0);
    if (filled.length === 0) return setError('Place at least one hero in a fight');
    const fights = [];
    for (const { d, index } of filled) {
      const built = toFight(d);
      if ('error' in built) return setError(`Fight ${index + 1}: ${built.error}`);
      fights.push({ index, fight: built.fight });
    }
    let notice: string | null = null;
    try {
      const day = fights.map(({ index, fight }) => ({ ...fight, position: index + 1 }));
      const saved = await (editing ? api.updateDreamHuntBattle(editing.id, day, { formationId }) : api.createDreamHuntBattle(day, { formationId }));
      // New fights may carry upgrades the roster has not heard of yet; editing a saved day does not ask.
      if (!editing) notice = await stepAfterSave(() => sync.ask(day.flatMap((fight) => recordedHeroes(fight.formation)), reference.heroes, reference.heroRules, undefined, { attemptIds: saved.fights.map((f) => f.id), side: 'A' }));
    } catch (e) {
      setStatus(null);
      return setError((e as Error).message);
    }
    if (!another || editing) return onSaved(notice);
    // The formations stay, so the same teams can be tried again with only the time changed.
    setDrafts((old) => old.map((d) => ({ ...d, outcome: 'Win' as const, time: '' })));
    setError(null);
    setStatus(`Saved as one record. The teams are still here: enter the new time and save again.${notice ? ` ${notice}` : ''}`);
    onRecorded();
  }

  return (
    <>
    {sync.dialog}
    <RecordShell
      title={editing ? 'Edit Dream Hunt record' : 'New record'}
      identity={<FightIdentity draft={draft} reference={reference} showRule={current === DREAM_HUNT_FIGHTS - 1} onChange={change} />}
      result={<FightResult draft={draft} onChange={change} />}
      note={draft.note}
      onNote={(note) => change({ ...draft, note })}
      tags={draft.tags}
      onTags={shareTags}
      // A code covers the fights of the whole day: the units, tiles and artifacts of every fight placed (ADR 0007).
      formationIds={<FormationIdField label="the day" value={formationId} onChange={setFormationId} teams={drafts.map((d) => ({ placed: d.formation.placed, phantimal: d.formation.phantimal, artifact: d.formation.artifact }))} />}
      teams={{
        labels: drafts.map((d, i) => `Fight ${i + 1}${d.formation.placed.length > 0 ? ` (${d.formation.placed.length})` : ''}`),
        current,
        onSelect: setCurrent,
        hint: `Heroes and artifacts used in another fight are greyed out: click one to move it here. Each fight with heroes is saved as its own record; the fifth fight can carry a rule.${editing ? ' A fight left without heroes is removed from the day.' : ''}`,
        // The formations trade places; the boss, map, rule and result stay with the fight.
        swap: { onSwap: (other) => setDrafts((old) => swapParts(old, current, other, ['formation'], (d) => ({ ...d, formation: onMap(reference, d.mapName, d) }))) },
      }}
      error={error}
      status={status}
      saveLabel={editing ? 'Save changes' : 'Save record'}
      onSave={() => void save(false)}
      onSaveAnother={editing ? undefined : () => void save(true)}
      saving={saving.busy}
      onCancel={onCancel}
    >
      <FightEditor key={current} draft={draft} reference={reference} unavailable={unavailable} borrow={borrow} onChange={change} />
    </RecordShell>
    </>
  );
}
