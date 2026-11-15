import { describe, expect, it } from 'vitest';
import { reviewReducer, type ReviewState } from '../../../web/reader/RosterImport.js';
import type { ImportSection } from '../../../web/backend.js';

const section = (index: number, rows: string[] = []) => ({ index, rows: rows.map((tile) => ({ tile })) }) as unknown as ImportSection;
const start = (): ReviewState => ({
  sections: [section(1, ['1.0', '1.1']), section(2, ['2.0'])],
  chosen: { '1.5': 'Evie' },
  edits: { '1.0': { ticked: true }, '2.0': { rank: 'Elite' } },
  renames: { 1: false, 2: false },
  names: { 1: 'Rival' },
  looks: { '1.5': false },
});

describe('reviewReducer', () => {
  it('merges edits of one row', () => {
    const next = reviewReducer(start(), { type: 'edit', tile: '1.0', change: { rank: 'Mythic' } });
    expect(next.edits['1.0']).toEqual({ ticked: true, rank: 'Mythic' });
  });

  it('unticks every row of a section and keeps their other edits', () => {
    const next = reviewReducer(start(), { type: 'skip', section: section(2, ['2.0']) });
    expect(next.edits['2.0']).toEqual({ rank: 'Elite', ticked: false });
    expect(next.edits['1.0']).toEqual({ ticked: true });
  });

  it('forgets the edits and the rename of a retargeted section, and only of that one', () => {
    const next = reviewReducer(start(), { type: 'retargeted', section: section(1, ['1.0']) });
    expect(next.edits).toEqual({ '2.0': { rank: 'Elite' } });
    expect(next.renames).toEqual({ 2: false });
    expect(next.names).toEqual({ 1: 'Rival' });
    expect(next.sections.map((s) => s.rows.length)).toEqual([1, 1]);
  });

  it('forgets the edits of a row whose hero was chosen again', () => {
    const next = reviewReducer(start(), { type: 'chosen', tile: '1.0', sections: [section(1)], chosen: { '1.0': 'Fay' } });
    expect(next.edits).toEqual({ '2.0': { rank: 'Elite' } });
    expect(next.chosen).toEqual({ '1.0': 'Fay' });
  });
});
