import { useCallback, useState } from 'react';
import { rosterChanges, type RecordedHero, type RosterChange } from '../../src/domain/roster-sync.js';
import { isSummon } from '../../src/domain/units.js';
import { api, type FormationInput, type Hero, type Rules } from '../backend.js';
import { HeroStateFields } from '../admin/HeroStateFields.js';
import { Dialog } from '../ui/Dialog.js';
import { Portrait } from '../Portrait.js';
import { heroStateText, toggled } from '../format.js';

/** The heroes of a formation as recorded, with the rank and equipment the record carries (none where it left them to the roster). */
export function recordedHeroes(formation: Pick<FormationInput, 'heroes'> & Partial<Pick<FormationInput, 'assistHero' | 'assistRank' | 'assistEquipmentLevel'>>): RecordedHero[] {
  return [
    ...formation.heroes
      .filter((h) => !isSummon({ hero: h.hero, part: h.part }))
      .map((h) => ({ name: h.hero, rank: h.rank ?? null, equipmentLevel: h.equipmentLevel ?? null })),
    ...(formation.assistHero ? [{ name: formation.assistHero, rank: formation.assistRank ?? null, equipmentLevel: formation.assistEquipmentLevel ?? null }] : []),
  ];
}


/** The saved records the heroes were recorded in, which the player may bring to the roster's states instead of the roster to theirs. */
export interface SyncedRecords {
  attemptIds: number[];
  side: 'A' | 'B';
}

interface Pending {
  changes: RosterChange[];
  rules: Rules;
  tiers: Map<string, string | null>;
  profile?: number;
  profileName?: string;
  records?: SyncedRecords;
  done: () => void;
}

/**
 * Roster sync after a record is saved. `ask` resolves once the player has answered (true), or at once when the record
 * agrees with the roster (false); render `dialog` somewhere in the form. With `records` (the saved records the heroes
 * were recorded in), each hero can instead have its record corrected to the roster's state. A hero that is updated can
 * have its rank and equipment changed first (the reader may have misread the picture): the roster and the saved records then take the changed state.
 */
export function useRosterSync() {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback(
    (recorded: RecordedHero[], heroes: Hero[], rules: Rules, profile?: { id: number; name: string }, records?: SyncedRecords) =>
      new Promise<boolean>((resolve) => {
        const roster = new Map(heroes.filter((h) => h.owned).map((h) => [h.name, { rank: h.rank, equipmentLevel: h.equipmentLevel }]));
        const changes = rosterChanges(recorded, roster, rules.ranks);
        if (changes.length === 0) return resolve(false);
        setPending({ changes, rules, tiers: new Map(heroes.map((h) => [h.name, h.tier])), profile: profile?.id, profileName: profile?.name, records: records && records.attemptIds.length > 0 ? records : undefined, done: () => resolve(true) });
      }),
    [],
  );
  const close = () => {
    pending?.done();
    setPending(null);
  };
  return { ask, dialog: pending && <RosterSyncDialog key={pending.changes.map((c) => c.hero).join()} pending={pending} onClose={close} /> };
}

function RosterSyncDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const [ticked, setTicked] = useState(() => new Set(pending.changes.filter((c) => c.direction !== 'downgrade').map((c) => c.hero)));
  // Heroes whose saved record is brought to the roster's state, rather than the roster to the record's. A hero is in one set at most.
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  // The state each hero is updated to: the record's by default, which the player may correct.
  const [edited, setEdited] = useState(() => new Map(pending.changes.map((c) => [c.hero, { rank: c.to.rank ?? '', equipment: c.to.equipmentLevel === null ? '' : String(c.to.equipmentLevel) }])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canFix = (c: RosterChange) => pending.records !== undefined && c.direction !== 'new' && c.from.rank !== null;

  const stateOf = (c: RosterChange) => {
    const e = edited.get(c.hero)!;
    return { rank: e.rank === '' ? null : e.rank, equipmentLevel: e.equipment === '' ? null : Number(e.equipment) };
  };

  async function update() {
    setBusy(true);
    try {
      const corrections: { hero: string; rank: string | null; equipmentLevel: number | null }[] = [];
      for (const change of pending.changes) {
        if (fixed.has(change.hero)) corrections.push({ hero: change.hero, rank: change.from.rank, equipmentLevel: change.from.equipmentLevel });
        if (!ticked.has(change.hero)) continue;
        const state = stateOf(change);
        await api.saveHero(change.hero, state.rank, state.equipmentLevel, pending.profile);
        // A state the player changed is not what the record says, so the record takes it too.
        if (state.rank !== change.to.rank || state.equipmentLevel !== change.to.equipmentLevel) corrections.push({ hero: change.hero, ...state });
      }
      if (pending.records && corrections.length > 0) await api.correctRecordStates(pending.records.attemptIds, pending.records.side, corrections);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const toggle = (hero: string) => {
    setTicked((old) => toggled(old, hero));
    setFixed((old) => {
      const next = new Set(old);
      next.delete(hero);
      return next;
    });
  };
  const toggleFix = (hero: string) => {
    setFixed((old) => {
      const next = new Set(old);
      if (!next.delete(hero)) next.add(hero);
      return next;
    });
    setTicked((old) => {
      const next = new Set(old);
      next.delete(hero);
      return next;
    });
  };
  const records = pending.records?.attemptIds.length ?? 0;
  const applyLabel = fixed.size === 0 ? 'Update roster' : ticked.size === 0 ? (records > 1 ? 'Fix records' : 'Fix record') : 'Apply';

  return (
    <Dialog
      title={`Update the roster${pending.profileName ? ` of ${pending.profileName}` : ''}?`}
      onCancel={onClose}
      busy={busy}
      initialFocus="cancel"
    >
        <p className="muted">Change the rank or equipment of a ticked hero if the reader misread it: the roster and the saved record then both take your values.</p>
        <p className="muted">These heroes were recorded with another rank or equipment than the roster has. Upgrades and new heroes are ticked; a lower state is probably an older fight, so it is not.</p>
        {pending.records && <p className="muted">If the record is the one that is out of date (for example cloned from an older fight), tick “Fix record” instead: the saved record then takes the roster’s state.</p>}
        <ul className="sync-list" aria-label="Changes">
          {pending.changes.map((c) => (
            <li key={c.hero}>
              <label className="check">
                <input type="checkbox" checked={ticked.has(c.hero)} onChange={() => toggle(c.hero)} aria-label={`Update ${c.hero}`} />
                <Portrait kind="hero" name={c.hero} size={28} />
                <strong>{c.hero}</strong>
                <span>
                  {c.direction === 'new' ? `new → ${heroStateText(c.to)}` : `${heroStateText(c.from)} → ${heroStateText(c.to)}`}
                </span>
                <span className="muted">{c.direction}</span>
              </label>
              {ticked.has(c.hero) && (
                <div className="sync-edit">
                  <HeroStateFields
                    rank={edited.get(c.hero)!.rank}
                    equipment={edited.get(c.hero)!.equipment}
                    rules={pending.rules}
                    label={c.hero}
                    tier={pending.tiers.get(c.hero) ?? null}
                    onChange={(rank, equipment) => setEdited((old) => new Map(old).set(c.hero, { rank, equipment }))}
                  />
                </div>
              )}
              {canFix(c) && (
                <label className="check">
                  <input type="checkbox" checked={fixed.has(c.hero)} onChange={() => toggleFix(c.hero)} aria-label={`Fix record for ${c.hero}`} />
                  <span>Fix record → {heroStateText(c.from)}</span>
                </label>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="overlay-actions">
          <button className="primary" onClick={() => void update()} disabled={busy || ticked.size + fixed.size === 0}>
            {applyLabel}
          </button>
          <button onClick={onClose} disabled={busy}>
            Skip
          </button>
        </div>
    </Dialog>
  );
}
