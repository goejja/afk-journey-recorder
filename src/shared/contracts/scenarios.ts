import { z } from 'zod';
import { ScenarioBodySchema } from '../../domain/scenario.js';
import type { Scenario } from '../api.js';
import { endpoint } from '../contract.js';

const Planned = z.custom<Scenario>();

export const scenariosContract = {
  list: endpoint({ method: 'GET', path: '/api/scenarios', response: z.array(Planned) }),
  create: endpoint({ method: 'POST', path: '/api/scenarios', body: ScenarioBodySchema, response: Planned, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/scenarios/:id', body: ScenarioBodySchema, response: Planned }),
  remove: endpoint({ method: 'DELETE', path: '/api/scenarios/:id', response: z.undefined(), status: 204 }),
};
