import { describe, expect, it } from 'vitest';
import { swapParts } from '../../web/swap.js';

interface Draft {
  map: string;
  outcome: string;
  mine: string;
  theirs: string;
}
const drafts: Draft[] = [
  { map: 'M1', outcome: 'Win', mine: 'a', theirs: 'x' },
  { map: 'M2', outcome: 'Loss', mine: 'b', theirs: 'y' },
  { map: 'M3', outcome: 'Win', mine: 'c', theirs: 'z' },
];
const refit = (d: Draft) => ({ ...d, mine: `${d.mine}@${d.map}` });

describe('swapParts', () => {
  it('exchanges only the chosen parts and leaves the map, result and other teams with their slots', () => {
    const swapped = swapParts(drafts, 0, 2, ['mine'], (d) => d);
    expect(swapped[0]).toEqual({ map: 'M1', outcome: 'Win', mine: 'c', theirs: 'x' });
    expect(swapped[2]).toEqual({ map: 'M3', outcome: 'Win', mine: 'a', theirs: 'z' });
    expect(swapped[1]).toBe(drafts[1]);
  });

  it('can exchange both sides, and refits each team to its own slot', () => {
    const swapped = swapParts(drafts, 0, 1, ['mine', 'theirs'], refit);
    expect(swapped[0]).toEqual({ map: 'M1', outcome: 'Win', mine: 'b@M1', theirs: 'y' });
    expect(swapped[1]).toEqual({ map: 'M2', outcome: 'Loss', mine: 'a@M2', theirs: 'x' });
  });

  it('does nothing for the same team or a missing one', () => {
    expect(swapParts(drafts, 1, 1, ['mine'], refit)).toBe(drafts);
    expect(swapParts(drafts, 0, 7, ['mine'], refit)).toBe(drafts);
  });
});
