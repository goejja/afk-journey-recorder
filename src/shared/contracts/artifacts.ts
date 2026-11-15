import { z } from 'zod';
import { ArtifactBodySchema } from '../../domain/artifact.js';
import { endpoint } from '../contract.js';

/** An artifact; the Artifacts menu also shows where it comes from and how many records use it. */
export const Artifact = z.object({ name: z.string(), group: z.string(), source: z.enum(['import', 'manual']).optional(), uses: z.number().optional() });
export type Artifact = z.infer<typeof Artifact>;

export const artifactsContract = {
  list: endpoint({ method: 'GET', path: '/api/artifacts', response: z.array(Artifact) }),
  create: endpoint({ method: 'POST', path: '/api/artifacts', body: ArtifactBodySchema, response: Artifact, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/artifacts/:name', body: ArtifactBodySchema, response: Artifact }),
  remove: endpoint({ method: 'DELETE', path: '/api/artifacts/:name', response: z.undefined(), status: 204 }),
};
