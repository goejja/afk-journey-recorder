import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatDurationFixed,
  parseDuration,
  summarizeCompositions,
  validateDreamHuntResult,
  type DreamHuntRun,
} from '../../src/domain/dream-hunt.js';

describe('validateDreamHuntResult', () => {
  it('requires a time for a clear and none for a failure', () => {
    expect(validateDreamHuntResult({ outcome: 'Win', timeSeconds: 83 })).toBeNull();
    expect(validateDreamHuntResult({ outcome: 'Loss', timeSeconds: null })).toBeNull();
    expect(validateDreamHuntResult({ outcome: 'Win', timeSeconds: null })).toMatch(/needs a time/);
    expect(validateDreamHuntResult({ outcome: 'Win', timeSeconds: 0 })).toMatch(/needs a time/);
    expect(validateDreamHuntResult({ outcome: 'Win', timeSeconds: 99999 })).toMatch(/needs a time/);
    expect(validateDreamHuntResult({ outcome: 'Loss', timeSeconds: 40 })).toMatch(/no clear time/);
    expect(validateDreamHuntResult({ outcome: 'Draw', timeSeconds: 40 })).toMatch(/Win or Loss/);
  });
});

describe('durations', () => {
  it('reads minutes and seconds, or seconds with hundredths', () => {
    for (const text of ['1:23', '1m23', '1m23s', ' 1M23 ', '83', '83s', '1:23.0']) expect(parseDuration(text), text).toBe(83);
    for (const text of ['9.69', '9.69s', '9s69', '9,69', '9 s 69']) expect(parseDuration(text), text).toBe(9.69);
    expect(parseDuration(' 0:05 ')).toBe(5);
    expect(parseDuration('9s5')).toBe(9.5);
    expect(parseDuration('1:09.5')).toBe(69.5);
    expect(parseDuration('1m')).toBe(60);
    expect(parseDuration('1m10.5')).toBe(70.5);
  });
  it('refuses what is not a time', () => {
    for (const text of ['1:75', '1m75', '1:2:3', 'abc', '', 'm', 's', '9.', '.5', '-3', '9.69.1']) expect(parseDuration(text), text).toBeNull();
  });
  it('formats under a minute as seconds and from a minute as m:ss, with hundredths only when there are some', () => {
    expect(formatDuration(83)).toBe('1:23');
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(9.69)).toBe('9.69s');
    expect(formatDuration(9.5)).toBe('9.5s');
    expect(formatDuration(69.5)).toBe('1:09.5');
    expect(formatDuration(59.999)).toBe('1:00');
    expect(formatDuration(80.5)).toBe('1:20.5');
  });
  it('gives back what it formats', () => {
    for (const seconds of [5, 9.69, 9.5, 59.99, 60, 69.5, 83, 3600]) expect(parseDuration(formatDuration(seconds))).toBe(seconds);
  });
});

let id = 0;
const run = (heroes: string[], outcome: 'Win' | 'Loss', timeSeconds: number | null, artifact: string | null = 'Bladestorm'): DreamHuntRun => ({
  attemptId: ++id,
  heroes,
  artifact,
  outcome,
  timeSeconds,
});

