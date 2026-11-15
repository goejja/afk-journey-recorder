import { describe, expect, it } from 'vitest';
import { planThinning, type ThinningPicture } from '../../src/domain/thinning.js';

/** A picture is a point on a line: the distance between two pictures is how far apart their values are. */
const picture = (id: number, value: number, extra: Partial<ThinningPicture & { value: number }> = {}): ThinningPicture & { value: number } => ({
  id,
  group: 'Supreme+',
  source: 'roster',
  flagged: false,
  value,
  ...extra,
});
const distance = (a: { value: number }, b: { value: number }) => Math.abs(a.value - b.value);
const options = { threshold: 0.015, floor: 1, distance };

describe('planThinning', () => {
  it('keeps one of two near-identical pictures of a group and proposes the other', () => {
    const plan = planThinning([picture(1, 0.5), picture(2, 0.505)], options);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.group).toBe('Supreme+');
    expect(plan[0]!.keep.length + plan[0]!.remove.length).toBe(2);
    expect(plan[0]!.keep).toHaveLength(1);
    expect(plan[0]!.remove).toHaveLength(1);
  });

  it('keeps the picture the player confirmed in a Roster import over one from a battle form, whatever the order', () => {
    const fromBattle = picture(1, 0.5, { source: 'battle' });
    const fromRoster = picture(2, 0.505, { source: 'roster' });
    for (const pictures of [[fromBattle, fromRoster], [fromRoster, fromBattle]]) {
      const [group] = planThinning(pictures, options);
      expect(group!.keep.map((p) => p.id)).toEqual([2]);
      expect(group!.remove.map((p) => p.id)).toEqual([1]);
    }
  });

  it('never keeps a flagged picture over an unflagged one that looks like it, even one the player confirmed', () => {
    const flaggedRoster = picture(1, 0.5, { source: 'roster', flagged: true });
    const plainBattle = picture(2, 0.505, { source: 'battle' });
    const [group] = planThinning([flaggedRoster, plainBattle], options);
    expect(group!.keep.map((p) => p.id)).toEqual([2]);
    expect(group!.remove.map((p) => p.id)).toEqual([1]);
  });

  it('never compares pictures of different groups, however alike they are', () => {
    const plan = planThinning([picture(1, 0.5, { group: 'Supreme' }), picture(2, 0.5, { group: 'Supreme+' })], options);
    expect(plan).toEqual([]);
  });

  it('never thins a group below the floor', () => {
    const alike = [1, 2, 3, 4, 5].map((id) => picture(id, 0.5 + id / 1000));
    const [group] = planThinning(alike, { ...options, floor: 3 });
    expect(group!.keep).toHaveLength(3);
    expect(group!.remove).toHaveLength(2);
    expect(planThinning(alike.slice(0, 3), { ...options, floor: 3 })).toEqual([]);
  });

  it('when the floor stops the thinning, the pictures that stay are those that add the most', () => {
    const pictures = [picture(1, 0.5), picture(2, 0.503), picture(3, 0.505), picture(4, 0.508), picture(5, 0.511)];
    const [group] = planThinning(pictures, { ...options, floor: 3 });
    // 0.505 is the most typical and stays; the floor then takes back the furthest from it (0.511), then the furthest from both (0.500)
    expect(group!.keep.map((p) => p.id).sort()).toEqual([1, 3, 5]);
    expect(group!.remove.map((p) => p.id).sort()).toEqual([2, 4]);
  });

  it('keeps the most typical of equally preferred pictures, whatever the order', () => {
    const [low, middle, high] = [picture(1, 0.5, { source: 'battle' }), picture(2, 0.505, { source: 'battle' }), picture(3, 0.51, { source: 'battle' })];
    for (const pictures of [[low, middle, high], [high, low, middle], [middle, high, low], [low, high, middle]]) {
      const [group] = planThinning(pictures, options);
      expect(group!.keep.map((p) => p.id)).toEqual([2]);
      expect(group!.remove.map((p) => p.id).sort()).toEqual([1, 3]);
    }
  });

  it('thins a drifting series without leaving a removed picture uncovered, in any order', () => {
    // 0.50 is near 0.51 and 0.51 near 0.52, but 0.50 is not near 0.52: only a picture alike to one that stays may go
    const series = [picture(1, 0.5), picture(2, 0.51), picture(3, 0.52)];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of orders) {
      const plan = planThinning(order.map((i) => series[i]!), options);
      const kept = plan.flatMap((g) => g.keep);
      const removed = plan.flatMap((g) => g.remove);
      expect(removed.length).toBeGreaterThan(0);
      for (const r of removed) expect(kept.some((k) => distance(k, r) < options.threshold)).toBe(true);
      for (const a of kept) for (const b of kept) if (a !== b) expect(distance(a, b)).toBeGreaterThanOrEqual(options.threshold);
    }
  });
});
