import { describe, expect, it } from 'vitest';
import { rosterChanges } from '../../src/domain/roster-sync.js';

const ranks = ['Epic', 'Legendary', 'Mythic', 'Mythic+'];
const roster = new Map([
  ['A', { rank: 'Mythic', equipmentLevel: null as number | null }],
  ['B', { rank: 'Mythic+', equipmentLevel: 10 as number | null }],
  ['C', { rank: 'Epic', equipmentLevel: null as number | null }],
]);
const recorded = (name: string, rank: string | null, equipmentLevel: number | null = null) => ({ name, rank, equipmentLevel });

describe('rosterChanges', () => {
  it('offers nothing when the record agrees with the roster', () => {
    expect(rosterChanges([recorded('A', 'Mythic'), recorded('B', 'Mythic+', 10)], roster, ranks)).toEqual([]);
  });

  it('calls a higher rank an upgrade and a lower one a downgrade', () => {
    const changes = rosterChanges([recorded('A', 'Mythic+'), recorded('C', 'Epic'), recorded('B', 'Mythic', null)], roster, ranks);
    expect(changes.map((c) => [c.hero, c.direction, c.to.rank])).toEqual([['A', 'upgrade', 'Mythic+'], ['B', 'downgrade', 'Mythic']]);
  });

  it('compares equipment when the rank is the same', () => {
    const [up] = rosterChanges([recorded('B', 'Mythic+', 15)], roster, ranks);
    expect(up).toMatchObject({ direction: 'upgrade', from: { rank: 'Mythic+', equipmentLevel: 10 }, to: { rank: 'Mythic+', equipmentLevel: 15 } });
    const [down] = rosterChanges([recorded('B', 'Mythic+', 5)], roster, ranks);
    expect(down!.direction).toBe('downgrade');
  });

  it('lets what the record leaves empty stand as the roster has it', () => {
    const [change] = rosterChanges([recorded('B', null, 15)], roster, ranks);
    expect(change).toMatchObject({ to: { rank: 'Mythic+', equipmentLevel: 15 }, direction: 'upgrade' });
    expect(rosterChanges([recorded('B', null, null)], roster, ranks)).toEqual([]); // nothing recorded, nothing to offer
  });

  it('offers a hero the roster does not have as new, when the record gives its rank', () => {
    const [added] = rosterChanges([recorded('Z', 'Mythic+', 10)], roster, ranks);
    expect(added).toMatchObject({ hero: 'Z', from: { rank: null, equipmentLevel: null }, to: { rank: 'Mythic+', equipmentLevel: 10 }, direction: 'new' });
  });

  it('counts a hero once, and offers nothing for an unknown hero with no rank', () => {
    expect(rosterChanges([recorded('Z', null)], roster, ranks)).toEqual([]); // not in the roster and no rank recorded: nothing to add
    expect(rosterChanges([recorded('A', 'Mythic+'), recorded('A', 'Epic')], roster, ranks).map((c) => c.to.rank)).toEqual(['Mythic+']);
  });
});
