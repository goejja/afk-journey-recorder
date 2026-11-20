import { z } from 'zod';
import { endpoint } from '../contract.js';

const DAY_MESSAGE = 'The update date is a day written YYYY-MM-DD';

/** A real calendar day written YYYY-MM-DD. */
const DaySchema = z.object(
  {
    date: z.string({ error: DAY_MESSAGE }).refine((text) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
      const day = new Date(`${text}T00:00:00Z`);
      return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(text);
    }, DAY_MESSAGE),
  },
  { error: DAY_MESSAGE },
);

/** The day of the latest game update, or null when none was set. */
const UpdateDate = z.object({ date: z.string().nullable() });

export const updateDateContract = {
  get: endpoint({ method: 'GET', path: '/api/update-date', response: UpdateDate }),
  save: endpoint({ method: 'PUT', path: '/api/update-date', body: DaySchema, response: UpdateDate }),
  reset: endpoint({ method: 'DELETE', path: '/api/update-date', response: UpdateDate }),
};
