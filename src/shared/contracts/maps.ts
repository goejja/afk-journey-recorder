import { z } from 'zod';
import { MapBodySchema } from '../../domain/map.js';
import { endpoint } from '../contract.js';

export const GameMap = z.object({
  name: z.string(),
  tags: z.array(z.string()),
  rowLengths: z.array(z.number()),
  cells: z.array(z.number()),
  source: z.enum(['import', 'manual']),
  /** An edited import can go back to its scraped version. */
  canRestore: z.boolean(),
});
export type GameMap = z.infer<typeof GameMap>;

export const mapsContract = {
  list: endpoint({ method: 'GET', path: '/api/maps', response: z.array(GameMap) }),
  get: endpoint({ method: 'GET', path: '/api/maps/:name', response: GameMap }),
  create: endpoint({ method: 'POST', path: '/api/maps', body: MapBodySchema, response: GameMap, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/maps/:name', body: MapBodySchema, response: GameMap }),
  duplicate: endpoint({ method: 'POST', path: '/api/maps/:name/duplicate', body: z.object({ name: MapBodySchema.shape.name }, { error: 'A map needs a name' }), response: GameMap, status: 201 }),
  restore: endpoint({ method: 'POST', path: '/api/maps/:name/restore', response: GameMap }),
  remove: endpoint({ method: 'DELETE', path: '/api/maps/:name', response: z.undefined(), status: 204 }),
};
