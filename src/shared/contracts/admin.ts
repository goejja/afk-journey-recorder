import { z } from 'zod';
import { Binary, endpoint, Upload } from '../contract.js';

export const adminContract = {
  /** The whole database, to keep as a backup. */
  backup: endpoint({ method: 'GET', path: '/api/admin/backup', response: Binary }),
  /**
   * Replaces every record with the ones in an uploaded backup. The current data is first saved next to the database, so a wrong
   * restore can be undone.
   */
  restore: endpoint({ method: 'POST', path: '/api/admin/restore', body: Upload, response: z.object({ restoredRows: z.number(), savedAs: z.string().nullable() }) }),
};
