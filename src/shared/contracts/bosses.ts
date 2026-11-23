import { z } from 'zod';
import { BossBodySchema } from '../../domain/boss.js';
import { endpoint } from '../contract.js';

/** A boss as Admin > Units > Bosses lists it and the Dream Hunt and Titan Reaver forms choose it. */
export const Boss = z.object({
  name: z.string(),
  class: z.string().nullable(),
  damageType: z.string().nullable(),
  /** How many Dream Hunt attempts fought it: Dream Hunt orders and opens on the bosses that have some. */
  attempts: z.number(),
  source: z.enum(['import', 'manual']),
  /** Made here while the import's source lacked it: the next import takes it over when the source lists it (#297). */
  handMade: z.boolean(),
  /** What uses it, as a sentence ("3 Dream Hunt records, 1 Weekly default slot"), empty when nothing does, and how many things that is. */
  usedBy: z.string(),
  uses: z.number(),
});
export type Boss = z.infer<typeof Boss>;

export const bossesContract = {
  list: endpoint({ method: 'GET', path: '/api/bosses', response: z.array(Boss) }),
  create: endpoint({ method: 'POST', path: '/api/bosses', body: BossBodySchema, response: Boss, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/bosses/:name', body: BossBodySchema, response: Boss }),
  remove: endpoint({ method: 'DELETE', path: '/api/bosses/:name', response: z.undefined(), status: 204 }),
};
