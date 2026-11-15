import { describe, expect, it } from 'vitest';
import { matchFiles, normalizeName } from '../../src/domain/image-match.js';

const file = (name: string) => ({ name });

describe('normalizeName', () => {
  it('ignores case, spacing, punctuation, the extension and the wiki’s wrapping words', () => {
    expect(normalizeName('Arc Burst')).toBe('arcburst');
    expect(normalizeName('arc-burst.PNG')).toBe('arcburst');
    expect(normalizeName('Item Arc Burst Spell (Crown of Ashes).png')).toBe('arcburst');
    expect(normalizeName("Taichi&Agumon")).toBe('taichiagumon');
  });
});

describe('matchFiles', () => {
  const names = ['ArcBurst', 'Bladestorm', 'Healwind'];

  it('pairs files with units by name and reports the rest', () => {
    const result = matchFiles([file('Bladestorm.png'), file('Item Arc Burst Spell (Crown of Ashes).png'), file('Unknown.png')], names);
    expect(result.matched.map((m) => [m.name, m.file.name])).toEqual([
      ['Bladestorm', 'Bladestorm.png'],
      ['ArcBurst', 'Item Arc Burst Spell (Crown of Ashes).png'],
    ]);
    expect(result.unmatched).toEqual(['Unknown.png']);
    expect(result.ambiguous).toEqual([]);
  });

  it('uses none of several files that match the same unit', () => {
    const result = matchFiles([file('Item Healwind Spell (Veil of Memories).png'), file('Item Healwind Spell (Echoes of Dissent).png'), file('Bladestorm.png')], names);
    expect(result.matched.map((m) => m.name)).toEqual(['Bladestorm']);
    expect(result.ambiguous).toHaveLength(2);
  });
});
