import { z } from 'zod';
import { SeasonNumberSchema } from '../../domain/season.js';
import { endpoint } from '../contract.js';

/** A season in the list of Admin > General, with its Season Phase and how many stages, phantimals, records and Tournaments name it. */
export const SeasonEntry = z.object({ number: z.number(), current: z.boolean(), phase: z.number(), stages: z.number(), phantimals: z.number(), records: z.number(), tournaments: z.number() });
export type SeasonEntry = z.infer<typeof SeasonEntry>;

const Seasons = z.array(SeasonEntry);

export const seasonsContract = {
  list: endpoint({ method: 'GET', path: '/api/seasons', response: Seasons }),
  add: endpoint({ method: 'POST', path: '/api/seasons', body: z.object({ number: SeasonNumberSchema }, { error: 'A season is a whole number from 1 to 999' }), response: Seasons, status: 201 }),
  setCurrent: endpoint({ method: 'PUT', path: '/api/seasons/current', body: z.object({ number: z.number({ error: 'Unknown season' }) }, { error: 'Unknown season' }), response: Seasons, badBody: 404 }),
  /** Sets the Season Phase of the current Season by hand (lowering is allowed). Changing it empties the Titan Reaver setup. */
  setPhase: endpoint({ method: 'PUT', path: '/api/seasons/current/phase', body: z.object({ phase: z.number().int().min(1).max(3) }, { error: 'The Season Phase must be 1, 2 or 3' }), response: Seasons }),
  remove: endpoint({ method: 'DELETE', path: '/api/seasons/:number', response: Seasons }),
};
