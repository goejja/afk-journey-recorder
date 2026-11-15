import { describe, expect, it } from 'vitest';
import { hsvOf } from '../../src/vision/color.js';
import { meanDifference, nearestLabel } from '../../src/vision/nearest.js';

const f = (...values: number[]) => Float32Array.from(values);
const example = (label: string, ...values: number[]) => ({ label, features: f(...values) });

describe('nearestLabel', () => {
  it('has no answer without examples', () => {
    expect(nearestLabel(f(0), [], (e: { label: string; features: Float32Array }) => e.label, meanDifference)).toBeNull();
  });

  it('takes the closest example of each label, and says how clearly the best beats the runner-up and how many examples it has', () => {
    const examples = [example('a', 0.1), example('a', 0.5), example('a', 0.9), example('b', 0.4)];
    const nearest = nearestLabel(f(0.2), examples, (e) => e.label, meanDifference)!;
    expect(nearest.label).toBe('a');
    expect(nearest.distance).toBeCloseTo(0.1);
    expect(nearest.support).toBe(3);
    expect(nearest.margin).toBeCloseTo((0.2 - 0.1) / 0.2);
  });

  it('has a margin of 1 when there is no other label', () => {
    expect(nearestLabel(f(0), [example('a', 1), example('a', 0.5)], (e) => e.label, meanDifference)!.margin).toBe(1);
  });

  it('keeps the first label when two are equally close', () => {
    expect(nearestLabel(f(0.5), [example('a', 0.4), example('b', 0.6)], (e) => e.label, meanDifference)!.label).toBe('a');
  });
});

describe('hsvOf', () => {
  it('gives hue in degrees, saturation and value', () => {
    expect(hsvOf(255, 0, 0)).toEqual([0, 1, 1]);
    expect(hsvOf(0, 255, 0)).toEqual([120, 1, 1]);
    expect(hsvOf(0, 0, 255)).toEqual([240, 1, 1]);
    expect(hsvOf(255, 255, 0)).toEqual([60, 1, 1]);
    expect(hsvOf(255, 0, 255)[0]).toBe(300);
    expect(hsvOf(128, 64, 64)[1]).toBeCloseTo(0.5);
  });

  it('puts a boundary hue exactly on the boundary', () => {
    expect(hsvOf(186, 228, 207)[0]).toBe(150);
    expect(hsvOf(177, 219, 51)[0]).toBe(75);
  });

  it('gives a grey no hue (-1), so no hue window takes it', () => {
    expect(hsvOf(200, 200, 200)).toEqual([-1, 0, 200 / 255]);
    expect(hsvOf(0, 0, 0)).toEqual([-1, 0, 0]);
  });
});
