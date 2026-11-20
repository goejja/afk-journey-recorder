import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { DREAM_HUNT_FIGHTS, formatDuration } from '../../src/domain/dream-hunt.js';
import { api, type DreamHuntAttempt, type WeeklySetups } from '../backend.js';
import { RecordToolbar, useGroupedList, type ListItem } from '../records/GroupedList.js';
import { FightRow } from '../records/FightRow.js';
import { GroupCard } from '../records/GroupCard.js';
import { RecordListView } from '../records/RecordListView.js';
import { useRecordList } from '../records/useRecordList.js';
import { useLinkedRecord } from '../records/linked-record.js';
import { Portrait } from '../Portrait.js';
import { timeShare } from './ThisWeek.js';
import { TeamOverview } from '../stats/TeamOverview.js';
import { MultiSelect } from '../MultiSelect.js';
import { FormationIdBadge } from '../FormationIdField.js';
import { TagBadges, TagFilter } from '../Tags.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { type Reference, type Draft } from './draft.js';
import { NewFights } from './NewFights.js';
import { EditFight } from './EditFight.js';

/** How far each cleared fight's time is from the best, 0 (the fastest) to 1 (the slowest), among the cleared fights against the same boss in the same week. */
type Shares = Map<number, number>;

/** The class and style that colour a time from green to red by its share; nothing when it has none (it is alone, or the times are equal). */
const shaded = (shares: Shares, fight: DreamHuntAttempt): { className?: string; style?: CSSProperties } => {
  const worst = shares.get(fight.id);
  return worst === undefined ? {} : { className: 'ranked', style: { '--worst': worst } as CSSProperties };
};

/** The shares of the cleared, timed fights of every week of the list, each compared with the others against its boss in its own week. */
function timeShares(weeks: { items: FightItem[] }[]): Shares {
  const shares: Shares = new Map();
  for (const week of weeks) {
    const byBoss = new Map<string, DreamHuntAttempt[]>();
    for (const item of week.items) {
      for (const f of item.kind === 'fight' ? [item.fight] : item.fights) {
        if (f.outcome === 'Win' && f.timeSeconds !== null) byBoss.set(f.boss, [...(byBoss.get(f.boss) ?? []), f]);
      }
    }
    for (const fights of byBoss.values()) {
      const times = fights.map((f) => f.timeSeconds!);
      for (const f of fights) {
        const share = timeShare(f.timeSeconds!, times);
        if (share !== null) shares.set(f.id, share);
      }
    }
  }
  return shares;
}

/** The shares of the totals of the finished days (all five fights cleared and timed) of every week, each compared with the other days of its own week; keyed by the day's battle id. */
function dayShares(weeks: { items: FightItem[] }[]): Shares {
  const shares: Shares = new Map();
  for (const week of weeks) {
    const days = week.items.flatMap((item) =>
      item.kind === 'battle' && item.fights.length === DREAM_HUNT_FIGHTS && item.fights.every((f) => f.outcome === 'Win' && f.timeSeconds !== null)
        ? [{ id: item.id, total: item.fights.reduce((sum, f) => sum + f.timeSeconds!, 0) }]
        : [],
    );
    for (const day of days) {
      const share = timeShare(day.total, days.map((d) => d.total));
      if (share !== null) shares.set(day.id, share);
    }
  }
  return shares;
}

/** The five fights of a day in order as boss faces, each framed by its result with the clear time under it. */
function DayStrip({ fights, shares }: { fights: DreamHuntAttempt[]; shares: Shares }) {
  return (
    <span className="day-strip" aria-label="Bosses of the day">
      {Array.from({ length: DREAM_HUNT_FIGHTS }, (_, i) => {
        const fight = fights.find((f) => f.battlePosition === i + 1);
        if (!fight) return <span key={i} className="day-fight blank" title={`Fight ${i + 1}: not recorded`}><span className="unit-blank" aria-hidden="true" style={{ width: 32, height: 32 }} /><span className="day-fight-time">–</span></span>;
        const cleared = fight.outcome === 'Win';
        return (
          <span key={i} className={`day-fight ${cleared ? 'win' : 'loss'}`}>
            <Portrait kind="boss" name={fight.boss} size={32} title={`Fight ${i + 1}: ${fight.boss}, ${cleared ? `cleared in ${fight.timeSeconds !== null ? formatDuration(fight.timeSeconds) : '?'}` : 'not cleared'}`} />
            <span className={`day-fight-time ${shaded(shares, fight).className ?? ''}`.trim()} style={shaded(shares, fight).style}>{cleared ? (fight.timeSeconds !== null ? formatDuration(fight.timeSeconds) : '✓') : '✗'}</span>
          </span>
        );
      })}
    </span>
  );
}

