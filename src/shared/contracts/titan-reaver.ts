import { z } from 'zod';
import type { TitanReaverBattle, TitanReaverBattleInput } from '../api.js';
import { endpoint, queryText as text, queryTexts as texts } from '../contract.js';

// The body is typed, not checked by the schema: the handler checks it field by field and keeps its own messages.
const BattleBody = z.custom<TitanReaverBattleInput>();
const Battle = z.custom<TitanReaverBattle>();

/** The records of Titan Reaver (#278), apart from its setup (`titanReaverContract` in defaults.ts). */
export const titanReaverBattlesContract = {
  list: endpoint({ method: 'GET', path: '/api/titan-reaver/battles', query: z.object({ season: text, seasonPhase: text, titanPhase: text, tag: texts, limit: text }), response: z.array(Battle) }),
  get: endpoint({ method: 'GET', path: '/api/titan-reaver/battles/:id', response: Battle }),
  create: endpoint({ method: 'POST', path: '/api/titan-reaver/battles', body: BattleBody, response: Battle, status: 201 }),
  update: endpoint({ method: 'PUT', path: '/api/titan-reaver/battles/:id', body: BattleBody, response: Battle }),
  remove: endpoint({ method: 'DELETE', path: '/api/titan-reaver/battles/:id', response: z.undefined(), status: 204 }),
};
