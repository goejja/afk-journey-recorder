import { z } from 'zod';
import type { JobsSummary } from '../api.js';
import { endpoint } from '../contract.js';

export const jobsContract = {
  /** The background work of the app in one answer: the scenario runs, the Review explanation and the two picture queues. */
  list: endpoint({ method: 'GET', path: '/api/jobs', response: z.custom<JobsSummary>() }),
  /**
   * The same answer pushed as Server-Sent Events (`serveStream`, `watch`): one event as the stream opens and one each time any of the work
   * changes, so a client never has to ask when work starts.
   */
  stream: endpoint({ method: 'GET', path: '/api/jobs/stream', response: z.custom<JobsSummary>() }),
};