type FightItem = ListItem<DreamHuntAttempt>;

interface FightRowProps {
  fight: DreamHuntAttempt;
  onEdit: (fight: DreamHuntAttempt) => void;
  onDelete: (fight: DreamHuntAttempt) => void;
  onClone: (fights: DreamHuntAttempt[]) => void;
  shares: Shares;
  /** Inside a day's card: it shows the fight's number, and leaves the date and tags to the day. */
  inBattle?: boolean;
}

/** One boss fight of the list: the boss and result, the buttons and the team. */
function BossFightRow({ fight: f, onEdit, onDelete, onClone, shares, inBattle = false }: FightRowProps) {
  return (
    <FightRow
      infoClassName={`fight-line${inBattle ? ' in-battle' : ''}`}
      info={
        <>
          {inBattle && <strong>Fight {f.battlePosition}</strong>}
          <Portrait kind="boss" name={f.boss} size={32} />
          {inBattle ? <span className="fight-boss">{f.boss}</span> : <strong className="fight-boss">{f.boss}</strong>}
          <span className={f.outcome === 'Win' ? 'badge win' : 'badge loss'}>
            {f.outcome === 'Win' ? 'Cleared' : 'Not cleared'}
          </span>
          {f.outcome === 'Win' && f.timeSeconds !== null ? <strong {...shaded(shares, f)}>{formatDuration(f.timeSeconds)}</strong> : <span />}
          {f.bossRule ? <span className="badge">{f.bossRule}</span> : <span />}
          {!inBattle && (
            <>
              <span className="muted">{f.createdAt}</span>
              <span className="badge" title="The season the record was played in">S{f.season}</span>
              <span><FormationIdBadge code={f.formation.formationId} /></span>
              <span className="tags-cell"><TagBadges tags={f.tags} /></span>
            </>
          )}
        </>
      }
      cloneTitle="Start new fights from this one"
      onEdit={() => onEdit(f)}
      onClone={() => onClone([f])}
      onDelete={() => onDelete(f)}
      note={f.note}
    >
      <TeamOverview heroes={f.formation.heroes} artifact={f.formation.artifact} size={32} />
    </FightRow>
  );
}

const NO_FIGHTS: DreamHuntAttempt[] = [];

