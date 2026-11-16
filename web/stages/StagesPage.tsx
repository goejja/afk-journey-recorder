import { useCallback, useEffect, useState } from 'react';
import { STAGE_KINDS, isApex } from '../../src/domain/stage.js';
import { api, type Artifact, type Attempt, type Enemy, type GameMap, type Hero, type Phantimal, type Rules } from '../backend.js';
import { AttemptForm } from './AttemptForm.js';
import { ChangeStageKind } from './ChangeStageKind.js';
import { TeamOverview } from '../stats/TeamOverview.js';
import { MultiSelect } from '../MultiSelect.js';
import { FormationIdBadge } from '../FormationIdField.js';
import { TagBadges, TagFilter } from '../Tags.js';
import { useConfirm } from '../ui/Dialog.js';
import { useNewest } from '../useLoad.js';

interface Reference {
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  enemies: Enemy[];
  phantimals: Phantimal[];
  rules: Rules;
}

const stageLabel = (s: Attempt['stage']) =>
  `S${s.season} · ${s.kind}${isApex(s.kind) ? ` (phase ${s.phase})` : ''} · stage ${s.number}`;

/** How many attempts the list shows; one more is asked for, to know whether there are older ones. */
const PAGE = 200;

export function StagesPage() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [older, setOlder] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Attempt | null>(null);
  const [cloning, setCloning] = useState<Attempt | null>(null);
  const [fixingKind, setFixingKind] = useState(false);
  const [kind, setKind] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<string[]>([]);
  const [tag, setTag] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const newest = useNewest();
  const reload = useCallback(async () => {
    const current = newest();
    try {
      const query = { kind, outcome, tag };
      const [loadedAttempts, maps, heroes, artifacts, enemies, phantimals, rules] = await Promise.all([
        api.attempts({ ...query, limit: String(PAGE + 1) }),
        api.maps(),
        api.heroes(),
        api.artifacts(),
        api.enemies(),
        api.phantimals(),
        api.rules(),
      ]);
      if (!current()) return;
      setAttempts(loadedAttempts.slice(0, PAGE));
      setOlder(loadedAttempts.length > PAGE);
      setReference({ maps, heroes, artifacts, enemies, phantimals, rules });
      setError(null);
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }, [kind, outcome, tag, newest]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function remove(attempt: Attempt) {
    if (
      !(await confirm({
        title: `Delete this attempt on ${stageLabel(attempt.stage)}?`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteAttempt(attempt.id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if ((adding || editing) && reference) {
    return (
      <AttemptForm
        key={editing?.id ?? (cloning ? `clone-${cloning.id}` : 'new')}
        {...reference}
        editing={editing ?? undefined}
        cloneFrom={cloning ?? undefined}
        onCancel={() => (setAdding(false), setEditing(null), setCloning(null))}
        onSaved={() => {
          setAdding(false);
          setEditing(null);
          setCloning(null);
          void reload();
        }}
        onRecorded={() => void reload()}
      />
    );
  }

  return (
    <section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="filters">
        <MultiSelect label="Kind" options={[...STAGE_KINDS]} value={kind} onChange={setKind} />
        <MultiSelect label="Outcome" options={['Win', 'Loss']} value={outcome} onChange={setOutcome} />
        <TagFilter value={tag} onChange={setTag} />
        <button className="primary" onClick={() => (setCloning(null), setAdding(true))} disabled={!reference}>
          New attempt
        </button>
        <button onClick={() => setFixingKind(!fixingKind)} aria-expanded={fixingKind} title="Fix stages recorded as the wrong kind, such as Normal instead of Phantisomal">
          Change stage kind
        </button>
      </div>
      {fixingKind && <ChangeStageKind onChanged={() => void reload()} onCancel={() => setFixingKind(false)} />}

      {attempts.length === 0 && <p className="muted">No attempts recorded yet.</p>}
      {older && <p className="muted">Showing the latest {PAGE} attempts. Filter by kind, outcome or tag to reach older ones.</p>}
      <ul className="attempts" aria-label="Attempts">
        {attempts.map((a) => (
          <li key={a.id} className="attempt">
            <div className="stage-row">
              <span className={a.outcome === 'Win' ? 'badge win' : 'badge loss'}>{a.outcome}</span>
              <strong>{stageLabel(a.stage)}</strong>
              {a.buffLevel !== null ? <span className="muted">buff {a.buffLevel}</span> : <span />}
              <span className="muted">{a.createdAt}</span>
              <span className="badge" title="The season the record was played in">S{a.season}</span>
              <TeamOverview heroes={a.formation.heroes} phantimal={a.formation.phantimal} artifact={a.formation.artifact} assist={a.formation.assist ?? null} meta="state" size={32} />
              <span className="tags-cell">
                <TagBadges tags={a.tags} />
                <FormationIdBadge code={a.formation.formationId} />
                {a.note && (
                  <span className="muted stage-note" title={a.note}>
                    {a.note}
                  </span>
                )}
              </span>
              <div className="attempt-actions">
                <button className="small" onClick={() => setEditing(a)}>
                  Edit
                </button>
                <button className="small" title="Start a new attempt from this one" onClick={() => (setCloning(a), setAdding(true))}>
                  Clone
                </button>
                <button className="danger small" onClick={() => void remove(a)}>
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {dialog}
    </section>
  );
}
