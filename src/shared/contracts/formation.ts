import { z } from 'zod';

/** A saved formation of one side, as the server reads it. */
export const FormationJson = z.object({
  artifact: z.string().nullable(),
  heroes: z.array(z.object({ tile: z.number(), name: z.string(), part: z.string(), rank: z.string().nullable(), equipmentLevel: z.number().nullable() })),
  phantimal: z.object({ name: z.string(), tile: z.number(), partnerTile: z.number().optional() }).nullable(),
  assist: z.object({ name: z.string(), rank: z.string().nullable(), equipmentLevel: z.number().nullable() }).nullable(),
  formationId: z.string().nullable(),
});
export type FormationJson = z.infer<typeof FormationJson>;
