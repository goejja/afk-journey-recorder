import { useEffect, useMemo, useState } from 'react';
import { Damage } from '../../ui/Damage.js';
import { MAX_LEVEL, TITAN_PHASES, belowMaxLevel } from '../../../src/domain/titan-reaver.js';
import { api, type TitanReaverBattle } from '../../backend.js';
import { FormationIdBadge } from '../../FormationIdField.js';
import { useConfirmActions } from '../../hooks/confirm.js';
import { Portrait } from '../../Portrait.js';
import { useRecordList } from '../../records/useRecordList.js';
import { TeamOverview } from '../../stats/TeamOverview.js';
import { TagBadges, TagFilter } from '../../Tags.js';
import { ListStatus } from '../../ui/ListStatus.js';
import { Notice } from '../../ui/Notice.js';
import { RecordRow } from '../../ui/RecordRow.js';
import { ShowMore } from '../../ui/ShowMore.js';
import { BattleForm } from './BattleForm.js';
import { type BattleDraft, type Reference, draftFromBattle, draftFromClone } from './draft.js';

const NONE: TitanReaverBattle[] = [];

/** One Battle of the list: its phase and level, the total, and each fight's boss, damage and team. */
function BattleCard({ battle, onEdit, onClone, onDelete }: { battle: TitanReaverBattle; onEdit: () => void; onClone: () => void; onDelete: () => void }) {
  return (
    <li className="attempt">
      <RecordRow
        actions={
          <>
            <button onClick={onEdit}>Edit</button>
            <button title="Start a new record with the same teams, bosses and level, and no damage" onClick={onClone}>
              New record from this
            </button>
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
          </>
        }
      >
        <strong title="The Titan Reaver Phase and the Season Phase of the event">
          {battle.titanPhase} · Season Phase {battle.seasonPhase}
        </strong>
        <span className={belowMaxLevel(battle.seasonPhase, battle.level) ? 'badge muted' : 'badge'} title={belowMaxLevel(battle.seasonPhase, battle.level) ? `The level of the team: below the maximum, ${MAX_LEVEL[battle.seasonPhase]}` : 'The level of the team'}>Team level {battle.level}</span>
        <span className="badge" title="The two fights added up: what the game ranks">
          Total <strong><Damage value={battle.total} /></strong>
        </span>
        <span className="muted">{battle.createdAt}</span>
        <span className="badge" title="The season the record was played in">S{battle.season}</span>
        <span><FormationIdBadge code={battle.formationId} /></span>
        <span className="tags-cell"><TagBadges tags={battle.tags} /></span>
      </RecordRow>
      <div className="titan-fights">
        {battle.fights.map((f) => (
          <div key={f.position} className="titan-fight" role="group" aria-label={`Fight ${f.position}`}>
            <span role="img" title={f.boss} aria-label={f.boss}>
              <Portrait kind="boss" name={f.boss} size={32} />
            </span>
            <strong title="Damage dealt"><Damage value={f.damage} /></strong>
            <TeamOverview heroes={f.formation.heroes} phantimal={f.formation.phantimal} artifact={f.formation.artifact} size={32} />
          </div>
        ))}
      </div>
      {battle.note && <p className="muted">{battle.note}</p>}
    </li>
  );
}

/** The Records view of Titan Reaver: the Battles newest first, with the form to record, edit and record again. */
export function Records({ reference, initial, prefill, onPrefillUsed, onChanged, onForm }: { reference: Reference; initial: { seasonPhase: number; titanPhase: string } | null; prefill?: BattleDraft | null; onPrefillUsed?: () => void; onChanged: () => void; onForm: (open: boolean) => void }) {
  // A plan from the Advisor opens the form at once, on its draft.
  const [form, setForm] = useState<{ initial?: BattleDraft; editing?: TitanReaverBattle } | null>(() => (prefill ? { initial: prefill } : null));
  const [seasonPhase, setSeasonPhase] = useState(initial ? String(initial.seasonPhase) : '');
  const [titanPhase, setTitanPhase] = useState(initial?.titanPhase ?? '');
  const [tag, setTag] = useState<string[]>([]);

  // one more than the limit is asked for: that it came back tells whether there are older records
  const { loaded, limit, showMore, notice, run, error } = useRecordList({
    load: (page) => api.titanReaverBattles({ limit: String(page + 1), seasonPhase, titanPhase, tag }),
    deps: [seasonPhase, titanPhase, tag],
    formOpen: form !== null,
  });
  const { confirmRun, dialog } = useConfirmActions(run);
  const battles = useMemo(() => (loaded.data ?? NONE).slice(0, limit), [loaded.data, limit]);
  const older = (loaded.data?.length ?? 0) > limit;
  const changed = async () => {
    await loaded.reload();
    onChanged();
  };
  useEffect(() => onForm(form !== null), [form, onForm]);
  useEffect(() => {
    if (prefill) onPrefillUsed?.();
  }, [prefill, onPrefillUsed]);

  if (form) {
    return (
      <BattleForm
        key={form.editing?.id ?? 'new'}
        reference={reference}
        initial={form.initial}
        editing={form.editing}
        onCancel={() => setForm(null)}
        onRecorded={() => void changed()}
        onSaved={() => {
          setForm(null);
          void changed();
        }}
      />
    );
  }

  const remove = (battle: TitanReaverBattle) =>
    confirmRun({ title: `Delete this ${battle.titanPhase} record and its 2 fights?`, confirmLabel: 'Delete' }, () => api.deleteTitanReaverBattle(battle.id), changed);

  return (
    <div>
      <div className="filters">
        <label className="field">
          Season Phase
          <select value={seasonPhase} onChange={(e) => setSeasonPhase(e.target.value)}>
            <option value="">All</option>
            {[1, 2, 3].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Titan Reaver Phase
          <select value={titanPhase} onChange={(e) => setTitanPhase(e.target.value)}>
            <option value="">All</option>
            {TITAN_PHASES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <TagFilter value={tag} onChange={setTag} />
        <button className="primary" onClick={() => setForm({})}>
          New record
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="error">{notice}</Notice>}
      <div className={loaded.loading && loaded.data ? 'refreshing' : undefined} aria-busy={loaded.loading}>
        <ul className="attempts" aria-label="Titan Reaver records">
          {battles.map((b) => (
            <BattleCard
              key={b.id}
              battle={b}
              onEdit={() => setForm({ initial: draftFromBattle(b), editing: b })}
              onClone={() => setForm({ initial: draftFromClone(b) })}
              onDelete={() => void remove(b)}
            />
          ))}
        </ul>
      </div>
      {older && <ShowMore label="Show older records" onMore={showMore} />}
      <ListStatus loaded={loaded.data !== undefined} failed={loaded.error !== null} empty={battles.length === 0} filtered={seasonPhase !== '' || titanPhase !== '' || tag.length > 0} none="No Titan Reaver records yet." noMatch="No Titan Reaver records match these filters." />
      {dialog}
    </div>
  );
}
