import { z } from 'zod';
import { endpoint } from '../contract.js';

/** The corrected rank and equipment of some heroes on one side of some records. */
export const StatesBody = z.object(
  {
    attemptIds: z.array(z.number().int(), { error: 'Name the records to correct' }).min(1, 'Name the records to correct'),
    side: z.enum(['A', 'B'], { error: 'The side must be A or B' }),
    heroes: z
      .array(
        z.object(
          {
            hero: z.string({ error: 'Every hero needs a name' }),
            rank: z.string({ error: 'The rank must be text or empty' }).nullish().transform((rank) => rank ?? null),
            equipmentLevel: z.number({ error: 'The equipment level must be a number or empty' }).nullish().transform((level) => level ?? null),
          },
          { error: 'Every hero needs a name' },
        ),
        { error: 'Name the heroes to correct' },
      )
      .min(1, 'Name the heroes to correct'),
  },
  { error: 'Name the records to correct' },
);

export const recordStatesContract = {
  /** Sets the state of some heroes on one side of some records. A hero a record does not hold is left out of it. */
  setHeroStates: endpoint({ method: 'POST', path: '/api/records/hero-states', body: StatesBody, response: z.object({ corrected: z.number() }) }),
};
