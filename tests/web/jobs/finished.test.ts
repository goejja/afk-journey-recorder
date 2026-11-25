import { describe, expect, it } from 'vitest';
import { announcement, finishedBetween, showsResult } from '../../../web/jobs/finished.js';
import { jobsBody } from '../support/jobs.js';

describe('finishedBetween', () => {
  it('lists the runs that were going and are not, with their reason when they failed', () => {
    const before = jobsBody({ scenarios: { 3: { state: 'running' }, 4: { state: 'running' }, 5: { state: 'running' } }, review: { runId: 1, state: 'running' } });
    const after = jobsBody({
      scenarios: { 3: { state: 'done' }, 4: { state: 'failed', error: 'no' }, 5: { state: 'running' } },
      review: { runId: 1, state: 'done' },
    });
    expect(finishedBetween(before, after)).toEqual([
      { kind: 'scenario', id: 3, state: 'done' },
      { kind: 'scenario', id: 4, state: 'failed', error: 'no' },
      { kind: 'review', id: 1, state: 'done' },
    ]);
  });

  it('ignores work that was not seen going, a cancelled run that is gone, and a new Review run', () => {
    expect(finishedBetween(jobsBody(), jobsBody({ scenarios: { 3: { state: 'done' } } }))).toEqual([]);
    expect(finishedBetween(jobsBody({ scenarios: { 3: { state: 'running' } } }), jobsBody())).toEqual([]);
    expect(finishedBetween(jobsBody({ review: { runId: 1, state: 'running' } }), jobsBody({ review: { runId: 2, state: 'done' } }))).toEqual([]);
  });
});

describe('finishedBetween for the picture queues', () => {
  const queue = (o: Partial<ReturnType<typeof jobsBody>['roster']>) => ({ active: 0, failed: 0, done: 0, signature: '', ...o });

  it('counts the pictures a queue gained in read and failed when it stops reading', () => {
    const before = jobsBody({ roster: queue({ active: 2, done: 1 }), battle: queue({ active: 1 }) });
    const after = jobsBody({ roster: queue({ done: 3 }), battle: queue({ failed: 1 }) });
    expect(finishedBetween(before, after)).toEqual([
      { kind: 'roster', state: 'done', count: 2 },
      { kind: 'battle', state: 'failed', count: 1 },
    ]);
  });

  it('says nothing while pictures are still being read, or for pictures that were already there', () => {
    expect(finishedBetween(jobsBody({ roster: queue({ active: 2 }) }), jobsBody({ roster: queue({ active: 1, done: 1 }) }))).toEqual([]);
    expect(finishedBetween(jobsBody({ roster: queue({ done: 2 }) }), jobsBody({ roster: queue({ done: 2 }) }))).toEqual([]);
  });

  it('words one and many pictures, and points to the page that reviews them', () => {
    expect(announcement({ kind: 'roster', state: 'done', count: 1 })).toEqual({ message: '1 picture read: ready to review in Roster.', error: false, href: '#roster' });
    expect(announcement({ kind: 'battle', state: 'failed', count: 3 })).toMatchObject({ message: '3 pictures could not be read: see the import in PvP.', error: true, href: '#arena' });
  });
});

describe('announcement', () => {
  it('points each kind to the page that shows its result, which needs no toast', () => {
    expect(announcement({ kind: 'scenario', id: 3, state: 'done' }).href).toBe('#arena');
    expect(announcement({ kind: 'review', id: 1, state: 'done' }).href).toBe('#admin');
    expect(showsResult({ kind: 'scenario', id: 3, state: 'done' }, 'arena')).toBe(true);
    expect(showsResult({ kind: 'scenario', id: 3, state: 'done' }, 'admin')).toBe(false);
  });
});
