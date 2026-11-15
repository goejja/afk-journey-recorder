import { z } from 'zod';

export const MAX_PROFILE_NAME_LENGTH = 40;
export const MAX_PLAYER_ID_LENGTH = 40;

/** A profile name: spaces collapsed and trimmed, 1 to 40 characters. */
export const ProfileNameSchema = z
  .string({ error: 'A profile needs a name' })
  .transform((name) => name.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'A profile needs a name').max(MAX_PROFILE_NAME_LENGTH, `A profile name is at most ${MAX_PROFILE_NAME_LENGTH} characters`));

/**
 * A Player ID (the player's id in the game), sent as text or a number: trimmed, and empty means none (null). Left out it stays undefined,
 * so a caller can tell "leave it as it is" from "remove it".
 */
export const PlayerIdSchema = z
  .union([z.string(), z.number()], { error: 'The player ID must be text' })
  .nullable()
  .optional()
  .transform((id) => (id === undefined ? undefined : id === null ? null : String(id).trim()))
  .pipe(z.string().max(MAX_PLAYER_ID_LENGTH, `A player ID is at most ${MAX_PLAYER_ID_LENGTH} characters`).nullable().optional())
  .transform((id) => (id === '' ? null : id));

/** A profile named by its id or its name; anything else reads as an id no profile has, so the route answers "unknown profile". */
export const ProfileRefSchema = z.union([z.number(), z.string()]).nullish().catch(-1);

/** What a new profile is made with; `copyFrom` names a profile whose heroes it starts with. */
export const NewProfileSchema = z.object(
  { name: ProfileNameSchema, playerId: PlayerIdSchema.transform((id) => id ?? null), copyFrom: ProfileRefSchema },
  { error: 'A profile needs a name' },
);

/** What a profile is changed with: the name and the Player ID given are changed, the ones left out are kept. */
export const ProfileChangeSchema = z.object({ name: ProfileNameSchema.optional(), playerId: PlayerIdSchema }, { error: 'A profile needs a name' });

/** A Seen name given to a profile. */
export const SeenNameSchema = z.object({ name: ProfileNameSchema }, { error: 'A profile needs a name' });

/** The profile another one is merged into. */
export const MergeSchema = z.object({ into: ProfileRefSchema }, { error: 'Unknown profile to merge into' });
