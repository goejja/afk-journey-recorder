import { z } from 'zod';
import { SeasonNumberSchema } from '../../domain/season.js';
import { endpoint } from '../contract.js';

/** A season in the list of Admin > General, with how many stages and phantimals name it. */
export const SeasonEntry = z.object({ number: z.number(), current: z.boolean(), stages: z.number(), phantimals: z.number() });
export type SeasonEntry = z.infer<typeof SeasonEntry>;

const Seasons = z.array(SeasonEntry);

export const seasonsContract = {
  list: endpoint({ method: 'GET', path: '/api/seasons', response: Seasons }),
  add: endpoint({ method: 'POST', path: '/api/seasons', body: z.object({ number: SeasonNumberSchema }, { error: 'A season is a whole number from 1 to 999' }), response: Seasons, status: 201 }),
  setCurrent: endpoint({ method: 'PUT', path: '/api/seasons/current', body: z.object({ number: z.number({ error: 'Unknown season' }) }, { error: 'Unknown season' }), response: Seasons, badBody: 404 }),
  remove: endpoint({ method: 'DELETE', path: '/api/seasons/:number', response: Seasons }),
};
