import { z } from 'zod';
import { RECORD_MODES } from './arena.js';

const AGE_MESSAGE = 'Give the age in whole days, at least 1';
const MODE_MESSAGE = `The mode must be one of ${RECORD_MODES.join(', ')}`;

/**
 * Which records a cleanup covers. An age is required so nothing is removed by accident; the mode and the tag are optional, and an
 * empty one means every mode or every tag.
 */
export const CleanupSelectionSchema = z.object(
  {
    olderThanDays: z.number({ error: AGE_MESSAGE }).int(AGE_MESSAGE).min(1, AGE_MESSAGE),
    mode: z
      .unknown()
      .optional()
      .transform((mode) => mode || undefined)
      .refine((mode) => mode === undefined || (RECORD_MODES as readonly unknown[]).includes(mode), MODE_MESSAGE)
      .transform((mode) => mode as string | undefined),
    tag: z.unknown().optional().transform((tag) => (typeof tag === 'string' && tag.trim() !== '' ? tag.trim() : undefined)),
  },
  { error: AGE_MESSAGE },
);

export type CleanupSelection = z.infer<typeof CleanupSelectionSchema>;

/** A selection with the number of records the person saw in the preview and agreed to remove. */
export const CleanupDeleteSchema = CleanupSelectionSchema.extend({
  expectedCount: z.number({ error: 'Preview first, then confirm the number of records' }).int('Preview first, then confirm the number of records'),
});
