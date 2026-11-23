import { ARENA_MODES, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { ROUNDS, type Round } from '../../src/domain/tournament.js';
import type { ArenaMode, FightImportPicture, BattleImportState, Profile } from '../backend.js';
import type { ImportGroup } from './battle-import.js';
import { coverageNotice, namesOf, nameOf, warningText, type ImportRound } from './battle-import-edits.js';
import type { useRoundChoice } from '../arena/useRoundChoice.js';
import type { TeamChange } from '../arena/useRoundReview.js';
import { Notice } from '../ui/Notice.js';

/** The form that reads pictures: the mode, for Super League the Tournament and Round, the files, and what the choices warn about. */
export function ReadForm({ state, mode, setMode, files, setFiles, reuse, chooseReuse, choice, busy, onStart }: {
  state: BattleImportState | null;
  mode: ArenaMode;
  setMode: (mode: ArenaMode) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  reuse: boolean;
  chooseReuse: (on: boolean) => void;
  choice: ReturnType<typeof useRoundChoice>;
  busy: boolean;
  onStart: () => void;
}) {
  const { tournaments, tournamentId, round, setRound, pickTournament, adding, setAdding, startAdding, addTournament, chosen, warnings } = choice;
  return (
    <>
      {state && (
        <form
          className="filters"
          aria-label="Read pictures"
          onSubmit={(e) => {
            e.preventDefault();
            onStart();
          }}
        >
          <label className="field">
            The reports are from
            <select value={mode} onChange={(e) => setMode(e.target.value as ArenaMode)}>
              {ARENA_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {mode === 'Super League' && (
            <>
              <label className="field">
                Tournament
                <select aria-label="Tournament" value={tournamentId ?? ''} onChange={(e) => pickTournament(Number(e.target.value))}>
                  {tournaments.length === 0 && <option value="">None yet</option>}
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {nameOf(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Round
                <select aria-label="Round" value={round} onChange={(e) => setRound(e.target.value as Round)}>
                  {ROUNDS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={startAdding}>
                New Tournament
              </button>
            </>
          )}
          <label className="field">
            Screenshots of the battle reports
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
          <label className="field">
            <span>
              <input type="checkbox" checked={reuse} onChange={(e) => chooseReuse(e.target.checked)} /> Reuse placements from saved battles
            </span>
          </label>
          <button className="primary" type="submit" disabled={!state.canRead || files.length === 0 || busy || (mode === 'Super League' && chosen === null)} title={state.reason ?? (mode === 'Super League' && chosen === null ? 'Choose or make a Tournament first' : undefined)}>
            {files.length > 1 ? `Read ${files.length} pictures` : 'Read picture'}
          </button>
        </form>
      )}
      {files.length > 0 && TEAMS_PER_MODE[mode] > 1 && files.length % TEAMS_PER_MODE[mode] !== 0 && (
        <Notice kind="warning">
          {files.length} pictures is not a multiple of {TEAMS_PER_MODE[mode]}: a {mode} battle has {TEAMS_PER_MODE[mode]} fights, so at least one battle will be incomplete.
        </Notice>
      )}
      {adding && (
        <form
          className="filters"
          aria-label="New Tournament"
          onSubmit={(e) => {
            e.preventDefault();
            void addTournament();
          }}
        >
          <label className="field">
            Tournament number
            <input type="number" min={1} value={adding.number} onChange={(e) => setAdding({ ...adding, number: e.target.value })} />
          </label>
          <button className="primary" type="submit" disabled={busy || !adding.number}>
            Add Tournament
          </button>
        </form>
      )}
      {warnings.map((w) => (
        <Notice kind="warning" key={w.kind}>
          {warningText(w)}
        </Notice>
      ))}
      {state && (
        <p className="muted">
          {state.canRead
            ? 'One picture per fight, about a minute each. The ones of one battle (the same two players) are grouped: open a group to fill the new-battles form. The pictures show no tiles, so the heroes are placed on free tiles for you to move. The artifact (with its level) and the phantimal are filled when the report shows them and the Agent could name them.'
            : state.reason}
        </p>
      )}
    </>
  );
}

/** The pictures being read, and the ones that failed. */
export function QueueStatus({ waiting, failed, busy, onCancel, onRetry, onDiscard }: {
  waiting: FightImportPicture[];
  failed: FightImportPicture[];
  busy: boolean;
  onCancel: () => void;
  onRetry: (id: number) => void;
  onDiscard: (ids: number[]) => void;
}) {
  return (
    <>
      {waiting.length > 0 && (
        <div aria-label="Pictures being read">
          <ul className="import-unknown">
            {waiting.map((q) => (
              <li key={q.id}>
                {q.label ?? `Picture ${q.id}`}: {q.state === 'running' ? 'being read…' : 'waiting'}
              </li>
            ))}
          </ul>
          <button onClick={() => onCancel()} disabled={busy}>
            Cancel the pictures not read yet
          </button>
        </div>
      )}

      {failed.map((q) => (
        <Notice kind="error" key={q.id}>
          {q.label ?? `Picture ${q.id}`}: {q.error}{' '}
          <button className="small" onClick={() => onRetry(q.id)} disabled={busy}>
            Read again
          </button>{' '}
          <button className="small" onClick={() => onDiscard([q.id])} disabled={busy}>
            Discard
          </button>
        </Notice>
      ))}
    </>
  );
}

/** The batch table of a Super League Round: each battle with why it can or cannot be saved as it is. */
export function RoundTable({ chosen, groups, problems, info, changes, ready, busy, onSave, onOpen, onTeamChanged }: {
  chosen: ImportRound;
  groups: ImportGroup[];
  problems: Record<string, string[]>;
  info: Record<string, string[]>;
  changes: Record<string, TeamChange[]>;
  ready: ImportGroup[];
  busy: boolean;
  onSave: () => void;
  onOpen: (group: ImportGroup) => void;
  onTeamChanged: (change: TeamChange) => void;
}) {
  return (
        <section className="panel" aria-label="Battles of the Round">
          <div className="toolbar">
            <h4>
              {chosen.label} · {chosen.round}: {ready.length} of {groups.length} {groups.length === 1 ? 'battle' : 'battles'} ready
            </h4>
            <button className="primary" onClick={() => onSave()} disabled={busy || ready.length === 0}>
              Save {ready.length} ready {ready.length === 1 ? 'battle' : 'battles'}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Battle</th>
                <th>Pictures</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const found = problems[group.key] ?? [];
                const coverage = coverageNotice(group);
                return (
                  <tr key={group.key}>
                    <td>
                      Battle {index + 1}: {group.pictures[0]!.draft.sideA.name ?? '?'} against {group.pictures[0]!.draft.sideB.name ?? '?'}
                    </td>
                    <td>{group.pictures.length}</td>
                    <td>
                      {found.length === 0 && !coverage ? (
                        <>
                          <span className="badge">Ready</span>
                          {(info[group.key] ?? []).length > 0 && (
                            <ul className="import-unknown muted">
                              {(info[group.key] ?? []).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <ul className="import-unknown">
                          {[...(coverage ? [coverage] : []), ...found].map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                      {(changes[group.key] ?? []).map((change) => (
                        <button
                          key={`${change.profileId}-${change.slot}`}
                          className="small"
                          onClick={() => onTeamChanged(change)}
                          disabled={busy}
                          title="The Round is fixed, but a real change is possible: confirming it replaces this one team for the rest of the Round"
                        >
                          {change.who}: this team changed
                        </button>
                      ))}
                    </td>
                    <td>
                      <button className="small" aria-label={`Open battle ${index + 1} in the form`} onClick={() => onOpen(group)} disabled={busy}>
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
  );
}

/** One battle of the queue: its pictures with their fight numbers, who the players are, and what to do with it. */
export function GroupCard({ group, index, groups, profiles, busy, onNumber, onMove, onCreateProfile, onAssignProfile, onOpen, onDiscard }: {
  group: ImportGroup;
  index: number;
  groups: ImportGroup[];
  profiles: Profile[];
  busy: boolean;
  onNumber: (picture: ImportGroup['pictures'][number], number: number | null) => void;
  onMove: (picture: ImportGroup['pictures'][number], group: string) => void;
  onCreateProfile: (name: string) => void;
  onAssignProfile: (name: string, id: number | null) => void;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  return (
        <div className="panel" role="group" aria-label={`Battle ${index + 1}`}>
          <h4>
            {group.pictures[0]!.draft.sideA.name ?? '?'} against {group.pictures[0]!.draft.sideB.name ?? '?'} · {group.mode}
          </h4>
          {coverageNotice(group) && (
            <Notice kind="warning" title="A battle has one picture per fight: the record can still be opened, but its teams will be missing">
              {coverageNotice(group)}
            </Notice>
          )}
          <ul className="import-unknown">
            {group.pictures.map((p) => {
              const draft = p.draft;
              return (
                <li key={p.id}>
                  <strong>{p.label ?? `Picture ${p.id}`}</strong>
                  <label className="field">
                    Fight
                    <select
                      aria-label={`Fight number of ${p.label ?? p.id}`}
                      value={draft.number ?? ''}
                      onChange={(e) => onNumber(p, e.target.value === '' ? null : Number(e.target.value))}
                    >
                      <option value="">Not given</option>
                      {Array.from({ length: TEAMS_PER_MODE[group.mode] }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    {draft.outcome ? `Side A ${draft.outcome === 'Win' ? 'won' : 'lost'}` : 'result not read'} · {draft.sideA.heroes.length} + {draft.sideB.heroes.length} heroes
                  </span>
                  {draft.sideA.heroes.concat(draft.sideB.heroes).some((h) => h.rank !== null) && <span className="muted">with the ranks the pictures were sure of</span>}
                  {draft.duplicateOf && (
                    <span className="badge few" title={`Saved on ${draft.duplicateOf.createdAt}`}>
                      looks like fight {draft.duplicateOf.id} already saved
                    </span>
                  )}
                  <label className="field">
                    Battle
                    <select
                      aria-label={`Battle of ${p.label ?? p.id}`}
                      value={group.key}
                      onChange={(e) => onMove(p, e.target.value)}
                    >
                      {groups.map((g, i) => (
                        <option key={g.key} value={g.key}>
                          Battle {i + 1}
                        </option>
                      ))}
                      <option value="new">A battle of its own</option>
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
          {(['A', 'B'] as const).flatMap((side) =>
            namesOf(group, side).map(({ name, given }) => (
              <p key={`${side}-${name}`} className="muted">
                {given ? `Side ${side} “${name}” uses profile “${given.name}”.` : `Side ${side} “${name}” has no profile.`}{' '}
                {!given && (
                  <button className="small" onClick={() => onCreateProfile(name)} disabled={busy}>
                    Create profile “{name}”
                  </button>
                )}{' '}
                <label className="field">
                  {given ? 'Another profile' : 'or use an existing one'}
                  <select aria-label={`Use an existing profile for “${name}”`} value={given?.id ?? ''} onChange={(e) => onAssignProfile(name, e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">No profile</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.playerId ? ` · ID ${p.playerId}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
            )),
          )}
          <div className="actions">
            <button className="primary" onClick={() => onOpen()} disabled={busy}>
              Open in the form
            </button>
            <button onClick={() => onDiscard()} disabled={busy}>
              Discard
            </button>
          </div>
        </div>
  );
}
