import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobsSummary } from '../backend.js';
import { jobsContract } from '../../src/shared/contracts/jobs.js';
import { clearAnswers } from '../answers.js';
import { useToast } from '../ui/Toast.js';
import { announcement, finishedBetween, showsResult, type JobEvent, type JobKind } from './finished.js';

type Listener = (event: JobEvent) => void;

interface Jobs {
  /** Where the background work stands; null until the first answer. */
  summary: JobsSummary | null;
  /** The last problem with the connection to the app, or null. */
  error: string | null;
  subscribe: (listener: Listener) => () => void;
}

// outside a provider nothing is known and nothing is watched, so a page that reads the jobs can still be rendered alone
const JobsContext = createContext<Jobs>({ summary: null, error: null, subscribe: () => () => {} });

/**
 * Watches the background work of the app (docs/ui-conventions.md, "Background work"), whichever page is open. The app pushes where the
 * work stands as Server-Sent Events (`GET /api/jobs/stream`): once as the stream opens and again each time any of it changes, so no page
 * asks and none tells the watcher that it started work. When work it saw running finishes or fails, it tells the pages that listen
 * (`useJobFinished`) and shows a toast unless the person is already on the page that shows the result.
 */
export function JobsProvider({ page, children }: { page: string; children: ReactNode }) {
  const toast = useToast();
  const [summary, setSummary] = useState<JobsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<JobsSummary | null>(null);
  const listeners = useRef(new Set<Listener>());
  const onPage = useRef(page);
  onPage.current = page;

  const receive = useCallback(
    (next: JobsSummary) => {
      const events = seen.current ? finishedBetween(seen.current, next) : [];
      seen.current = next;
      // finished work may have changed reference data that pages hold (web/answers.ts), so they must ask again
      if (events.length > 0) clearAnswers();
      setSummary(next);
      setError(null);
      for (const event of events) {
        listeners.current.forEach((listener) => listener(event));
        if (showsResult(event, onPage.current)) continue;
        const { message, error: failed, href } = announcement(event);
        toast(message, failed ? { kind: 'error', href } : { href });
      }
    },
    [toast],
  );

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  // the browser opens the stream again by itself after a failure, and the app starts it with the whole summary
  useEffect(() => {
    const stream = new EventSource(jobsContract.stream.path);
    stream.onmessage = (event) => receive(JSON.parse(event.data) as JobsSummary);
    stream.onerror = () => setError('Lost the connection to the app.');
    return () => stream.close();
  }, [receive]);

  return <JobsContext.Provider value={{ summary, error, subscribe }}>{children}</JobsContext.Provider>;
}

/** Where the background work stands. */
export const useJobs = (): Jobs => useContext(JobsContext);

/** Calls `onFinished` when work of `kind` that was running has finished or failed, so the page can load what it produced. */
export function useJobFinished(kind: JobKind, onFinished: (event: JobEvent) => void): void {
  const { subscribe } = useJobs();
  const latest = useRef(onFinished);
  latest.current = onFinished;
  useEffect(() => subscribe((event) => event.kind === kind && latest.current(event)), [subscribe, kind]);
}

/**
 * Calls `refetch` when the picture queue of `kind` changed since this page last looked (a picture was added, went on, was read, failed or
 * left), so a page that shows the queue asks for its details only when there is something new. The first answer is not a change.
 */
export function useJobChange(kind: 'roster' | 'battle', refetch: () => void): void {
  const signature = useJobs().summary?.[kind].signature;
  const last = useRef<string | undefined>(undefined);
  const latest = useRef(refetch);
  latest.current = refetch;
  useEffect(() => {
    const before = last.current;
    last.current = signature;
    if (before !== undefined && signature !== undefined && before !== signature) latest.current();
  }, [signature]);
}
