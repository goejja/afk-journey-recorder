import { z } from 'zod';
import type { Deployment } from '../../domain/layout.js';
import { endpoint } from '../contract.js';

const CODE_MESSAGE = 'A Formation ID is 8 characters: digits or capital letters';

/** A Formation ID in the library: the deployment it stands for, the maps it was seen on and the records that carry it. */
export const FormationIdEntry = z.object({
  code: z.string(),
  deployment: z.custom<Deployment>(),
  maps: z.array(z.string()),
  records: z.number(),
});
export type FormationIdEntry = z.infer<typeof FormationIdEntry>;

/** A code and the deployment it stands for; the teams are checked unit by unit by the server. */
const NewCodeBody = z.object({ code: z.string({ error: CODE_MESSAGE }).optional(), deployment: z.custom<Deployment>().optional() }, { error: CODE_MESSAGE });

export const formationIdsContract = {
  list: endpoint({ method: 'GET', path: '/api/formation-ids', response: z.array(FormationIdEntry) }),
  create: endpoint({ method: 'POST', path: '/api/formation-ids', body: NewCodeBody, response: FormationIdEntry, status: 201 }),
  remove: endpoint({ method: 'DELETE', path: '/api/formation-ids/:code', response: z.undefined(), status: 204 }),
};
