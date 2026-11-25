// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobsSummary } from '../../../web/backend.js';
import { keptAnswer } from '../../../web/answers.js';
import { useJobChange, useJobFinished, useJobs } from '../../../web/jobs/JobsProvider.js';
import { jobsBody, renderWithJobs } from '../support/jobs.js';
import { jobsStream } from '../support/jobs-stream.js';

beforeEach(() => {
  vi.useFakeTimers();
  jobsStream.install();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The server pushes a summary: the first one is the answer on arrival, the next ones are changes. */
const push = (jobs: Partial<JobsSummary>) => act(async () => jobsStream.send(jobsBody(jobs)));
const arrive = async (jobs: Partial<JobsSummary> = {}, page = 'roster') => {
  await push(jobs);
  await act(async () => void renderWithJobs(<div />, page));
};
const arriveWith = async (ui: React.ReactElement, jobs: Partial<JobsSummary>, page: string) => {
  await push(jobs);
  await act(async () => void renderWithJobs(ui, page));
};
const queue = (o: Partial<JobsSummary['roster']>) => ({ active: 0, failed: 0, done: 0, signature: '', ...o });

describe('the job watcher', () => {
  it('opens one stream and closes it when the app goes away', async () => {
    await arrive();
    expect(jobsStream.opened).toBe(1);
    cleanup();
    expect(jobsStream.opened).toBe(0);
  });

  it('clears the answers the pages hold when work that was running finishes, and not before', async () => {
    const ask = vi.fn(async () => ['a map']);
    await arrive({ scenarios: { 3: { state: 'running' } } });
    await keptAnswer('/api/maps', ask);
    await push({ scenarios: { 3: { state: 'running' } } });
    await keptAnswer('/api/maps', ask);
    expect(ask).toHaveBeenCalledTimes(1);
    await push({ scenarios: { 3: { state: 'done' } } });
    await keptAnswer('/api/maps', ask);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('knows work that starts after the app opened, with nothing asked and no page telling it', async () => {
    let seen: JobsSummary | null = null;
    function Page() {
      seen = useJobs().summary;
      return null;
    }
    await arriveWith(<Page />, {}, 'arena');
    expect(seen!.battle.active).toBe(0);
    await push({ battle: queue({ active: 1, signature: '1:running' }) });
    expect(seen!.battle.active).toBe(1);
  });

  it('toasts, with a link to the result, when a scenario run it saw going has an answer', async () => {
    await arrive({ scenarios: { 3: { state: 'running' } } });
    expect(screen.queryByText(/has an answer/)).toBeNull();
    await push({ scenarios: { 3: { state: 'done' } } });
    expect(screen.getByText(/Scenario 3 has an answer\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('#arena');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a sticky error toast when a scenario run fails, and it stays past the usual time', async () => {
    await arrive({ scenarios: { 3: { state: 'running' } } });
    await push({ scenarios: { 3: { state: 'failed', error: 'claude: not logged in' } } });
    expect(screen.getByRole('alert').textContent).toMatch(/The Agent could not finish scenario 3: claude: not logged in/);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('toasts when the Review explanation is done and when it fails', async () => {
    await arrive({ review: { runId: 1, state: 'running' } });
    await push({ review: { runId: 1, state: 'done' } });
    expect(screen.getByText(/The Agent explained the review\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('#admin');
    cleanup();

    await arrive({ review: { runId: 2, state: 'running' } });
    await push({ review: { runId: 2, state: 'failed', error: 'timed out' } });
    expect(screen.getByRole('alert').textContent).toMatch(/The Agent could not explain the review: timed out/);
  });

  it('says nothing for work that was already over when the app opened', async () => {
    await arrive({ scenarios: { 3: { state: 'done' }, 4: { state: 'failed', error: 'x' } }, review: { runId: 1, state: 'done' } });
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows no toast on the page that shows the result, but tells the page', async () => {
    const seen: unknown[] = [];
    function Page() {
      useJobFinished('scenario', (event) => seen.push(event));
      return null;
    }
    await arriveWith(<Page />, { scenarios: { 3: { state: 'running' } } }, 'arena');
    await push({ scenarios: { 3: { state: 'done' } } });
    expect(screen.queryByText(/has an answer/)).toBeNull();
    expect(seen).toEqual([{ kind: 'scenario', id: 3, state: 'done' }]);
  });

  it('keeps the last answer when the connection drops, reports it, and clears the report when the server answers again', async () => {
    let seen: { summary: JobsSummary | null; error: string | null } = { summary: null, error: null };
    function Page() {
      seen = useJobs();
      return null;
    }
    await arriveWith(<Page />, { scenarios: { 3: { state: 'running' } } }, 'roster');
    await act(async () => jobsStream.drop());
    expect(seen.error).toBe('Lost the connection to the app.');
    expect(seen.summary?.scenarios).toEqual({ 3: { state: 'running' } });
    await push({ scenarios: { 3: { state: 'done' } } });
    expect(seen.error).toBeNull();
    // work that ended during the gap is found by comparing with the last answer
    expect(screen.getByText(/Scenario 3 has an answer\./)).toBeTruthy();
  });

  it('toasts how many pictures were read when a queue that was reading is done, and how many could not be', async () => {
    await arrive({ battle: queue({ active: 3, signature: '1:running,2:queued,3:queued' }) });
    await push({ battle: queue({ done: 2, failed: 1, signature: '1:done,2:done,3:failed' }) });
    expect(screen.getByText(/2 pictures read: ready to review in PvP\./)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/1 picture could not be read/);
    expect(screen.getAllByRole('link', { name: 'Open' }).map((a) => a.getAttribute('href'))).toEqual(['#arena', '#arena']);
  });

  it('tells a page that shows a picture queue when the queue changed, including work that started after it opened', async () => {
    const refetch = vi.fn();
    function Page() {
      useJobChange('battle', refetch);
      return null;
    }
    await arriveWith(<Page />, {}, 'arena');
    // the first answer is not a change: the page asks for its details itself when it opens
    expect(refetch).not.toHaveBeenCalled();
    await push({ battle: queue({ active: 1, signature: '1:running' }) });
    expect(refetch).toHaveBeenCalledTimes(1);
    await push({ battle: queue({ done: 1, signature: '1:done' }) });
    expect(refetch).toHaveBeenCalledTimes(2);
    // no toast on the page that shows the pictures
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
  });
});
