import { useState, type ReactNode } from 'react';
import { groupByWeek, WeekSection, weekSummary } from './weeks.js';
import { toggled } from './format.js';

/** The part of a fight that decides how a list groups it. */
export interface Groupable {
  battleId: number | null;
  battlePosition: number | null;
  createdAt: string;
}

/** A card of the list: a fight on its own, or all the fights of one battle (an Arena-type battle or a Dream Hunt day). */
export type ListItem<F> = { kind: 'fight'; fight: F } | { kind: 'battle'; id: number; fights: F[] };

/**
 * The state shared by the lists of recorded fights (Dream Hunt and PvP): grouping the fights of a battle into one card, the weeks, and
 * which battles and weeks are open. With grouping on, a battle is one card placed where its newest fight is; a fight on its own stays a card.
 */
export function useGroupedList<F extends Groupable>(fights: F[]) {
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set()); // battles whose fights are open
  const [weekOpen, setWeekOpen] = useState<Map<string, boolean>>(new Map()); // weeks opened or closed by hand; the newest is open until then

  const items: ListItem<F>[] = [];
  const seen = new Set<number>();
  for (const fight of fights) {
    if (!grouped || fight.battleId == null) {
      items.push({ kind: 'fight', fight });
    } else if (!seen.has(fight.battleId)) {
      seen.add(fight.battleId);
      items.push({ kind: 'battle', id: fight.battleId, fights: fights.filter((f) => f.battleId === fight.battleId).sort((a, b) => (a.battlePosition ?? 0) - (b.battlePosition ?? 0)) });
    }
  }
  const weeks = groupByWeek(items, (item) => (item.kind === 'fight' ? item.fight.createdAt : item.fights[0]!.createdAt));

  const toggle = (id: number) => setOpen((old) => toggled(old, id));
  const expandAll = () => (setOpen(new Set(items.flatMap((i) => (i.kind === 'battle' ? [i.id] : [])))), setWeekOpen(new Map(weeks.map((w) => [w.start, true]))));
  const collapseAll = () => (setOpen(new Set()), setWeekOpen(new Map(weeks.map((w) => [w.start, false]))));
  const toggleWeek = (start: string, index: number) => setWeekOpen((old) => new Map(old).set(start, !(old.get(start) ?? index === 0)));

  return { grouped, setGrouped, items, weeks, open, toggle, expandAll, collapseAll, weekOpen, toggleWeek };
}

export type GroupedList<F extends Groupable> = ReturnType<typeof useGroupedList<F>>;

/** The row above a list of records: the filters of the page, then the grouping controls and the button that starts a new record, in the same order on every page. */
export function RecordToolbar<F extends Groupable>({ list, group, newLabel, onNew, children }: { list: GroupedList<F>; group: string; newLabel: string; onNew: () => void; children: ReactNode }) {
  return (
    <div className="filters">
      {children}
      <label className="check">
        <input type="checkbox" checked={list.grouped} onChange={(e) => list.setGrouped(e.target.checked)} /> Group by {group}
      </label>
      {list.grouped && (
        <>
          <button onClick={list.expandAll}>Expand all</button>
          <button onClick={list.collapseAll}>Collapse all</button>
        </>
      )}
      <button className="primary" onClick={onNew}>
        {newLabel}
      </button>
    </div>
  );
}

/** The cards of a list, under a heading for each week when grouped. `battle` and `fight` name the things counted in a week's summary. */
export function RecordList<F extends Groupable>({ list, label, battle, fight, renderItem }: { list: GroupedList<F>; label: string; battle: string; fight: string; renderItem: (item: ListItem<F>) => ReactNode }) {
  if (!list.grouped) {
    return (
      <ul className="attempts" aria-label={label}>
        {list.items.map(renderItem)}
      </ul>
    );
  }
  return (
    <>
      {list.weeks.map((week, index) => (
        <WeekSection key={week.start} start={week.start} summary={weekSummary(week.items, battle, fight)} open={list.weekOpen.get(week.start) ?? index === 0} onToggle={() => list.toggleWeek(week.start, index)}>
          <ul className="attempts" aria-label={label}>
            {week.items.map(renderItem)}
          </ul>
        </WeekSection>
      ))}
    </>
  );
}
