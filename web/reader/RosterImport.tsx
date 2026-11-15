import { useCallback, useEffect, useReducer, useState, type Dispatch } from 'react';
import { allowedEquipmentLevels, allowedRanks, equipmentForRank } from '../../src/domain/hero-state.js';
import { api, rosterImportTileUrl, type Hero, type ImportApplySection, type ImportJob, type ImportRow, type ImportScreen, type ImportSection, type Profile, type RosterImportState, type Rules } from '../backend.js';
import { heroStateText } from '../format.js';
import { usePolling } from '../useLoad.js';
import { Portrait } from '../Portrait.js';
import { weaponOptionText } from '../WeaponStars.js';

const SCREENS: { value: ImportScreen; label: string }[] = [
  { value: 'info', label: 'Player Info (My Formations)' },
  { value: 'battle', label: 'Battle result' },
  { value: 'hall', label: 'Resonating Hall' },
  { value: 'recap', label: 'Treasure Rush: Daily Battle Recap' },
  { value: 'suggestion', label: 'Treasure Rush: Other Players\' Suggestion' },
];
const NONE = '';
const CHECK_TEXT = { hero: 'check the hero', rank: 'check the rank', stars: 'check the stars', 'not-owned': 'Not Owned: set the rank and equipment' } as const;

/** What the player changed on a row of the proposal; a row left alone is as proposed. */
interface Edit {
  ticked?: boolean;
  rank?: string;
  level?: number | null;
}

/** Whether a tile key ("2.5": section 2, tile 5) belongs to a section. */
const inSection = (tile: string, index: number) => tile.startsWith(`${index}.`);

/** What the player has decided in a review, on top of the server's proposal. Rows are keyed by tile key, the rest by section index. */
export interface ReviewState {
  sections: ImportSection[];
  chosen: Record<string, string>;
  edits: Record<string, Edit>;
  /** Whether to rename the section's profile to the name in the game (on unless switched off). */
  renames: Record<number, boolean>;
  names: Record<number, string>;
  /** Whether to remember the look of a hero the player named (on unless switched off). */
  looks: Record<string, boolean>;
}

export type ReviewAction =
  | { type: 'edit'; tile: string; change: Edit }
  | { type: 'skip'; section: ImportSection }
  | { type: 'rename'; index: number; value: boolean }
  | { type: 'name'; index: number; value: string }
  | { type: 'look'; tile: string; value: boolean }
  | { type: 'retargeted'; section: ImportSection }
  | { type: 'chosen'; tile: string; sections: ImportSection[]; chosen: Record<string, string> };

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'edit':
      return { ...state, edits: { ...state.edits, [action.tile]: { ...state.edits[action.tile], ...action.change } } };
    case 'skip':
      return { ...state, edits: { ...state.edits, ...Object.fromEntries(action.section.rows.map((row) => [row.tile, { ...state.edits[row.tile], ticked: false }])) } };
    case 'rename':
      return { ...state, renames: { ...state.renames, [action.index]: action.value } };
    case 'name':
      return { ...state, names: { ...state.names, [action.index]: action.value } };
    case 'look':
      return { ...state, looks: { ...state.looks, [action.tile]: action.value } };
    case 'retargeted': {
      // the rows and the rename are worked out again against the other profile: what was ticked, edited or decided on them no longer applies
      const { index } = action.section;
      const { [index]: _rename, ...renames } = state.renames;
      return {
        ...state,
        sections: state.sections.map((s) => (s.index === index ? action.section : s)),
        edits: Object.fromEntries(Object.entries(state.edits).filter(([tile]) => !inSection(tile, index))),
        renames,
      };
    }
    case 'chosen': {
      // the row is worked out again for the other hero: what was ticked or edited on it no longer applies
      const { [action.tile]: _edit, ...edits } = state.edits;
      return { ...state, sections: action.sections, chosen: action.chosen, edits };
    }
  }
}

/**
 * Roster import: read the heroes of one picture of the game into a profile. The picture goes to the agent, which only reads it; the
 * proposal below is only a proposal, and nothing reaches a profile until Apply. Pictures are not kept.
 */
