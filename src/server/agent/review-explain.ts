import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { agentCommand, agentReply, validateAgentSettings } from '../../domain/agent.js';
import { loadAgentSettings } from './agent-settings.js';
import { newAgentSlot, type AgentSlot } from './agent-slot.js';
import type { AgentRunner } from './scenario-run.js';
import { reviewContract } from '../../shared/contracts/review.js';
import { fail, serve } from '../contract.js';

interface Job {
  runId: number;
  state: 'running' | 'done' | 'failed';
  error?: string;
}

/** What a client sees of a job. */
const publicJob = ({ runId, state, error }: Job) => (error === undefined ? { runId, state } : { runId, state, error });

/**
 * Routes that ask the Agent to explain a Review run in the background (ADR 0032). The Agent only reads: it ranks the findings and suggests
 * causes, and this keeps its reply on the run. Job state is kept in memory, so a restart begins idle.
 */
export function reviewExplainRoutes(db: Database.Database, runner: AgentRunner, slot: AgentSlot = newAgentSlot()): Hono {
  const app = new Hono();
  let job: Job | null = null;

  serve(app, reviewContract.explain, ({ params }) => {
    const runId = Number(params.id);
    const exists = db.prepare('SELECT 1 FROM review_run WHERE id = ?').pluck().get(runId) !== undefined;
    if (!exists) return fail(404, 'Unknown review run');
    if (slot.busy || slot.importing > 0) return fail(409, 'The agent is already running on something else');
    // The settings may come from a restored backup, so they are checked again here.
    const settings = loadAgentSettings(db);
    const invalid = validateAgentSettings(settings);
    if (invalid) return fail(400, `The saved agent settings are not usable: ${invalid}`);
    const command = agentCommand(settings.preset, settings.model, { reviewRun: runId });
    if ('error' in command) return fail(500, command.error);
    const current: Job = { runId, state: 'running' };
    job = current;
    slot.busy = true;
    runner(command, { timeoutMs: settings.timeoutMinutes * 60 * 1000, signal: new AbortController().signal }).finally(() => (slot.busy = false)).then(
      (text) => {
        const explanation = agentReply(settings.preset, text);
        if (explanation === '') {
          current.state = 'failed';
          current.error = 'The agent returned an empty reply';
          return;
        }
        db.prepare("UPDATE review_run SET explanation = ?, explained_at = datetime('now') WHERE id = ?").run(explanation, runId);
        current.state = 'done';
      },
      (error) => {
        current.state = 'failed';
        current.error = error instanceof Error ? error.message : String(error);
      },
    );
    return publicJob(current);
  });

  serve(app, reviewContract.explainJob, () => (job ? publicJob(job) : null));

  return app;
}