describe('summarizeCompositions', () => {
  it('groups the same heroes and artifact whatever the order, and summarizes the spread of times', () => {
    const [summary] = summarizeCompositions([
      run(['A', 'B'], 'Win', 100),
      run(['B', 'A'], 'Win', 80),
      run(['A', 'B'], 'Win', 120),
      run(['A', 'B'], 'Loss', null),
    ]);
    expect(summary).toMatchObject({
      heroes: ['A', 'B'],
      attempts: 4,
      clears: 3,
      clearRate: 0.75,
      bestSeconds: 80,
      medianSeconds: 100,
      meanSeconds: 100,
      worstSeconds: 120,
      lowConfidence: false,
    });
  });

  it('splits a composition by map and layout, fastest layout first, never-cleared last', () => {
    const placed = (tiles: number[], map: string, outcome: 'Win' | 'Loss', seconds: number | null): DreamHuntRun => ({
      ...run(['A', 'B'], outcome, seconds),
      mapName: map,
      layout: { units: ['A', 'B'].map((hero, i) => ({ kind: 'hero' as const, hero, part: '', tile: tiles[i]! })) },
    });
    const [summary] = summarizeCompositions([
      placed([38, 39], 'M', 'Win', 100),
      placed([39, 38], 'M', 'Win', 60), // the same hero tiles swapped: a different layout
      placed([38, 39], 'M', 'Win', 80),
      placed([40, 41], 'M', 'Loss', null),
      placed([38, 39], 'N', 'Win', 50), // another map: a different layout
    ]);
    expect(summary!.layouts.map((l) => [l.mapName, l.attempts, l.clears, l.medianSeconds])).toEqual([
      ['N', 1, 1, 50],
      ['M', 1, 1, 60],
      ['M', 2, 2, 90],
      ['M', 1, 0, null],
    ]);
    expect(summary!.layouts[2]).toMatchObject({ lowConfidence: true, bestSeconds: 80, worstSeconds: 100 });
  });

  it('takes the middle of an even number of clears as the median', () => {
    const [summary] = summarizeCompositions([run(['A'], 'Win', 60), run(['A'], 'Win', 100)]);
    expect(summary!.medianSeconds).toBe(80);
  });

  it('keeps different artifacts or heroes apart', () => {
    const result = summarizeCompositions([
      run(['A', 'B'], 'Win', 90),
      run(['A', 'B'], 'Win', 90, 'Awakening'),
      run(['A', 'C'], 'Win', 90),
    ]);
    expect(result).toHaveLength(3);
  });

  it('flags a composition with fewer than three clears as low confidence', () => {
    const [summary] = summarizeCompositions([run(['A'], 'Win', 60), run(['A'], 'Win', 62)]);
    expect(summary!.lowConfidence).toBe(true);
  });

  it('ranks by median time, then clear rate, and puts never-cleared compositions last', () => {
    const result = summarizeCompositions([
      run(['Slow'], 'Win', 120),
      run(['Fast'], 'Win', 70),
      run(['Fast'], 'Loss', null),
      run(['FastSure'], 'Win', 70),
      run(['Never'], 'Loss', null),
      run(['Never'], 'Loss', null),
    ]);
    expect(result.map((s) => s.heroes[0])).toEqual(['FastSure', 'Fast', 'Slow', 'Never']);
    expect(result.at(-1)).toMatchObject({ clears: 0, medianSeconds: null, bestSeconds: null, lowConfidence: true });
  });

  it('ranks a composition with enough clears above a faster one that was cleared only once', () => {
    const result = summarizeCompositions([
      run(['Lucky'], 'Win', 50),
      run(['Steady'], 'Win', 100),
      run(['Steady'], 'Win', 105),
      run(['Steady'], 'Win', 110),
    ]);
    expect(result.map((s) => s.heroes[0])).toEqual(['Steady', 'Lucky']);
    expect(result[1]!.lowConfidence).toBe(true);
  });

  it('remembers the newest attempt of each composition', () => {
    const a = run(['A'], 'Win', 60);
    const b = run(['A'], 'Win', 70);
    expect(summarizeCompositions([a, b])[0]!.latestAttemptId).toBe(b.attemptId);
  });
});

describe('formatDurationFixed', () => {
  it('always writes the hundredths', () => {
    expect(formatDurationFixed(47.7)).toBe('47.70s');
    expect(formatDurationFixed(5)).toBe('5.00s');
    expect(formatDurationFixed(92)).toBe('1:32.00');
    expect(formatDurationFixed(69.5)).toBe('1:09.50');
    expect(formatDurationFixed(59.999)).toBe('1:00.00');
  });
});
