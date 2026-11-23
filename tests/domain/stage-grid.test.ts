import { describe, expect, it } from 'vitest';
import { buildLane, laneRange, openByDefault, panelAfter, phaseOf, standardPhase, type GridBox } from '../../src/domain/stage-grid.js';

const box = (kind: GridBox['kind'], number: number, state: GridBox['state'] = 'cleared', phase = 0): GridBox => ({ kind, phase, number, state, newestSeason: state === 'cleared' ? 8 : 7 });

describe('the Stages grid lanes', () => {
  it('splits Normal and Phantisomal over the phases by number, and restarts Apex in every phase', () => {
    expect([1, 2, 3].map((p) => laneRange('Normal', p))).toEqual([{ first: 1, last: 300 }, { first: 301, last: 600 }, { first: 601, last: 900 }]);
    expect([1, 2, 3].map((p) => laneRange('Phantisomal', p).last)).toEqual([600, 1200, 1800]);
    expect(laneRange('Apex Normal', 2)).toEqual({ first: 1, last: 333 });
    expect(laneRange('Apex Phantisomal', 3)).toEqual({ first: 1, last: 667 });
    expect(standardPhase('Normal', 300)).toBe(1);
    expect(standardPhase('Normal', 301)).toBe(2);
    expect(standardPhase('Phantisomal', 1200)).toBe(2);
    expect(phaseOf(box('Apex Normal', 5, 'cleared', 2))).toBe(2);
  });

  it('gives every number of the range a box with its state, and runs past the cap for a record beyond it', () => {
    const lane = buildLane('Normal', 3, [box('Normal', 601), box('Normal', 602, 'older'), box('Normal', 905)]);
    expect(lane.boxes[0]).toMatchObject({ number: 601, state: 'cleared' });
    expect(lane.boxes[1]).toMatchObject({ number: 602, state: 'older', newestSeason: 7 });
    expect(lane.boxes[2]).toMatchObject({ number: 603, state: 'none', newestSeason: null });
    expect(lane.boxes).toHaveLength(905 - 601 + 1);
    expect([lane.cleared, lane.recorded, lane.complete]).toEqual([2, 3, false]);
    expect(buildLane('Normal', 1, []).boxes).toHaveLength(300);
  });

  it('opens a standard lane until its last box is cleared this season, whatever is empty before it', () => {
    const phase = (normal: GridBox[]) => ({ normal: buildLane('Normal', 1, normal), phantisomal: buildLane('Phantisomal', 1, []) });
    expect(openByDefault(phase([box('Normal', 300, 'older')]).normal, phase([]))).toBe(true);
    const last = phase([box('Normal', 300)]);
    expect(last.normal.complete).toBe(true);
    expect(openByDefault(last.normal, last)).toBe(false);
  });

  it('opens an Apex lane for a record of its own, or once both standard lanes of the phase are cleared', () => {
    const standard = (normal: boolean, phantisomal: boolean) => ({
      normal: buildLane('Normal', 1, normal ? [box('Normal', 300)] : []),
      phantisomal: buildLane('Phantisomal', 1, phantisomal ? [box('Phantisomal', 600)] : []),
    });
    const apex = (boxes: GridBox[]) => buildLane('Apex Normal', 1, boxes);
    expect(openByDefault(apex([]), standard(true, false))).toBe(false);
    expect(openByDefault(apex([]), standard(true, true))).toBe(true); // unlocked, no record yet
    expect(openByDefault(apex([box('Apex Normal', 3, 'cleared', 1)]), standard(false, false))).toBe(true);
    expect(openByDefault(apex([box('Apex Normal', 3, 'older', 1)]), standard(false, false))).toBe(false);
  });

  it('puts the panel of a box after the last box of its row', () => {
    expect(panelAfter(0, 10, 300)).toBe(9);
    expect(panelAfter(9, 10, 300)).toBe(9);
    expect(panelAfter(10, 10, 300)).toBe(19);
    expect(panelAfter(297, 10, 300)).toBe(299); // the last row may be short
    expect(panelAfter(3, 0, 5)).toBe(3); // a width not measured yet is one column
  });
});
