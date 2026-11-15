import { z } from 'zod';
import { MergeSchema, NewProfileSchema, ProfileChangeSchema, SeenNameSchema } from '../../domain/profile.js';
import { endpoint } from '../contract.js';

/** A named roster of one player; the default one feeds the Stage and Dream Hunt forms. */
export const Profile = z.object({
  id: z.number(),
  name: z.string(),
  /** The player's id in the game, when known. */
  playerId: z.string().nullable(),
  isDefault: z.boolean(),
  heroCount: z.number(),
  /** The spellings pictures gave this Profile and that were resolved to it (ADR 0021). */
  seenNames: z.array(z.string()).optional(),
});
export type Profile = z.infer<typeof Profile>;

const Profiles = z.array(Profile);

export const profilesContract = {
  list: endpoint({ method: 'GET', path: '/api/profiles', response: Profiles }),
  /** A new profile starts empty, or with the heroes of another profile when `copyFrom` names one (id or name). */
  create: endpoint({ method: 'POST', path: '/api/profiles', body: NewProfileSchema, response: Profile, status: 201 }),
  update: endpoint({ method: 'PUT', path: '/api/profiles/:id', body: ProfileChangeSchema, response: Profile }),
  /** The spellings a picture gave this Profile (ADR 0021). Answers the Seen names the Profile has now. */
  addName: endpoint({ method: 'POST', path: '/api/profiles/:id/names', body: SeenNameSchema, response: z.array(z.string()), status: 201 }),
  /** Moves the default to this profile; there is always exactly one. */
  setDefault: endpoint({ method: 'POST', path: '/api/profiles/:id/default', response: Profiles }),
  /** Merges this profile into another (`into`: id or name). */
  merge: endpoint({ method: 'POST', path: '/api/profiles/:id/merge', body: MergeSchema, response: Profiles }),
  remove: endpoint({ method: 'DELETE', path: '/api/profiles/:id', response: z.undefined(), status: 204 }),
};
