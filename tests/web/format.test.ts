import { describe, expect, it } from 'vitest';
import { percent, points, record, toggled } from '../../web/format.js';

describe('format', () => {
  it('writes rates as whole percentages', () => {
    expect(percent(0.724)).toBe('72%');
    expect(percent(1)).toBe('100%');
  });

  it('writes differences as signed points, and results as wins–losses', () => {
    expect(points(0.083)).toBe('+8 pts');
    expect(points(-0.08)).toBe('−8 pts');
    expect(points(0)).toBe('+0 pts');
    expect(record({ games: 7, wins: 5 })).toBe('5–2');
  });

  it('toggles an item in a copy of a set', () => {
    const before = new Set(['a']);
    const added = toggled(before, 'b');
    expect([...added]).toEqual(['a', 'b']);
    expect([...toggled(added, 'a')]).toEqual(['b']);
    expect([...before]).toEqual(['a']);
  });
});
