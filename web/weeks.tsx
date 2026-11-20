import type { ReactNode } from 'react';
import { DisclosureMark } from './ui/Icon.js';

/**
 * The Monday (YYYY-MM-DD) of the week a record's date falls in. Dream Hunt and the Supreme Arena repeat by the week, and the game resets on Sunday
 * night at midnight UTC, which is the start of Monday in UTC, the clock records are dated with.
 */
export function weekStart(createdAt: string): string {
  const [year, month, day] = createdAt.slice(0, 10).split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function weekLabel(start: string): string {
  const [year, month, day] = start.split('-').map(Number) as [number, number, number];
  return `Week of ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
}

/** Items split into weeks, newest week first, keeping the order of the items inside each week. */
export function groupByWeek<T>(items: T[], createdAt: (item: T) => string): { start: string; items: T[] }[] {
  const weeks = new Map<string, T[]>();
  for (const item of items) {
    const start = weekStart(createdAt(item));
    weeks.set(start, [...(weeks.get(start) ?? []), item]);
  }
  return [...weeks.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([start, list]) => ({ start, items: list }));
}

/** A week of records under its heading, which opens and closes it. */
export function WeekSection({ start, summary, open, onToggle, children }: { start: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="week" aria-label={weekLabel(start)}>
      <button className="week-head" aria-expanded={open} onClick={onToggle}>
        <DisclosureMark open={open} /> <strong>{weekLabel(start)}</strong> <span className="muted">{summary}</span>
      </button>
      {open && children}
    </section>
  );
}

/** "3 days", "2 battles and 1 fight on its own". */
export function weekSummary(items: { kind: 'fight' | 'battle' }[], battle: string, fight: string): string {
  const battles = items.filter((i) => i.kind === 'battle').length;
  const lone = items.length - battles;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [battles > 0 ? plural(battles, battle) : '', lone > 0 ? `${plural(lone, fight)}${battles > 0 ? ' on its own' : ''}` : ''].filter(Boolean).join(' and ');
}
