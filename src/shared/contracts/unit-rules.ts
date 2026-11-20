import { z } from 'zod';
import { endpoint } from '../contract.js';

/** The pairs, summons and second parts the player declared, which the web app needs to place and check units like the server does. */
const UnitRules = z.object({
  pairs: z.record(z.string(), z.tuple([z.string(), z.string()]).readonly()),
  summons: z.record(z.string(), z.object({ part: z.string(), count: z.number() })),
  phantimalParts: z.record(z.string(), z.string()),
});

export const unitRulesContract = {
  get: endpoint({ method: 'GET', path: '/api/unit-rules', response: UnitRules }),
};
