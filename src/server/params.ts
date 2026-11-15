import type { Context } from 'hono';

/** The values of a repeated query parameter (`?mode=Arena&mode=Guild Duel`) without the empty ones; undefined when none is given. */
export function listParam(c: Context, name: string): string[] | undefined {
  const values = (c.req.queries(name) ?? []).filter((v) => v !== '');
  return values.length > 0 ? values : undefined;
}

/** The `limit` query parameter as a whole number from 1 to `max`; undefined when absent or not positive, so `limit=-1` never reaches SQLite as "no limit". */
export function limitParam(c: Context, max = 100000): number | undefined {
  const n = Math.floor(Number(c.req.query('limit')));
  return n >= 1 ? Math.min(n, max) : undefined;
}

/** `column IN (?, ?, ...)` for the chosen values, to add to a WHERE clause with `params`. */
export function anyOf(column: string, values: string[]): { clause: string; params: string[] } {
  return { clause: `${column} IN (${values.map(() => '?').join(', ')})`, params: values };
}
