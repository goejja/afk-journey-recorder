import { z } from 'zod';
import { unitName } from './hero-admin.js';

const text = (message: string) => z.string({ error: message }).nullish().transform((value) => value ?? null);

/**
 * What a phantimal is created or changed with: a name (trimmed), an optional faction and class, the seasons it is offered in and,
 * when it stands on two tiles, the name of its second part. `part` left out keeps the part it has; null takes it away.
 */
export const PhantimalBodySchema = z.object(
  {
    name: z.string({ error: 'A phantimal needs a name' }).trim().min(1, 'A phantimal needs a name'),
    faction: text('Faction must be text or empty'),
    class: text('Class must be text or empty'),
    part: unitName('A second part name').nullish(),
    seasons: z.array(z.number({ error: 'Seasons must be a list of whole numbers from 1' }).int('Seasons must be a list of whole numbers from 1').min(1, 'Seasons must be a list of whole numbers from 1'), { error: 'Seasons must be a list of whole numbers from 1' }),
  },
  { error: 'A phantimal needs a name' },
);
