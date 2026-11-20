import { readFileSync, statSync } from 'node:fs';
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
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
class Created<T> {
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

/** A handler answers with this when the browser's copy of a file is still the current one: 304, no body. */
export class NotModified {
  constructor(readonly headers: Record<string, string> = {}) {}
}

/**
 * A picture the browser asks about on every use and keeps while it is unchanged. The ETag is the file's size and modification time,
 * so a file that was replaced is never shown stale, and one that was not costs a few hundred bytes instead of the whole picture.
 */
export function revalidated(c: Context, path: string, contentType: string): FileAnswer | NotModified {
  const { size, mtimeMs } = statSync(path);
  const etag = `W/"${size}-${mtimeMs}"`;
  const headers = { 'cache-control': 'no-cache', etag };
  const asked = (c.req.header('if-none-match') ?? '').split(',').map((tag) => tag.trim());
  if (asked.includes(etag)) return new NotModified(headers);
  return file(new Uint8Array(readFileSync(path)), contentType, headers);
}

/**
 * Reads an uploaded body of at most `max` bytes, or answers 413 with `tooLarge`. A declared length over the limit is refused before
 * anything is read, and a body that declares less (or nothing) is cut off as soon as it has sent more than `max`.
 */
export async function readUpload(c: Context, max: number, tooLarge: string): Promise<Buffer | Failure> {
  if (Number(c.req.header('content-length')) > max) return fail(413, tooLarge);
  const reader = c.req.raw.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return fail(413, tooLarge);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** What a handler returns: the response, a `fail`, and nothing at all for a route that answers nothing. */
type Answer<E extends Endpoint> = z.output<E['response']> | Created<z.output<E['response']>> | Failure | (undefined extends z.output<E['response']> ? void : never) | (z.output<E['response']> extends Uint8Array ? FileAnswer | NotModified : never);

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
    if (answered instanceof NotModified) return c.body(null, 304, answered.headers);
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

/** How often a quiet stream sends a comment, so nothing between the app and the browser closes it as idle. */
export const STREAM_HEARTBEAT_MS = 15_000;

/**
 * Registers a route that pushes what `subscribe` gives it as Server-Sent Events (one JSON event each), until the client leaves. `subscribe`
 * calls `send` with each value and returns the function that stops it. A route like this has no body and no status: it is described with
 * `endpoint` only so that both sides read its path and the type of what it pushes.
 */
export function serveStream<E extends Endpoint>(app: Hono, route: E, subscribe: (send: (value: z.output<E['response']>) => void) => () => void): void {
  app.get(route.path, (c) =>
    streamSSE(c, async (stream) => {
      const left = new Promise<void>((resolve) => stream.onAbort(resolve));
      const stop = subscribe((value) => void stream.writeSSE({ data: JSON.stringify(value) }).catch(() => undefined));
      const beat = setInterval(() => void stream.write(': keep-alive\n\n').catch(() => undefined), STREAM_HEARTBEAT_MS);
      await left;
      clearInterval(beat);
      stop();
    }),
  );
}
