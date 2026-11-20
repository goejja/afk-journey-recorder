import { useState } from 'react';
import { api, type BossRule } from '../backend.js';
import { useAction } from '../hooks/action.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { RecordRow } from '../ui/RecordRow.js';
import { Notice } from '../ui/Notice.js';

/** The shared list of rules that boost you (fifth Dream Hunt fight, Supreme Arena maps); the list is yours to edit. */
export function BossRules({ rules, onChanged }: { rules: BossRule[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<BossRule>({ name: '', description: '' });
  const { error, busy, run } = useAction({ then: onChanged });
  const { confirmDelete, dialog } = useConfirmActions(run);

  async function remove(rule: BossRule) {
    if (await confirmDelete(`Delete the rule "${rule.name}"?`)) await run(() => api.deleteBossRule(rule.name));
  }

  return (
    <div>
      <p className="muted">
        The fifth Dream Hunt fight and Supreme Arena maps can carry a rule that boosts you, and these change over time. Add each new rule here once;
        Dream Hunt fights and Arena battles can then be tagged with it. Rules are managed here only, not from the Dream Hunt or Arena pages.
      </p>
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      <div className="filters">
        <input placeholder="Rule name" aria-label="Rule name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="What it does (optional)" aria-label="Rule description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button
          className="primary"
          disabled={busy || name.trim() === ''}
          onClick={() =>
            void run(async () => {
              await api.createBossRule({ name, description });
              setName('');
              setDescription('');
            })
          }
        >
          Add rule
        </button>
      </div>
      <ul className="attempts" aria-label="Rules">
        {rules.map((rule) => (
          <li key={rule.name} className="attempt">
            {editing === rule.name ? (
              <RecordRow
                infoClassName="record-row-edit"
                actions={
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.saveBossRule(rule.name, draft);
                          setEditing(null);
                        })
                      }
                    >
                      Save
                    </button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                }
              >
                <input className="small" aria-label="Edit rule name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input className="small" aria-label="Edit rule description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </RecordRow>
            ) : (
              <RecordRow
                actions={
                  <>
                    <button
                      onClick={() => {
                        setEditing(rule.name);
                        setDraft(rule);
                      }}
                    >
                      Edit
                    </button>
                    <button className="danger" disabled={busy} onClick={() => void remove(rule)}>
                      Delete
                    </button>
                  </>
                }
              >
                <strong>{rule.name}</strong>
                <span className="muted">{rule.description}</span>
              </RecordRow>
            )}
          </li>
        ))}
      </ul>
      {rules.length === 0 && <p className="muted">No rules yet.</p>}
      {dialog}
    </div>
  );
}
