import { z } from 'zod';
import { endpoint } from '../contract.js';

export const battlesContract = {
  /** Removes a battle; its fights stay as fights on their own, unless `fights=delete` asks for them to go too. */
  remove: endpoint({ method: 'DELETE', path: '/api/battles/:id', query: z.object({ fights: z.string().optional() }), response: z.undefined(), status: 204 }),
};
