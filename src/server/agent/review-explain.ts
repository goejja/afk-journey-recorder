import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { newAgentSlot, type AgentSlot } from './agent-slot.js';
import { startAgentJob, type AgentJobState, type AgentRunner } from './agent-job.js';
import type { JobRegistry } from './job-registry.js';
import { reviewContract } from '../../shared/contracts/review.js';
import { fail, Failure, serve } from '../contract.js';

interface Job extends AgentJobState {
  runId: number;
}

/** What a client sees of a job. */
const publicJob = ({ runId, state, error }: Job) => (error === undefined ? { runId, state } : { runId, state, error });

/**
 * Routes that ask the Agent to explain a Review run in the background (ADR 0032). The Agent only reads: it ranks the findings and suggests
 * causes, and this keeps its reply on the run. Job state is kept in memory, so a restart begins idle.
 */
export function reviewExplainRoutes(db: Database.Database, runner: AgentRunner, slot: AgentSlot = newAgentSlot(), registry?: JobRegistry): Hono {
  const app = new Hono();
  let job: Job | null = null;

  serve(app, reviewContract.explain, ({ params }) => {
    const runId = Number(params.id);
    const exists = db.prepare('SELECT 1 FROM review_run WHERE id = ?').pluck().get(runId) !== undefined;
    if (!exists) return fail(404, 'Unknown review run');
    const current: Job = { runId, state: 'running' };
    const started = startAgentJob(db, runner, slot, { reviewRun: runId }, current, (explanation) => {
      db.prepare("UPDATE review_run SET explanation = ?, explained_at = datetime('now') WHERE id = ?").run(explanation, runId);
    });
    if (started instanceof Failure) return started;
    job = current;
    return publicJob(current);
  });

  registry?.register('review', () => (job ? publicJob(job) : null));

  return app;
}
