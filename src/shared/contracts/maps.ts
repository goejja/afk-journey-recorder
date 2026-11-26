import { z } from 'zod';
import { MapBodySchema } from '../../domain/map.js';
import { endpoint } from '../contract.js';

export const GameMap = z.object({
  name: z.string(),
  tags: z.array(z.string()),
  rowLengths: z.array(z.number()),
  cells: z.array(z.number()),
  /** The deployment tiles that boost the unit on them (#220), as tile numbers. */
  boostTiles: z.array(z.number()),
  source: z.enum(['import', 'manual']),
  /** Drawn here while the import's source lacked it: the next import takes it over when the source lists it (#297). */
  handMade: z.boolean(),
  /** An edited import can go back to its scraped version. */
  canRestore: z.boolean(),
});
export type GameMap = z.infer<typeof GameMap>;

/** How many records of each mode or event use a map; Titan Reaver fights have no map, so its count is always 0. */
export const MapUses = z.object({
  /** The Stages on the map and the records saved on them. */
  stages: z.object({ stages: z.number(), records: z.number() }),
  arena: z.number(),
  ideas: z.number(),
  dreamHunt: z.number(),
  titanReaver: z.number(),
  /** Scenarios planned on the map; they are not records, but they keep it from being deleted. */
  scenarios: z.number(),
});
export type MapUses = z.infer<typeof MapUses>;

export const mapsContract = {
  list: endpoint({ method: 'GET', path: '/api/maps', response: z.array(GameMap) }),
  create: endpoint({ method: 'POST', path: '/api/maps', body: MapBodySchema, response: GameMap, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/maps/:name', body: MapBodySchema, response: GameMap }),
  duplicate: endpoint({ method: 'POST', path: '/api/maps/:name/duplicate', body: z.object({ name: MapBodySchema.shape.name }, { error: 'A map needs a name' }), response: GameMap, status: 201 }),
  restore: endpoint({ method: 'POST', path: '/api/maps/:name/restore', response: GameMap }),
  /** How many records of each mode use the map. */
  uses: endpoint({ method: 'GET', path: '/api/maps/:name/uses', response: MapUses }),
  /** Points the Stages that use the map at another map; Stage records keep their placements, which may need checking. */
  moveStages: endpoint({ method: 'POST', path: '/api/maps/:name/move-stages', body: z.object({ to: z.string({ error: 'Give the map to move the stages to' }) }, { error: 'Give the map to move the stages to' }), response: z.object({ moved: z.number() }) }),
  remove: endpoint({ method: 'DELETE', path: '/api/maps/:name', response: z.undefined(), status: 204 }),
};