export function Fights({ reference, onChanged, onDefaults, onForm, prefill, onPrefillUsed }: { reference: Reference; onChanged: () => void; onDefaults: (defaults: WeeklySetups) => void; onForm: (open: boolean) => void; prefill: { index: number; draft: Draft }[] | null; onPrefillUsed: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DreamHuntAttempt | null>(null);
  const [cloning, setCloning] = useState<DreamHuntAttempt[] | null>(null);
  const [seed, setSeed] = useState<{ index: number; draft: Draft }[] | null>(null);
  const [editingDay, setEditingDay] = useState<{ id: number; fights: DreamHuntAttempt[] } | null>(null);
  const [boss, setBoss] = useState<string[]>([]);
  const [tag, setTag] = useState<string[]>([]);

  // one more than the limit is asked for: that it came back tells whether there are older fights
  const { loaded, limit, showMore, notice, setNotice, run, error } = useRecordList({
    load: (page) => api.dreamHuntAttempts({ limit: String(page + 1), boss, tag }),
    deps: [boss, tag],
    formOpen: adding || editing !== null || editingDay !== null,
  });
  const linkError = useLinkedRecord(api.dreamHuntAttempt, (fight) => (setAdding(false), setEditing(fight)), adding || editing !== null || editingDay !== null);
  const { confirmRun, dialog } = useConfirmActions(run);
  const fights = useMemo(() => (loaded.data ?? NO_FIGHTS).slice(0, limit), [loaded.data, limit]);
  const older = (loaded.data?.length ?? 0) > limit;
  const reload = loaded.reload;
  const changed = async () => {
    await reload();
    onChanged();
  };

  const remove = (fight: DreamHuntAttempt) => confirmRun({ title: `Delete this fight against ${fight.boss}?`, confirmLabel: 'Delete' }, () => api.deleteAttempt(fight.id), changed);
  const removeDay = (id: number, count: number) => confirmRun({ title: `Delete this day and its ${count} fights?`, confirmLabel: 'Delete' }, () => api.deleteBattleGroup(id, true), changed);

  // A plan the Advisor proposed: open the form with its teams filled in, each in the fight of its boss.
  useEffect(() => {
    if (!prefill) return;
    setEditing(null);
    setCloning(null);
    setSeed(prefill);
    setAdding(true);
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  useEffect(() => onForm(adding || editing !== null || editingDay !== null), [adding, editing, editingDay, onForm]);

  const list = useGroupedList(fights);
  const shares = timeShares(list.weeks);
  const totalShares = dayShares(list.weeks);
  const rowProps = {
    shares,
    onEdit: (f: DreamHuntAttempt) => (setAdding(false), setEditing(f)),
    onDelete: (f: DreamHuntAttempt) => void remove(f),
    onClone: (list: DreamHuntAttempt[]) => (setEditing(null), setCloning(list), setAdding(true)),
  };

  const renderItem = (item: FightItem) => {
    if (item.kind === 'fight') {
      return (
        <li key={`fight-${item.fight.id}`} className="attempt">
          <BossFightRow fight={item.fight} {...rowProps} />
        </li>
      );
    }
    const cleared = item.fights.filter((f) => f.outcome === 'Win');
    const totalSeconds = cleared.reduce((sum, f) => sum + (f.timeSeconds ?? 0), 0);
    const rule = item.fights.find((f) => f.bossRule)?.bossRule;
    return (
      <GroupCard
        key={`battle-${item.id}`}
        label="Dream Hunt day"
        fightsLabel="Fights of the day"
        header={
          <div className="attempt-info day-info">
            <DayStrip fights={item.fights} shares={shares} />
            <span className="badge" title="Fights cleared">{cleared.length}/{item.fights.length} cleared</span>
            {cleared.length > 0 ? (
              <span className="badge" title="The clear times of the cleared fights added up">
                total <span {...(totalShares.has(item.id) ? { className: 'ranked', style: { '--worst': totalShares.get(item.id) } as CSSProperties } : {})}>{formatDuration(totalSeconds)}</span>
              </span>
            ) : (
              <span />
            )}
            {rule ? <span className="badge">{rule}</span> : <span />}
            <span className="muted">{item.fights[0]!.createdAt}</span>
            <span className="badge" title="The season the record was played in">S{item.fights[0]!.season}</span>
            <span><FormationIdBadge code={item.fights[0]!.battleFormationId} /></span>
            <span className="tags-cell"><TagBadges tags={item.fights[0]!.tags} /></span>
          </div>
        }
        fights={item.fights}
        open={list.open.has(item.id)}
        onToggle={() => list.toggle(item.id)}
        editTitle="Edit all the fights of this day"
        onEdit={() => (setAdding(false), setEditingDay({ id: item.id, fights: item.fights }))}
        cloneTitle="Start a new day from this one"
        onClone={() => rowProps.onClone(item.fights)}
        onDelete={() => void removeDay(item.id, item.fights.length)}
        renderFight={(fight) => <BossFightRow fight={fight} inBattle {...rowProps} />}
      />
    );
  };

  if (adding) {
    return (
      <NewFights
        reference={reference}
        cloneOf={cloning}
        seed={seed}
        onCancel={() => (setAdding(false), setCloning(null), setSeed(null))}
        onDefaults={onDefaults}
        onRecorded={() => {
          void reload();
          onChanged();
        }}
        onSaved={(saved) => {
          setAdding(false);
          setCloning(null);
          setSeed(null);
          void reload();
          onChanged();
          if (saved) setNotice(`Saved. ${saved}`);
        }}
      />
    );
  }
  if (editingDay) {
    return (
      <NewFights
        key={`day-${editingDay.id}`}
        reference={reference}
        editing={editingDay}
        onCancel={() => setEditingDay(null)}
        onRecorded={() => undefined}
        onDefaults={onDefaults}
        onSaved={() => {
          setEditingDay(null);
          void reload();
          onChanged();
        }}
      />
    );
  }
  if (editing) {
    return (
      <EditFight
        key={editing.id}
        fight={editing}
        reference={reference}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
          onChanged();
        }}
      />
    );
  }

  return (
    <div>
      <RecordToolbar list={list} group="day" newLabel="New fights" onNew={() => (setEditing(null), setCloning(null), setAdding(true))}>
        <MultiSelect label="Boss" options={reference.bosses.map((b) => b.name)} value={boss} onChange={setBoss} />
        <TagFilter value={tag} onChange={setTag} />
      </RecordToolbar>
      <RecordListView
        list={list}
        loaded={loaded}
        error={error ?? linkError}
        notice={notice}
        label="Boss fights"
        battle="day"
        fight="fight"
        renderItem={renderItem}
        older={older}
        olderLabel="Show older fights"
        onOlder={showMore}
        empty={fights.length === 0}
        filtered={boss.length > 0 || tag.length > 0}
        none="No boss fights recorded yet."
        noMatch="No boss fights match these filters."
      />
      {dialog}
    </div>
  );
}
