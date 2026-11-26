import { Hono } from 'hono';
import type { AgentJob, ImportQueueSummary, JobsSummary, ReviewExplainJob, SyncSummary } from '../../shared/api.js';
import { jobsContract } from '../../shared/contracts/jobs.js';
import { serve, serveStream } from '../contract.js';

/** How each kind of background work says where it stands. */
interface JobSources {
  scenarios: () => Record<string, AgentJob>;
  review: () => ReviewExplainJob | null;
  roster: () => ImportQueueSummary | Promise<ImportQueueSummary>;
  battle: () => ImportQueueSummary | Promise<ImportQueueSummary>;
  sync: () => SyncSummary;
}

/**
 * Where the background work of the app is listed (docs/ui-conventions.md, "Background work"): each kind registers how it says where it
 * stands, and one answer tells a client everything that runs, so a client asks once, not once for each kind. A kind that is not registered
 * is idle.
 */
export interface JobRegistry {
  register<K extends keyof JobSources>(kind: K, source: JobSources[K]): void;
  summary(): Promise<JobsSummary>;
  /**
   * Calls `listener` with where the jobs stand now, and again whenever that changes, until the returned function is called. The
   * registry looks only while someone listens, so a kind of work never has to say that it changed.
   */
  subscribe(listener: (summary: JobsSummary) => void): () => void;
}

/** How often the registry looks for a change while someone listens. */
export const JOBS_LOOK_MS = 500;

const IDLE_QUEUE: ImportQueueSummary = { active: 0, failed: 0, done: 0, signature: '' };
const IDLE_SYNC: SyncSummary = { running: false, lastRunId: 0, failed: false };

export function newJobRegistry(): JobRegistry {
  const sources: Partial<JobSources> = {};
  const listeners = new Set<(summary: JobsSummary) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = '';
  let looking = false;

  const registry: JobRegistry = {
    register(kind, source) {
      (sources as Record<string, unknown>)[kind] = source;
    },
    async summary() {
      return {
        scenarios: sources.scenarios?.() ?? {},
        review: sources.review?.() ?? null,
        roster: (await sources.roster?.()) ?? IDLE_QUEUE,
        battle: (await sources.battle?.()) ?? IDLE_QUEUE,
        sync: sources.sync?.() ?? IDLE_SYNC,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      void registry.summary().then((summary) => {
        // what the first listener was told is not told again by the next look
        if (listeners.size === 1 && last === '') last = JSON.stringify(summary);
        listener(summary);
      }, () => undefined);
      timer ??= setInterval(look, JOBS_LOOK_MS);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        clearInterval(timer);
        timer = undefined;
        last = '';
      };
    },
  };

  // one look at a time: a slow answer is not asked again before it came
  async function look() {
    if (looking) return;
    looking = true;
    try {
      const summary = await registry.summary();
      const text = JSON.stringify(summary);
      if (text === last) return;
      last = text;
      listeners.forEach((listener) => listener(summary));
    } catch {
      // the next look tries again
    } finally {
      looking = false;
    }
  }
  return registry;
}

/** The pictures of an import queue in short; the signature is every picture's id and state, in order. */
export const queueSummary = (queue: { id: number; state: 'queued' | 'running' | 'done' | 'failed' }[]): ImportQueueSummary => ({
  active: queue.filter((j) => j.state === 'queued' || j.state === 'running').length,
  failed: queue.filter((j) => j.state === 'failed').length,
  done: queue.filter((j) => j.state === 'done').length,
  signature: queue.map((j) => `${j.id}:${j.state}`).join(','),
});

export function jobRoutes(registry: JobRegistry): Hono {
  const app = new Hono();
  serve(app, jobsContract.list, () => registry.summary());
  serveStream(app, jobsContract.stream, registry.subscribe);
  return app;
}
