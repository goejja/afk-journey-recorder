import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { agentCommand, agentReply, validateAgentSettings, type AgentCommand } from '../../domain/agent.js';
import { saveEstimate } from '../../db/scenario-estimate.js';
import { newAgentSlot, type AgentSlot } from './agent-slot.js';
import { loadAgentSettings } from './agent-settings.js';
import { hasId } from '../db-helpers.js';
import { agentContract } from '../../shared/contracts/agent.js';
import { fail, serve } from '../contract.js';

/** Runs an agent command to the end and resolves with the text it printed. Rejects when it fails or is aborted. */
export type AgentRunner = (command: AgentCommand, options: { timeoutMs: number; signal: AbortSignal }) => Promise<string>;

interface Job {
  state: 'running' | 'done' | 'failed';
  error?: string;
}

/** What a client sees of a job. */
const publicJob = ({ state, error }: Job) => (error === undefined ? { state } : { state, error });

/**
 * Routes that start the agent on a scenario in the background and report how it went. The agent only reads;
 * this saves its reply as the scenario's estimate. Job state is kept in memory, so a restart begins idle.
 */
export function scenarioRunRoutes(db: Database.Database, runner: AgentRunner, slot: AgentSlot = newAgentSlot()): Hono {
  const app = new Hono();
  const jobs = new Map<number, Job>();
  const controllers = new Map<number, AbortController>();

  serve(app, agentContract.run, ({ params }) => {
    const id = Number(params.id);
    if (!hasId(db, 'scenario', id)) return fail(404, 'Unknown scenario');
    if (slot.busy || slot.importing > 0) return fail(409, 'The agent is already running on something else');
    // The settings may come from a restored backup, so they are checked again here.
    const settings = loadAgentSettings(db);
    const invalid = validateAgentSettings(settings);
    if (invalid) return fail(400, `The saved agent settings are not usable: ${invalid}`);
    const command = agentCommand(settings.preset, settings.model, { id });
    if ('error' in command) return fail(500, command.error);
    const job: Job = { state: 'running' };
    slot.busy = true;
    const controller = new AbortController();
    jobs.set(id, job);
    controllers.set(id, controller);
    runner(command, { timeoutMs: settings.timeoutMinutes * 60 * 1000, signal: controller.signal }).finally(() => (slot.busy = false)).then(
      (text) => {
        const estimate = agentReply(settings.preset, text);
        if (estimate === '') {
          job.state = 'failed';
          job.error = 'The agent returned an empty reply';
          return;
        }
        const error = saveEstimate(db, id, estimate);
        if (error) {
          job.state = 'failed';
          job.error = error;
          return;
        }
        job.state = 'done';
      },
      (error) => {
        job.state = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      },
    );
    return publicJob(job);
  });

  // The scenarios that have a job, for one poll of the whole page; a scenario without one is idle.
  serve(app, agentContract.runs, () => Object.fromEntries([...jobs].map(([id, job]) => [id, publicJob(job)])));

  serve(app, agentContract.cancel, ({ params }) => {
    const id = Number(params.id);
    if (jobs.get(id)?.state !== 'running') return fail(409, 'Nothing is running on this scenario');
    controllers.get(id)?.abort();
    return { state: 'running' as const };
  });

  return app;
}
