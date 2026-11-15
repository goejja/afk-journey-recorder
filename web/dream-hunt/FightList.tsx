import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { DREAM_HUNT_FIGHTS, formatDuration } from '../../src/domain/dream-hunt.js';
import { api, type DreamHuntAttempt, type WeeklySetups } from '../backend.js';
import { RecordList, RecordToolbar, useGroupedList, type ListItem } from '../GroupedList.js';
import { Portrait } from '../Portrait.js';
import { timeShare } from './ThisWeek.js';
import { TeamOverview } from '../stats/TeamOverview.js';
import { MultiSelect } from '../MultiSelect.js';
import { FormationIdBadge } from '../FormationIdField.js';
import { TagBadges, TagFilter } from '../Tags.js';
import { useConfirm } from '../ui/Dialog.js';
import { useNewest } from '../useLoad.js';
import { type Reference, type Draft } from './draft.js';
import { NewFights } from './NewFights.js';
import { EditFight } from './EditFight.js';

/** How many fights the list loads at first and each time "Show older" is pressed. */
const PAGE = 100;

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
function FightRow({ fight: f, onEdit, onDelete, onClone, shares, inBattle = false }: FightRowProps) {
  return (
    <>
      <div className="attempt-top">
        <div className="attempt-info">
          {inBattle && <strong>Fight {f.battlePosition}</strong>}
          <Portrait kind="boss" name={f.boss} size={32} />
          {inBattle ? <span>{f.boss}</span> : <strong>{f.boss}</strong>}
          <span className={f.outcome === 'Win' ? 'badge win' : 'badge loss'}>
            {f.outcome === 'Win' ? 'Cleared' : 'Not cleared'}
          </span>
          {f.outcome === 'Win' && f.timeSeconds !== null && <strong {...shaded(shares, f)}>{formatDuration(f.timeSeconds)}</strong>}
          {f.bossRule && <span className="badge">{f.bossRule}</span>}
          {!inBattle && (
            <>
              <span className="muted">{f.createdAt}</span>
              <TagBadges tags={f.tags} />
              <FormationIdBadge code={f.formation.formationId} />
            </>
          )}
        </div>
        <div className="attempt-actions">
          <button onClick={() => onEdit(f)}>Edit</button>
          <button title="Start new fights from this one" onClick={() => onClone([f])}>Clone</button>
          <button className="danger" onClick={() => onDelete(f)}>
            Delete
          </button>
        </div>
      </div>
      <TeamOverview heroes={f.formation.heroes} artifact={f.formation.artifact} size={32} />
      {f.note && <p className="muted">{f.note}</p>}
    </>
  );
}

export function Fights({ reference, onChanged, onDefaults, onForm, prefill, onPrefillUsed }: { reference: Reference; onChanged: () => void; onDefaults: (defaults: WeeklySetups) => void; onForm: (open: boolean) => void; prefill: { index: number; draft: Draft }[] | null; onPrefillUsed: () => void }) {
  const [fights, setFights] = useState<DreamHuntAttempt[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DreamHuntAttempt | null>(null);
  const [cloning, setCloning] = useState<DreamHuntAttempt[] | null>(null);
  const [seed, setSeed] = useState<{ index: number; draft: Draft }[] | null>(null);
  const [editingDay, setEditingDay] = useState<{ id: number; fights: DreamHuntAttempt[] } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  /** Whether there are fights older than the ones listed: one more than the limit came back. */
  const [older, setOlder] = useState(false);
  const [boss, setBoss] = useState<string[]>([]);
  const [tag, setTag] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const newest = useNewest();
  const reload = useCallback(async () => {
    const current = newest();
    try {
      const loaded = await api.dreamHuntAttempts({ limit: String(limit + 1), boss, tag });
      if (!current()) return;
      setFights(loaded.slice(0, limit));
      setOlder(loaded.length > limit);
      setError(null);
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }, [boss, tag, limit, newest]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function remove(fight: DreamHuntAttempt) {
    if (
      !(await confirm({
        title: `Delete this fight against ${fight.boss}?`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteAttempt(fight.id);
      await reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function ungroup(id: number) {
    if (
      !(await confirm({
        title: 'Ungroup this day?',
        message: 'Its fights stay as fights on their own.',
        confirmLabel: 'Ungroup',
      }))
    )
      return;
    try {
      await api.deleteBattleGroup(id, false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeDay(id: number, count: number) {
    if (
      !(await confirm({
        title: `Delete this day and its ${count} fights?`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteBattleGroup(id, true);
      await reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
          <FightRow fight={item.fight} {...rowProps} />
        </li>
      );
    }
    const cleared = item.fights.filter((f) => f.outcome === 'Win');
    const totalSeconds = cleared.reduce((sum, f) => sum + (f.timeSeconds ?? 0), 0);
    const rule = item.fights.find((f) => f.bossRule)?.bossRule;
    return (
      <li key={`battle-${item.id}`} className="attempt" aria-label="Dream Hunt day">
        <div className="attempt-top">
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
            <span><FormationIdBadge code={item.fights[0]!.battleFormationId} /></span>
            <span className="tags-cell"><TagBadges tags={item.fights[0]!.tags} /></span>
          </div>
          <div className="attempt-actions">
            <button aria-expanded={list.open.has(item.id)} onClick={() => list.toggle(item.id)}>
              {list.open.has(item.id) ? 'Hide fights' : 'Show fights'}
            </button>
            <button title="Edit all the fights of this day" onClick={() => (setAdding(false), setEditingDay({ id: item.id, fights: item.fights }))}>Edit</button>
            <button title="Start a new day from this one" onClick={() => rowProps.onClone(item.fights)}>Clone</button>
            <button onClick={() => void ungroup(item.id)}>Ungroup</button>
            <button className="danger" onClick={() => void removeDay(item.id, item.fights.length)}>
              Delete
            </button>
          </div>
        </div>
        {list.open.has(item.id) && (
          <ul className="battle-fights" aria-label="Fights of the day">
            {item.fights.map((fight) => (
              <li key={fight.id} className="battle-fight">
                <FightRow fight={fight} inBattle {...rowProps} />
              </li>
            ))}
          </ul>
        )}
      </li>
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
        onSaved={() => {
          setAdding(false);
          setCloning(null);
          setSeed(null);
          void reload();
          onChanged();
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <RecordList list={list} label="Boss fights" battle="day" fight="fight" renderItem={renderItem} />
      {older && <button onClick={() => setLimit((old) => old + PAGE)}>Show older fights</button>}
      {fights.length === 0 && <p className="muted">No boss fights recorded yet.</p>}
      {dialog}
    </div>
  );
}
