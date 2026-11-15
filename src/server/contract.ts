import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { Upload, type Endpoint, type ServerInput } from '../shared/contract.js';
import { parseBody } from './request.js';

/** A handler answers with this when the request cannot be served; `fail` makes one. */
export class Failure {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 415 | 422 | 500,
    readonly error: string,
  ) {}
}
export const fail = (status: Failure['status'], error: string) => new Failure(status, error);

/** A handler answers with this when it made something new on a route that otherwise answers 200 (find or create): the answer is 201. */
export class Created<T> {
  constructor(readonly value: T) {}
}
export const created = <T>(value: T) => new Created(value);

/** A file a handler sends: the bytes with their type, and any extra headers (a download's name, how long to cache). */
export class FileAnswer {
  constructor(
    readonly bytes: Uint8Array,
    readonly contentType: string,
    readonly headers: Record<string, string> = {},
  ) {}
}
export const file = (bytes: Uint8Array, contentType: string, headers: Record<string, string> = {}) => new FileAnswer(bytes, contentType, headers);

/** What a handler returns: the response, a `fail`, and nothing at all for a route that answers nothing. */
type Answer<E extends Endpoint> = z.output<E['response']> | Created<z.output<E['response']>> | Failure | (undefined extends z.output<E['response']> ? void : never) | (z.output<E['response']> extends Uint8Array ? FileAnswer : never);

/**
 * Registers the handler of a route described in `src/shared/contract.ts`. The body is read with the route's schema (a bad one is
 * answered with its message, as `parseBody` does), the handler returns what the route answers or a `fail`, and what it returns must fit
 * the response schema: the compiler checks the type, and outside production the value is checked too, so a row that does not fit
 * answers 500 with the reason and a test that calls the route fails.
 */
export function serve<E extends Endpoint>(app: Hono, route: E, handler: (input: ServerInput<E>, c: Context) => Answer<E> | Promise<Answer<E>>): void {
  app.on(route.method, route.path, async (c) => {
    let body: unknown;
    if (route.body && route.body !== Upload) {
      const parsed = await parseBody(c, route.body, route.badBody);
      if ('response' in parsed) return parsed.response;
      body = parsed.data;
    }
    const answered = await handler({ params: c.req.param(), body } as unknown as ServerInput<E>, c);
    if (answered instanceof FileAnswer) return c.body(answered.bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': answered.contentType, ...answered.headers });
    const result = answered instanceof Created ? answered.value : answered;
    const status = answered instanceof Created ? 201 : route.status;
    if (result instanceof Failure) return c.json({ error: result.error }, result.status);
    if (status === 204) return c.body(null, 204);
    if (process.env.NODE_ENV !== 'production') {
      const checked = route.response.safeParse(result);
      if (!checked.success) {
        console.error(`${route.method} ${route.path} answered something its contract does not allow:`, checked.error.issues);
        return c.json({ error: `The answer of ${route.method} ${route.path} does not fit its contract: ${checked.error.issues[0]?.message ?? 'unknown'}` }, 500);
      }
    }
    return c.json(result as object, status);
  });
}
