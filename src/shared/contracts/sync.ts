import { z } from 'zod';
import type { SyncState } from '../api.js';
import { endpoint } from '../contract.js';

const SyncRequest = z.object(
  {
    source: z.enum(['all', 'reference', 'artifact-images', 'game-icons'], { error: 'source must be all, reference, artifact-images or game-icons' }),
    refresh: z.boolean({ error: 'refresh must be true or false' }).default(false),
    overwrite: z.boolean({ error: 'overwrite must be true or false' }).default(false),
  },
  { error: 'Give the source to sync' },
);
const State = z.custom<SyncState>();

export const syncContract = {
  /** The sources that can be synced and how the last run of each went. */
  state: endpoint({ method: 'GET', path: '/api/admin/sync', response: State }),
  /** Starts a sync of one source or of all of them in the background; answers at once. Refused with 409 while another runs. */
  start: endpoint({ method: 'POST', path: '/api/admin/sync', body: SyncRequest, response: State, status: 202 }),
};
