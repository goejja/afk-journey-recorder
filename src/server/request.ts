import type { Context } from 'hono';
import type { z } from 'zod';
import { problemWith } from '../domain/schema.js';

/**
 * The JSON body of a request as the schema reads it, or the response that says what is wrong with it (400 unless another `status` is
 * asked for). A body that is missing or not JSON is read as null, so the schema's own message for a body that is not an object is
 * what the player sees.
 *
 *     const parsed = await parseBody(c, SomeSchema);
 *     if ('response' in parsed) return parsed.response;
 */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S, status: 400 | 404 | 409 | 422 = 400): Promise<{ data: z.output<S> } | { response: Response }> {
  const body: unknown = await c.req.json().catch(() => null);
  const result = schema.safeParse(body);
  if (result.success) return { data: result.data };
  return { response: c.json({ error: problemWith(schema, body) }, status) };
}
