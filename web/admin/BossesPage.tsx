import { useState } from 'react';
import type { BossInput } from '../../src/domain/boss.js';
import { DAMAGE_TYPES, HERO_CLASSES } from '../../src/domain/hero-admin.js';
import { api, type Boss } from '../backend.js';
import { HeroIcons } from '../HeroIcons.js';
import { Portrait } from '../Portrait.js';
import { useCatalogEditor } from '../hooks/catalogEditor.js';
import { useLoad } from '../hooks/load.js';
import { CatalogAdmin } from './CatalogAdmin.js';

interface Draft {
  name: string;
  class: string;
  damageType: string;
}

const NO_ITEMS: Boss[] = [];
const blank = (): Draft => ({ name: '', class: '', damageType: '' });
const toDraft = (b: Boss): Draft => ({ name: b.name, class: b.class ?? '', damageType: b.damageType ?? '' });

/** Admin > Units > Bosses: the bosses of Dream Hunt and Titan Reaver, with the class and damage type the forms show. Pictures are the Images tab's. */
export function BossesPage() {
  const loaded = useLoad(() => api.bosses(), []);
  const items = loaded.data ?? NO_ITEMS;
  const [search, setSearch] = useState('');
  const reloadItems = loaded.reload;
  const editor = useCatalogEditor<Boss, Draft>({ items, reloadItems, keyOf: (b) => b.name, toDraft, blank });
  const { draft, setDraft, current, dirty, busy } = editor;
  const error = loaded.error ?? editor.error;

  const needle = search.trim().toLowerCase();
  const visible = items.filter((b) => needle === '' || b.name.toLowerCase().includes(needle));
  const payload = () => ({ name: draft.name, class: (draft.class || null) as BossInput['class'], damageType: (draft.damageType || null) as BossInput['damageType'] });
  const save = () => editor.save(() => (current ? api.saveBoss(current.name, payload()) : api.createBoss(payload())));
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });

  return (
    <>
      <CatalogAdmin
        label="Bosses"
        noun="boss"
        total={items.length}
        items={visible}
        keyOf={(b) => b.name}
        selected={editor.selected}
        open={editor.open}
        search={{ value: search, onChange: setSearch }}
        row={(b) => (
          <span className="catalog-row" title={b.damageType ?? undefined}>
            <Portrait kind="boss" name={b.name} size={32} />
            <span className="catalog-name">
              <span>{b.name}</span>
              {b.damageType && <span className="muted">{b.damageType}</span>}
            </span>
            <HeroIcons row tier={null} heroClass={b.class} faction={null} />
          </span>
        )}
        title={current ? current.name : 'New boss'}
        error={error}
      >
        <div className="filters">
          <input placeholder="Name" aria-label="Name" value={draft.name} disabled={current !== null} onChange={(e) => set({ name: e.target.value })} />
          <select aria-label="Class" value={draft.class} onChange={(e) => set({ class: e.target.value })}>
            <option value="">No class</option>
            {HERO_CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Damage type" value={draft.damageType} onChange={(e) => set({ damageType: e.target.value })}>
            <option value="">No damage type</option>
            {DAMAGE_TYPES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <p className="muted">
          {current
            ? `${current.handMade ? 'Not on Yaphalla yet: the next import takes over its class and damage type. ' : current.source === 'manual' ? 'Edited by you: an import leaves it alone. ' : 'A change you save is kept: an import then leaves it alone. '}A boss keeps its name: records, weekly defaults and its picture refer to it.`
            : 'A new boss has no picture until you add one on the Images tab.'}
        </p>
        {current && (
          <>
            <h3>Used by</h3>
            <p className="muted">{current.usedBy || 'Nothing: it can be deleted.'}</p>
          </>
        )}
        <div className="actions">
          <button className="primary" onClick={() => void save()} disabled={busy || !dirty || draft.name.trim() === ''}>
            {current ? 'Save' : 'Create boss'}
          </button>
          {current && (
            <button className="danger" disabled={busy} onClick={() => void editor.remove(`Delete the boss "${current.name}"?`, () => api.deleteBoss(current.name))}>
              Delete
            </button>
          )}
        </div>
      </CatalogAdmin>
      {editor.dialog}
    </>
  );
}
