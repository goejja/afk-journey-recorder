import { z } from 'zod';
import { AgentSettingsSchema } from '../../domain/agent.js';
import type { AgentJob, AgentSettings } from '../api.js';
import { endpoint } from '../contract.js';

const Settings = z.custom<AgentSettings>();
const Job = z.custom<AgentJob>();

export const agentContract = {
  get: endpoint({ method: 'GET', path: '/api/admin/agent', response: Settings }),
  save: endpoint({ method: 'PUT', path: '/api/admin/agent', body: AgentSettingsSchema, response: Settings }),
  /** Looks for the installed agent programs and the models they offer; it runs programs, so only when asked. */
  refresh: endpoint({ method: 'POST', path: '/api/admin/agent/refresh', response: Settings }),
  /** Starts the agent on a scenario in the background; answers at once with the running job. */
  run: endpoint({ method: 'POST', path: '/api/scenarios/:id/run', response: Job, status: 202 }),
  /** The scenarios that have a job, for one poll of the whole page; a scenario without one is idle. */
  runs: endpoint({ method: 'GET', path: '/api/scenarios/runs', response: z.record(z.string(), Job) }),
  cancel: endpoint({ method: 'POST', path: '/api/scenarios/:id/run/cancel', response: Job }),
};
