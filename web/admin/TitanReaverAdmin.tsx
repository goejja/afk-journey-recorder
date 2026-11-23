import { useState } from 'react';
import { BOSSES_PER_TITAN_PHASE, TITAN_BOSS_SLOTS, TITAN_PHASES, titanSlotLabel } from '../../src/domain/titan-reaver.js';
import type { TitanReaverView } from '../../src/shared/contracts/defaults.js';
import { api, type Boss } from '../backend.js';
import { useAction } from '../hooks/action.js';
import { useLoad } from '../hooks/load.js';
import { Notice } from '../ui/Notice.js';

function TitanReaverForm({ view, bosses }: { view: TitanReaverView; bosses: Boss[] }) {
  const [saved, setSaved] = useState(view);
  const [slots, setSlots] = useState<(string | null)[]>(view.bosses);
  const { error, busy, run } = useAction({ toast: true });

  const load = (v: TitanReaverView) => {
    setSaved(v);
    setSlots(v.bosses);
  };
  const save = () => run(() => api.saveTitanReaverSetup({ bosses: slots }), load, 'Saved the Titan Reaver setup.');
  const clear = () => run(() => api.clearTitanReaverSetup(), load, 'Cleared the Titan Reaver setup.');

  return (
    <section className="panel" aria-label="Titan Reaver">
      <h3>Titan Reaver</h3>
      <p className="muted">
        The bosses of the current Titan Reaver event: {TITAN_PHASES.join(', ')} have {BOSSES_PER_TITAN_PHASE} each, and all {TITAN_BOSS_SLOTS} are different. New records start with them. The map is always the Open map.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <ul className="weekly-slots" aria-label="Titan Reaver bosses">
        {slots.map((boss, i) => (
          <li key={i} className="weekly-slot">
            <label className="field">
              <strong>{titanSlotLabel(i)}</strong>
              <select value={boss ?? ''} onChange={(e) => setSlots((old) => old.map((b, j) => (j === i ? e.target.value || null : b)))}>
                <option value="">None</option>
                {bosses.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
      <div className="workspace-actions">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        <button disabled={busy} onClick={() => void clear()}>
          Clear
        </button>
        <span className="muted">{saved.updatedAt ? `Updated ${saved.updatedAt}` : 'Not set'}</span>
      </div>
    </section>
  );
}

/** The Titan Reaver panel of Admin > Weekly default (#277). */
export function TitanReaverAdmin() {
  const loaded = useLoad(async () => {
    const [view, bosses] = await Promise.all([api.titanReaverSetup(), api.bosses()]);
    return { view, bosses };
  }, []);
  if (loaded.error) return <Notice kind="error">{loaded.error}</Notice>;
  if (!loaded.data) return null;
  return <TitanReaverForm {...loaded.data} />;
}
