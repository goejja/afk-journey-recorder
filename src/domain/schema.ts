import { z } from 'zod';

/**
 * Helpers for the schemas that describe what the API takes. A schema sits in the domain module of the rule it states, so the server
 * checks a request with it and the web app and the query CLI use its type; its messages are the ones the player reads.
 */

/** The message of the first thing wrong with a value, or null when the schema takes it. */
export function problemWith(schema: z.ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Invalid request');
}

/** A finite number from `min` to `max`, with one message for a missing value, another type and one out of range. */
export const numberFrom = (min: number, max: number, message: string) => z.number({ error: message }).finite(message).min(min, message).max(max, message);

/** A whole number from `min` to `max`, likewise. */
export const integerFrom = (min: number, max: number, message: string) => z.number({ error: message }).int(message).min(min, message).max(max, message);
