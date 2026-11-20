import type Database from 'better-sqlite3';
import { agentCommand, agentReply, validateAgentSettings, type AgentCommand, type AgentRequest } from '../../domain/agent.js';
import { fail, type Failure } from '../contract.js';
import { loadAgentSettings } from './agent-settings.js';
import type { AgentSlot } from './agent-slot.js';

/** Runs an agent command to the end and resolves with the text it printed. Rejects when it fails or is aborted. */
export type AgentRunner = (command: AgentCommand, options: { timeoutMs: number; signal: AbortSignal }) => Promise<string>;

/** What every background job of the Agent keeps: whether it still runs, and why it failed. */
export interface AgentJobState {
  state: 'running' | 'done' | 'failed';
  error?: string;
}

/**
 * Starts the Agent on `request` in the background and returns at once. The job is the caller's object, already `running`: it turns `done`
 * when `save` accepts the Agent's reply (`save` returns the reason it cannot keep it, or nothing), and `failed` with an error when the reply
 * is empty, cannot be kept, or the run fails or is aborted. The Agent runs one thing at a time (the slot), so a start while it is busy is refused.
 * Answers the reason the run could not start, or the job.
 */
export function startAgentJob<J extends AgentJobState>(
  db: Database.Database,
  runner: AgentRunner,
  slot: AgentSlot,
  request: AgentRequest,
  job: J,
  save: (reply: string) => string | null | void,
  signal: AbortSignal = new AbortController().signal,
): J | Failure {
  if (slot.busy || slot.importing > 0) return fail(409, 'The agent is already running on something else');
  // The settings may come from a restored backup, so they are checked again here.
  const settings = loadAgentSettings(db);
  const invalid = validateAgentSettings(settings);
  if (invalid) return fail(400, `The saved agent settings are not usable: ${invalid}`);
  const command = agentCommand(settings.preset, settings.model, request);
  if ('error' in command) return fail(500, command.error);
  slot.busy = true;
  runner(command, { timeoutMs: settings.timeoutMinutes * 60 * 1000, signal })
    .finally(() => (slot.busy = false))
    .then(
      (text) => {
        const reply = agentReply(settings.preset, text);
        const error = reply === '' ? 'The agent returned an empty reply' : save(reply);
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
  return job;
}

/** What a client sees of a job: its state, and the error when it failed. */
export const publicJob = <J extends AgentJobState>({ state, error }: J) => (error === undefined ? { state } : { state, error });
