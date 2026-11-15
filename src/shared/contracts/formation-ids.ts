import { z } from 'zod';
import type { Deployment, LayoutMatch } from '../../domain/layout.js';
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

/** A stored code that covers the teams asked for, with how they match. */
export const FormationIdMatch = FormationIdEntry.extend({ match: z.custom<LayoutMatch>() });

/** The teams of a deployment to look up the codes of; anything else looks up nothing. */
const FindBody = z.object({ teams: z.array(z.unknown()).optional() }).catch({});

/** A code and the deployment it stands for; the teams are checked unit by unit by the server. */
export const NewCodeBody = z.object({ code: z.string({ error: CODE_MESSAGE }).optional(), deployment: z.custom<Deployment>().optional() }, { error: CODE_MESSAGE });

export const formationIdsContract = {
  list: endpoint({ method: 'GET', path: '/api/formation-ids', response: z.array(FormationIdEntry) }),
  find: endpoint({ method: 'POST', path: '/api/formation-ids/find', body: FindBody, response: z.array(FormationIdMatch) }),
  create: endpoint({ method: 'POST', path: '/api/formation-ids', body: NewCodeBody, response: FormationIdEntry, status: 201 }),
  remove: endpoint({ method: 'DELETE', path: '/api/formation-ids/:code', response: z.undefined(), status: 204 }),
};