export function RosterImport({ profile, profiles, heroes, rules, onClose, onApplied }: {
  profile: Profile | null;
  profiles: Profile[];
  heroes: Hero[];
  rules: Rules;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [state, setState] = useState<RosterImportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<ImportScreen>('info');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const job = state?.job ?? null;

  const refresh = useCallback(async () => {
    try {
      setState(await api.rosterImport());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the agent reads, ask how it is doing.
  const reading = state?.queue.some((q) => q.state === 'running' || q.state === 'queued') ?? false;
  usePolling(refresh, reading);

  async function attempt(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Every picture is given to the queue; one the app cannot find tiles in is reported and the others go on.
  const start = () => attempt(async () => {
    if (files.length === 0) return;
    setSaved(null);
    const refused: string[] = [];
    for (const file of files) {
      try {
        await api.startRosterImport(file, screen, screen === 'hall' ? profile?.id : undefined);
      } catch (e) {
        refused.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    setFiles([]);
    await refresh();
    if (refused.length > 0) setError(refused.join(' | '));
  });

  const discard = () => attempt(async () => {
    await api.dismissRosterImport();
    await refresh();
  });
  /** The picture holds nothing to change: on to the next one, keeping what the Agent read of it. */
  const next = () => attempt(async () => {
    await api.dismissRosterImport(false, true);
    await refresh();
  });

  return (
    <section className="panel" aria-label="Import from a picture">
      <div className="toolbar">
        <h3>Import heroes from a picture</h3>
        <button onClick={onClose}>Close</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}

      {state && !job && (
        <form
          className="filters"
          aria-label="Read a picture"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <fieldset className="field">
            <legend>The picture shows</legend>
            {SCREENS.map((s) => (
              <label key={s.value} className="check">
                <input type="radio" name="import-screen" checked={screen === s.value} onChange={() => setScreen(s.value)} /> {s.label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            Screenshots (one or several of the same screen)
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
          <button className="primary" type="submit" disabled={!state.canRead || files.length === 0 || busy} title={state.reason ?? undefined}>
            {files.length > 1 ? `Read ${files.length} pictures` : 'Read picture'}
          </button>
        </form>
      )}
      {state && !job && (
        <p className="muted">
          {state.canRead
            ? screen === 'hall'
              ? `The heroes will go to ${profile?.name ?? 'the default profile'}: a hero missing from the picture is left alone.`
              : 'The pictures are read one after another, about a minute each, and you review each when it is done. The player name on a picture finds the profile, or makes a new one. A hero missing from a picture is left alone.'
            : state.reason}
        </p>
      )}

      {state && state.queue.length > 1 && (
        <div aria-label="Pictures in the queue">
          <p className="muted">
            {state.queue.length} pictures: the first is shown, the others are read{state.queue.some((q) => q.state === 'queued') ? ' next' : ''} and wait for review.
          </p>
          <ul className="import-unknown">
            {state.queue.slice(1).map((q) => (
              <li key={q.id}>
                {q.label ?? `Picture ${q.id}`}: {q.state === 'queued' ? 'waiting' : q.state === 'running' ? 'being read' : q.state === 'done' ? 'ready to review' : `failed (${q.error ?? 'unknown error'})`}
              </li>
            ))}
          </ul>
          {state.queue.some((q) => q.state === 'queued') && (
            <button onClick={() => void attempt(async () => (await api.dismissRosterImport(true), refresh()))} disabled={busy}>
              Cancel the pictures not read yet
            </button>
          )}
        </div>
      )}

      {(job?.state === 'running' || job?.state === 'queued') && (
        <div className="actions">
          <p role="status">{job.state === 'queued' ? 'Waiting for the agent…' : `Reading ${job.label ?? 'the picture'}… this can take a minute.`}</p>
          <button onClick={() => void attempt(async () => (await api.cancelRosterImport(job.id), refresh()))} disabled={busy}>
            Cancel
          </button>
        </div>
      )}

      {job?.state === 'failed' && (
        <>
          <p className="error" role="alert">
            {job.label ? `${job.label}: ` : ''}
            {job.error}
          </p>
          <button onClick={() => void discard()} disabled={busy}>
            {state && state.queue.length > 1 ? 'Next picture' : 'Try another picture'}
          </button>
        </>
      )}

      {job?.state === 'done' && job.label && (
        <p className="muted">
          {job.label}
          {state && state.queue.length > 1 ? ` (1 of ${state.queue.length} pictures)` : ''}
        </p>
      )}
      {job?.state === 'done' && job.sections && (
        <Review
          key={job.id}
          job={job}
          profiles={profiles}
          heroes={heroes}
          rules={rules}
          busy={busy}
          onDiscard={() => void discard()}
          onNext={() => void next()}
          onApplied={(message) => {
            setSaved(message);
            onApplied();
            void refresh();
          }}
          onError={setError}
        />
      )}
    </section>
  );
}

function Review({ job, profiles, heroes, rules, busy, onDiscard, onNext, onApplied, onError }: {
  job: ImportJob;
  profiles: Profile[];
  heroes: Hero[];
  rules: Rules;
  busy: boolean;
  onDiscard: () => void;
  onNext: () => void;
  onApplied: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [state, dispatch] = useReducer(reviewReducer, { sections: job.sections!, chosen: job.chosen ?? {}, edits: {}, renames: {}, names: {}, looks: {} });
  const { sections, chosen, edits, renames, names, looks } = state;
  const [working, setWorking] = useState(false);

  const tierOf = (hero: string) => heroes.find((h) => h.name === hero)?.tier ?? null;
  const effective = (row: ImportRow) => {
    const edit = edits[row.tile] ?? {};
    return {
      ticked: edit.ticked ?? row.selected,
      rank: edit.rank ?? row.to.rank,
      level: edit.level !== undefined ? edit.level : row.to.equipmentLevel,
    };
  };

  async function call<T>(action: () => Promise<T>): Promise<T | undefined> {
    setWorking(true);
    onError(null);
    try {
      return await action();
    } catch (e) {
      onError((e as Error).message);
      return undefined;
    } finally {
      setWorking(false);
    }
  }

  const retarget = async (section: ImportSection, value: string) => {
    const updated = await call(() => api.rosterImportTarget(job.id, section.index, value === 'new' ? { kind: 'new' } : { kind: 'profile', id: Number(value) }));
    if (!updated) return;
    dispatch({ type: 'retargeted', section: updated });
  };

  const choose = async (tile: string, hero: string | null) => {
    const result = await call(() => api.rosterImportChoose(job.id, tile, hero));
    if (!result) return;
    dispatch({ type: 'chosen', tile, sections: result.sections, chosen: result.chosen });
  };

  const sectionChanges = (section: ImportSection) => section.rows.filter((row) => effective(row).ticked);
  const profileFor = (section: ImportSection) => section.profile?.id ?? null;
  const createName = (section: ImportSection) => (names[section.index] ?? section.create ?? '').trim();
  const needsName = (section: ImportSection) => sectionChanges(section).length > 0 && profileFor(section) === null && createName(section) === '';
  const total = sections.reduce((sum, section) => sum + sectionChanges(section).length, 0);

  /** Nothing is ticked, but the player may have named heroes the Agent could not: their looks are still worth keeping, for a profile that exists. */
  const looksOnly = (): ImportApplySection[] =>
    sections
      .filter((section) => profileFor(section) !== null)
      .map((section) => ({ profileId: profileFor(section), create: null, rename: null, changes: [], looks: Object.keys(chosen).filter((tile) => inSection(tile, section.index) && looks[tile] !== false) }))
      .filter((section) => section.looks.length > 0);

  async function done() {
    const payload = looksOnly();
    if (payload.length === 0) return onNext();
    const result = await call(() => api.applyRosterImport(job.id, payload));
    if (!result) return;
    const saved = result.applied.reduce((sum, a) => sum + a.looks, 0);
    onApplied(`Nothing to change in the heroes; remembered ${saved} look${saved === 1 ? '' : 's'}.`);
  }

  async function apply() {
    const payload: ImportApplySection[] = sections
      .filter((section) => sectionChanges(section).length > 0)
      .map((section) => {
        const ticked = sectionChanges(section);
        const keys = new Set(ticked.map((row) => row.tile));
        return {
          profileId: profileFor(section),
          create: profileFor(section) === null ? createName(section) : null,
          rename: section.profile && section.rename && renames[section.index] !== false ? section.rename : null,
          changes: ticked.map((row) => ({ hero: row.hero, rank: effective(row).rank!, equipmentLevel: effective(row).level, tile: row.tile })),
          looks: Object.keys(chosen).filter((tile) => inSection(tile, section.index) && keys.has(tile) && looks[tile] !== false),
        };
      });
    const result = await call(() => api.applyRosterImport(job.id, payload));
    if (!result) return;
    const changed = result.applied.reduce((sum, a) => sum + a.changed, 0);
    const created = result.applied.filter((a) => a.created).length;
    onApplied(`Saved ${changed} hero${changed === 1 ? '' : 'es'}${created > 0 ? ` in ${created} new profile${created === 1 ? '' : 's'} (add the Player ID in the roster)` : ''}.`);
  }

  return (
    <>
      <p className="muted">
        Review before applying: new and upgraded heroes are ticked, downgrades are not, and so is anything the agent was not sure of. Equipment read from small
        tiles is only ticked once you have looked at it. Nothing is saved until Apply.
      </p>
      {sections.map((section) => (
        <SectionReview
          key={section.index}
          job={job}
          section={section}
          profiles={profiles}
          heroes={heroes}
          rules={rules}
          state={state}
          dispatch={dispatch}
          effective={effective}
          tierOf={tierOf}
          onRetarget={(value) => void retarget(section, value)}
          onChoose={(tile, hero) => void choose(tile, hero)}
          disabled={working || busy}
        />
      ))}
      <div className="actions">
        {total === 0 ? (
          <button className="primary" onClick={() => void done()} disabled={working || busy} title="Nothing in this picture is ticked: go on to the next one">
            Nothing to change: next picture
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => void apply()}
            disabled={working || busy || sections.some(needsName)}
            title={sections.some(needsName) ? 'Name the new profile first' : undefined}
          >
            Apply {total} change{total === 1 ? '' : 's'}
          </button>
        )}
        <button onClick={onDiscard} disabled={working || busy}>
          Discard
        </button>
      </div>
    </>
  );
}

function SectionReview(props: {
  job: ImportJob;
  section: ImportSection;
  profiles: Profile[];
  heroes: Hero[];
  rules: Rules;
  state: ReviewState;
  dispatch: Dispatch<ReviewAction>;
  effective: (row: ImportRow) => { ticked: boolean; rank: string | null; level: number | null };
  tierOf: (hero: string) => string | null;
  onRetarget: (value: string) => void;
  onChoose: (tile: string, hero: string | null) => void;
  disabled: boolean;
}) {

  const { job, section, rules, state: review, dispatch } = props;
  const named = Object.entries(review.chosen).filter(([tile]) => inSection(tile, section.index));
  const edit = (tile: string, change: Edit) => dispatch({ type: 'edit', tile, change });
  const label = section.playerName ?? 'The picture';

  return (
    <div className="panel" role="group" aria-label={`Heroes of ${label}`}>
      <div className="filters">
        <h4>{label}</h4>
        <button onClick={() => dispatch({ type: 'skip', section })} disabled={props.disabled || section.rows.every((row) => !props.effective(row).ticked)} title="Untick every hero of this player, so nothing of them is saved">
          Skip this player
        </button>
        <label className="field">
          Goes to
          <select value={section.profile ? String(section.profile.id) : 'new'} onChange={(e) => props.onRetarget(e.target.value)} disabled={props.disabled}>
            {props.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="new">A new profile</option>
          </select>
        </label>
        {!section.profile && (
          <label className="field">
            New profile name
            <input value={review.names[section.index] ?? section.create ?? ''} onChange={(e) => dispatch({ type: 'name', index: section.index, value: e.target.value })} placeholder="name as shown in the game" />
          </label>
        )}
        {section.profile && section.rename && (
          <label className="check" title="The profile is spelled differently from the name shown in the game">
            <input type="checkbox" checked={review.renames[section.index] !== false} onChange={(e) => dispatch({ type: 'rename', index: section.index, value: e.target.checked })} /> Rename {section.profile.name} to {section.rename}
          </label>
        )}
      </div>
      {!section.profile && <p className="muted">A new profile has no Player ID: add it from the roster afterwards.</p>}

      {section.rows.length > 0 ? (
        <table className="board" aria-label={`Changes for ${label}`}>
          <thead>
            <tr>
              <th>Apply</th>
              <th>Tile</th>
              <th>Hero</th>
              <th>Now</th>
              <th>Rank</th>
              <th>Equipment</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => {
              const state = props.effective(row);
              const levels = allowedEquipmentLevels(state.rank, rules);
              const ranks = [...allowedRanks(props.tierOf(row.hero), rules.ranks)].reverse();
              return (
                <tr key={row.tile}>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={state.ticked} onChange={(e) => edit(row.tile, { ticked: e.target.checked })} aria-label={`Apply ${row.hero}`} />
                    </label>
                  </td>
                  <td>
                    <img className="import-tile" src={rosterImportTileUrl(job.id, row.tile)} alt={`Tile of ${row.hero}`} />
                  </td>
                  <td>
                    <span className="hero-line">
                      <Portrait kind="hero" name={row.hero} size={28} />{' '}
                      <select className="small" aria-label={`Hero of tile ${row.tile}`} value={row.hero} disabled={props.disabled} onChange={(e) => props.onChoose(row.tile, e.target.value)} title="Not this hero? Pick the right one: the picture is kept as its look, so the agent knows it next time">
                        {props.heroes.map((h) => (
                          <option key={h.name}>{h.name}</option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td>{row.direction === 'new' ? <span className="muted">new</span> : heroStateText(row.from)}</td>
                  <td>
                    <select
                      className="small"
                      aria-label={`Rank of ${row.hero}`}
                      value={state.rank ?? NONE}
                      onChange={(e) => edit(row.tile, { rank: e.target.value, level: equipmentForRank(state.level, e.target.value, rules) })}
                    >
                      {ranks.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="small"
                      aria-label={`Equipment of ${row.hero}`}
                      disabled={levels.length === 0}
                      value={state.level ?? NONE}
                      onChange={(e) => edit(row.tile, { level: e.target.value === NONE ? null : Number(e.target.value) })}
                    >
                      <option value={NONE}>None</option>
                      {[...levels].reverse().map((l) => (
                        <option key={l} value={l}>
                          {weaponOptionText(l)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.check.map((c) => (
                      <span key={c} className="badge few">
                        {CHECK_TEXT[c]}
                      </span>
                    ))}
                    {row.reader && (
                      <span className={row.reader.agrees ? 'badge' : 'badge few'} title={`The rank reader compared the top of the frame with ${row.reader.support} tile${row.reader.support === 1 ? '' : 's'} you confirmed as ${row.reader.rank}`}>
                        {row.reader.agrees ? `reader: ${row.reader.rank}` : `reader says ${row.reader.rank}`}
                      </span>
                    )}
                    {row.look && (
                      <span className={row.look.agrees ? 'badge' : 'badge few'} title="The hero reader matched the picture of this tile with a tile of this hero you confirmed before">
                        {row.look.agrees ? 'saved look' : 'saved look, not the Agent’s hero'}
                      </span>
                    )}
                    {row.direction === 'downgrade' && <span className="badge">lower than now</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">Nothing to change: the roster already has these heroes in this state.</p>
      )}

      {section.withoutRank.length > 0 && (
        <p className="muted">
          Not added, the rank could not be read: {section.withoutRank.map((w) => w.hero).join(', ')}. Add them in the roster.
        </p>
      )}

      {section.unknown.length > 0 && (
        <div aria-label="Heroes to name">
          <h4>Heroes the agent could not name</h4>
          <ul className="import-unknown">
            {section.unknown.map((u) => (
              <li key={u.tile}>
                <img className="import-tile" src={rosterImportTileUrl(job.id, u.tile)} alt="Unknown hero tile" />
                <select
                  aria-label="Which hero is this?"
                  value={NONE}
                  disabled={props.disabled}
                  onChange={(e) => e.target.value !== NONE && props.onChoose(u.tile, e.target.value)}
                >
                  <option value={NONE}>Skip (leave out)</option>
                  {u.candidates.length > 0 && (
                    <optgroup label="Probably">
                      {u.candidates.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Any hero">
                    {props.heroes.map((h) => (
                      <option key={h.name}>{h.name}</option>
                    ))}
                  </optgroup>
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {named.length > 0 && (
        <div aria-label="Heroes you named">
          <h4>Heroes you named</h4>
          <ul className="import-unknown">
            {named.map(([tile, hero]) => (
              <li key={tile}>
                <img className="import-tile" src={rosterImportTileUrl(job.id, tile)} alt={`Tile named ${hero}`} />
                <strong>{hero}</strong>
                <label className="check" title="Keep this picture of the hero so that the agent knows this skin next time">
                  <input type="checkbox" checked={review.looks[tile] !== false} onChange={(e) => dispatch({ type: 'look', tile, value: e.target.checked })} /> Remember this look
                </label>
                <button className="small" onClick={() => props.onChoose(tile, null)} disabled={props.disabled}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
