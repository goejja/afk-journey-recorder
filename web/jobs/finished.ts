import type { JobsSummary } from '../backend.js';

/** A piece of background work that was running when the app last asked and has since finished or failed. */
export type JobEvent =
  | { kind: 'scenario'; id: number; state: 'done' | 'failed'; error?: string }
  | { kind: 'review'; id: number; state: 'done' | 'failed'; error?: string }
  /** The pictures of an import queue that finished being read since the last look: `count` were read, or could not be. */
  | { kind: 'roster' | 'battle'; state: 'done' | 'failed'; count: number };

export type JobKind = JobEvent['kind'];

/** What went from running to finished between two looks. Work found finished on arrival was not seen running, so it is not here. */
export function finishedBetween(before: JobsSummary, after: JobsSummary): JobEvent[] {
  const events: JobEvent[] = [];
  for (const [key, job] of Object.entries(after.scenarios)) {
    if (before.scenarios[key]?.state === 'running' && job.state !== 'running' && job.state !== 'idle') {
      events.push({ kind: 'scenario', id: Number(key), state: job.state, ...(job.error === undefined ? {} : { error: job.error }) });
    }
  }
  const was = before.review;
  const now = after.review;
  if (was?.state === 'running' && now && now.runId === was.runId && now.state !== 'running') {
    events.push({ kind: 'review', id: now.runId, state: now.state, ...(now.error === undefined ? {} : { error: now.error }) });
  }
  for (const kind of ['roster', 'battle'] as const) {
    const was = before[kind];
    const now = after[kind];
    // a queue that was reading and is not any more: what it gained in read and in failed pictures is what it just finished
    if (was.active > 0 && now.active === 0) {
      if (now.done > was.done) events.push({ kind, state: 'done', count: now.done - was.done });
      if (now.failed > was.failed) events.push({ kind, state: 'failed', count: now.failed - was.failed });
    }
  }
  return events;
}

/** The page of the app that shows the result of each kind of work: a person already there sees it without a toast. */
const RESULT_PAGE: Record<JobKind, string> = { scenario: 'arena', review: 'admin', roster: 'roster', battle: 'arena' };

export const showsResult = (event: JobEvent, page: string) => RESULT_PAGE[event.kind] === page;

/** The toast for a finished piece of work. */
export function announcement(event: JobEvent): { message: string; error: boolean; href: string } {
  const href = `#${RESULT_PAGE[event.kind]}`;
  if ('count' in event) {
    const pictures = `${event.count} picture${event.count === 1 ? '' : 's'}`;
    const where = event.kind === 'roster' ? 'Roster' : 'PvP';
    return event.state === 'done'
      ? { message: `${pictures} read: ready to review in ${where}.`, error: false, href }
      : { message: `${pictures} could not be read: see the import in ${where}.`, error: true, href };
  }
  if (event.kind === 'scenario') {
    return event.state === 'done'
      ? { message: `Scenario ${event.id} has an answer.`, error: false, href }
      : { message: `The Agent could not finish scenario ${event.id}: ${event.error ?? 'it failed'}`, error: true, href };
  }
  return event.state === 'done'
    ? { message: 'The Agent explained the review.', error: false, href }
    : { message: `The Agent could not explain the review: ${event.error ?? 'it failed'}`, error: true, href };
}
