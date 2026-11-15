import { describe, expect, it } from 'vitest';
import { groupByWeek, weekLabel, weekStart, weekSummary } from '../../web/weeks.js';

describe('weeks', () => {
  it('puts a date in the week that starts on its Monday', () => {
    expect(weekStart('2026-10-26 08:00:00')).toBe('2026-10-26'); // a Monday
    expect(weekStart('2026-10-29')).toBe('2026-10-26');
    expect(weekStart('2026-11-01 23:59:59')).toBe('2026-10-26'); // the Sunday still belongs to it
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekStart('2027-01-01')).toBe('2026-12-28'); // across the year
  });

  it('names a week by its Monday', () => {
    expect(weekLabel('2026-10-26')).toBe('Week of Oct 26, 2026');
  });

  it('groups items by week, newest week first, each week keeping its order', () => {
    const items = [{ id: 1, at: '2026-11-03' }, { id: 2, at: '2026-10-29' }, { id: 3, at: '2026-11-04' }, { id: 4, at: '2026-10-27' }];
    expect(groupByWeek(items, (i) => i.at).map((w) => [w.start, w.items.map((i) => i.id)])).toEqual([
      ['2026-11-02', [1, 3]],
      ['2026-10-26', [2, 4]],
    ]);
  });

  it('summarises a week', () => {
    expect(weekSummary([{ kind: 'battle' }, { kind: 'battle' }], 'day', 'fight')).toBe('2 days');
    expect(weekSummary([{ kind: 'battle' }, { kind: 'fight' }], 'day', 'fight')).toBe('1 day and 1 fight on its own');
    expect(weekSummary([{ kind: 'fight' }, { kind: 'fight' }], 'day', 'fight')).toBe('2 fights');
  });
});
