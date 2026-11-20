import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { saveEstimate } from '../../db/scenario-estimate.js';
import { newAgentSlot, type AgentSlot } from './agent-slot.js';
import { publicJob, startAgentJob, type AgentJobState, type AgentRunner } from './agent-job.js';
import type { JobRegistry } from './job-registry.js';
import { hasId } from '../db-helpers.js';
import { agentContract } from '../../shared/contracts/agent.js';
import { fail, Failure, serve } from '../contract.js';

export type { AgentRunner };

type Job = AgentJobState;

/**
 * Routes that start the agent on a scenario in the background and report how it went. The agent only reads;
 * this saves its reply as the scenario's estimate. Job state is kept in memory, so a restart begins idle.
 */
export function scenarioRunRoutes(db: Database.Database, runner: AgentRunner, slot: AgentSlot = newAgentSlot(), registry?: JobRegistry): Hono {
  const app = new Hono();
  const jobs = new Map<number, Job>();
  const controllers = new Map<number, AbortController>();

  serve(app, agentContract.run, ({ params }) => {
    const id = Number(params.id);
    if (!hasId(db, 'scenario', id)) return fail(404, 'Unknown scenario');
    const job: Job = { state: 'running' };
    const controller = new AbortController();
    const started = startAgentJob(db, runner, slot, { id }, job, (estimate) => saveEstimate(db, id, estimate), controller.signal);
    if (started instanceof Failure) return started;
    jobs.set(id, job);
    controllers.set(id, controller);
    return publicJob(job);
  });

  // The scenarios that have a job, for one poll of the whole page; a scenario without one is idle.
  registry?.register('scenarios', () => Object.fromEntries([...jobs].map(([id, job]) => [id, publicJob(job)])));

  serve(app, agentContract.cancel, ({ params }) => {
    const id = Number(params.id);
    if (jobs.get(id)?.state !== 'running') return fail(409, 'Nothing is running on this scenario');
    controllers.get(id)?.abort();
    return { state: 'running' as const };
  });

  return app;
}
