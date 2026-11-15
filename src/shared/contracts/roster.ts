import { z } from 'zod';
import type { Rules } from '../api.js';
import { endpoint } from '../contract.js';

/** A standard hero with what the roster of a profile says of it. */
export const Hero = z.object({
  name: z.string(),
  tier: z.enum(['R', 'A', 'S']).nullable(),
  class: z.string().nullable(),
  faction: z.string().nullable(),
  damageType: z.string().nullable(),
  imagePath: z.string().nullable(),
  owned: z.boolean(),
  rank: z.string().nullable(),
  equipmentLevel: z.number().nullable(),
});
export type Hero = z.infer<typeof Hero>;

const HERO_STATE_MESSAGE = 'rank must be a string or null and equipmentLevel a number or null';
/** A hero's rank and equipment level on the roster; whether they are allowed for its tier is checked against the rules. */
export const HeroStateBody = z.object({ rank: z.string({ error: HERO_STATE_MESSAGE }).nullish(), equipmentLevel: z.number({ error: HERO_STATE_MESSAGE }).nullish() }, { error: HERO_STATE_MESSAGE });

/** `?profile=` names the profile a roster request is about (an id or a name); the default profile when left out. */
const forProfile = z.object({ profile: z.string().optional() });

export const rosterContract = {
  rules: endpoint({ method: 'GET', path: '/api/reference', response: z.custom<Rules>() }),
  heroes: endpoint({ method: 'GET', path: '/api/heroes', query: forProfile, response: z.array(Hero) }),
  save: endpoint({
    method: 'PUT',
    path: '/api/roster/:name',
    query: forProfile,
    body: HeroStateBody,
    response: z.object({ name: z.string(), owned: z.literal(true), rank: z.string().nullable(), equipmentLevel: z.number().nullable() }),
  }),
  remove: endpoint({ method: 'DELETE', path: '/api/roster/:name', query: forProfile, response: z.undefined(), status: 204 }),
  /** Wipes the roster of one profile (the default unless told otherwise). */
  reset: endpoint({ method: 'POST', path: '/api/roster/reset', query: forProfile, response: z.undefined(), status: 204 }),
};
