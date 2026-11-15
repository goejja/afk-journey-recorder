import { z } from 'zod';
import { endpoint } from '../contract.js';

const NEW_NAME = 'Give the new name of the tag';

/** A tag in use with how many records carry it. */
export const TagCount = z.object({ tag: z.string(), count: z.number() });
export type TagCount = z.infer<typeof TagCount>;

export const tagsContract = {
  /** Every tag in use, for suggestions and filters. */
  list: endpoint({ method: 'GET', path: '/api/tags', response: z.array(TagCount) }),
  /** Renaming onto a tag that already exists merges the two; records that carry both keep one. */
  rename: endpoint({
    method: 'PUT',
    path: '/api/tags/:tag',
    body: z.object({ name: z.string({ error: NEW_NAME }) }, { error: NEW_NAME }),
    response: z.object({ name: z.string(), records: z.number() }),
  }),
  /** Removes the tag from every record; the records themselves stay. */
  remove: endpoint({ method: 'DELETE', path: '/api/tags/:tag', response: z.object({ removed: z.number() }) }),
};
