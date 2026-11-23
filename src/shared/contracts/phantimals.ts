import { z } from 'zod';
import { PhantimalBodySchema } from '../../domain/phantimal.js';
import { endpoint } from '../contract.js';

export const Phantimal = z.object({
  name: z.string(),
  /** The name of the second part it stands on, when it stands on two tiles. */
  part: z.string().nullable(),
  faction: z.string().nullable(),
  class: z.string().nullable(),
  seasons: z.array(z.number()),
  source: z.enum(['import', 'manual']),
});
export type Phantimal = z.infer<typeof Phantimal>;

/** What puts a phantimal on a team, which fixes how it stands. */
export const PhantimalUsage = z.object({ records: z.number(), deployments: z.number(), placements: z.number() });
export type PhantimalUsage = z.infer<typeof PhantimalUsage>;

export const phantimalsContract = {
  usage: endpoint({ method: 'GET', path: '/api/phantimals/:name/usage', response: PhantimalUsage }),
  list: endpoint({ method: 'GET', path: '/api/phantimals', response: z.array(Phantimal) }),
  create: endpoint({ method: 'POST', path: '/api/phantimals', body: PhantimalBodySchema, response: Phantimal, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/phantimals/:name', body: PhantimalBodySchema, response: Phantimal }),
  remove: endpoint({ method: 'DELETE', path: '/api/phantimals/:name', response: z.undefined(), status: 204 }),
};
