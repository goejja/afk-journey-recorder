import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TagInput } from './Tags.js';
import { TabPanel, Tabs } from './ui/Tabs.js';
import { Icon } from './ui/Icon.js';
import { Notice } from './ui/Notice.js';

interface TeamTabs {
  /** One label per team; a single-team mode passes none and shows no tabs. */
  labels: string[];
  current: number;
  onSelect: (index: number) => void;
  /** Short explanation behind an ⓘ at the end of the tabs, for example that used heroes are greyed out. */
  hint?: string;
  /** Exchanges the formation of the current team with another one's; `sides` (a battle with two sides) lets the player pick what is exchanged. */
  swap?: { sides?: { value: string; label: string }[]; onSwap: (other: number, side: string) => void };
}

/** "Swap with…": choosing a team exchanges its formation with the current team's, at once. */
function SwapControl({ teams, swap }: { teams: TeamTabs; swap: NonNullable<TeamTabs['swap']> }) {
  const [side, setSide] = useState(swap.sides?.[0]?.value ?? '');
  return (
    <span className="swap-control">
      {swap.sides && (
        <label className="field">
          Swap
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            {swap.sides.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        {swap.sides ? 'with' : 'Swap formation with'}
        <select value="" onChange={(e) => e.target.value !== '' && swap.onSwap(Number(e.target.value), side)}>
          <option value="">…</option>
          {teams.labels.map((label, i) => i !== teams.current && (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}

interface Props {
  title: string;
  /** What the record is about, which differs per mode: stage, map and mode, boss. */
  identity: ReactNode;
  /** The result control of the mode. */
  result: ReactNode;
  note: string;
  onNote: (note: string) => void;
  /** The record's tags; a record without tags (an idea) passes neither. */
  tags?: string[];
  onTags?: (tags: string[]) => void;
  /** Tags the record carries that cannot be removed here, with why. */
  lockedTags?: { tag: string; title: string }[];
  /** What only this mode has and always needs in view, on a line of its own under the common one: the profile of each side, the Round, the Union Levels, a stage's range and enemies. */
  fields?: ReactNode;
  /** A line under the result (the Round Deployment of a Super League battle), kept to one row so that it takes little height. */
  deployment?: ReactNode;
  /** The Formation ID fields of the record, beside the note and tags. */
  formationIds?: ReactNode;
  teams?: TeamTabs;
  /** Saves what this record chose (the maps, rules or bosses of its teams) as the setup new records start with. Absent where there is none. */
  onSetDefault?: () => void;
  error: string | null;
  /** Confirmation of the last save, shown while the form stays open. */
  status: string | null;
  saveLabel: string;
  onSave: () => void;
  /** Saves and keeps the form as it is, so a retry of the same formation only needs a new result. Absent when editing. */
  onSaveAnother?: () => void;
  saveDisabled?: boolean;
  /** A save is running: both Save buttons stay disabled until it ends. */
  saving?: boolean;
  onCancel: () => void;
  /** The cancel button's text; "Cancel" by default. */
  cancelLabel?: string;
  /** The editor, which fills the rest of the window. */
  children: ReactNode;
}

/**
 * The window below the top of the page that the recording screen fills: its height follows the window, so the page itself never
 * scrolls (the picker inside scrolls instead). Below `min-height` the page scrolls rather than squash the editor.
 */
function useFillWindow() {
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      if (ref.current) setHeight(Math.max(0, Math.floor(window.innerHeight - ref.current.getBoundingClientRect().top - window.scrollY - 16)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return { ref, style: height === undefined ? undefined : { height } };
}

/**
 * The same recording screen for every mode, filling the window: what the record is about with the Save and Cancel buttons on the same
 * line, then the result, note, tags and Formation IDs (the same line in every mode, all in view), then a line for what only the mode
 * has, then the team tabs, and the editor in the rest of the window (ADR 0034).
 */
export function RecordShell({ title, identity, result, note, onNote, tags, onTags, lockedTags, fields, deployment, formationIds, teams, onSetDefault, error, status, saveLabel, onSave, onSaveAnother, saveDisabled, saving, onCancel, cancelLabel, children }: Props) {
  const teamsId = useId();
  const fill = useFillWindow();
  return (
    <section className="workspace" ref={fill.ref} style={fill.style}>
      <div className="workspace-bar">
        <div className="workspace-row">
          <h2>{title}</h2>
          {identity}
          <div className="workspace-actions">
            <button className="primary" onClick={onSave} disabled={saveDisabled || saving}>
              {saving ? 'Saving…' : saveLabel}
            </button>
            {onSaveAnother && (
              <button onClick={onSaveAnother} disabled={saveDisabled || saving}>
                Save and record another
              </button>
            )}
            {onSetDefault && (
              <button onClick={onSetDefault} title="New records start with the maps, rules and bosses chosen here">
                Set as this week’s default
              </button>
            )}
            <button onClick={onCancel}>{cancelLabel ?? 'Cancel'}</button>
          </div>
        </div>
        <div className="workspace-row">
          {result}
          <label className="field record-note">
            <span className="field-caption">Note</span>
            <input value={note} placeholder="Note" onChange={(e) => onNote(e.target.value)} />
          </label>
          {tags && onTags && <TagInput value={tags} onChange={onTags} locked={lockedTags} />}
          {formationIds}
        </div>
        {fields && <div className="workspace-row">{fields}</div>}
        {deployment}
        {teams && teams.labels.length > 1 && (
          <div className="workspace-row">
            <Tabs id={teamsId} label="Teams" tabs={teams.labels.map((label, i) => ({ key: i, label }))} value={teams.current} onChange={teams.onSelect} />
            {teams.swap && <SwapControl teams={teams} swap={teams.swap} />}
            {teams.hint && (
              <span className="hint-icon" role="img" tabIndex={0} title={teams.hint} aria-label={teams.hint}>
                <Icon name="info" />
              </span>
            )}
          </div>
        )}
        {error && (
          <Notice kind="error">
            {error}
          </Notice>
        )}
        {status && <Notice kind="success">{status}</Notice>}
      </div>
      {teams && teams.labels.length > 1 ? (
        <TabPanel id={teamsId} value={teams.current} className="workspace-body">
          {children}
        </TabPanel>
      ) : (
        <div className="workspace-body">{children}</div>
      )}
    </section>
  );
}
