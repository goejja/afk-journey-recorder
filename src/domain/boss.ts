import { z } from 'zod';
import { DAMAGE_TYPES, HERO_CLASSES } from './hero-admin.js';

const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

/** What a boss is created or changed with. The class and damage type are the game's, as a hero's; either may be left empty. */
export const BossBodySchema = z.object(
  {
    name: z.string({ error: 'A boss name must be text' }).trim().min(1, 'A boss name cannot be empty'),
    class: optional(z.enum(HERO_CLASSES, { error: `Class must be one of ${HERO_CLASSES.join(', ')}` })),
    damageType: optional(z.enum(DAMAGE_TYPES, { error: 'Damage type must be Physical or Magic' })),
  },
  { error: 'A boss needs a name' },
);
export type BossBody = z.output<typeof BossBodySchema>;
export type BossInput = z.input<typeof BossBodySchema>;
