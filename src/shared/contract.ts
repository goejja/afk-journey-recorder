import { z } from 'zod';

/**
 * One route of the HTTP API, described once: its method, its path, the schema of the body it takes and the schema of what it answers.
 * The server registers its handler through `serve` (src/server/contract.ts) and the web app calls it through `call` (web/backend.ts), so
 * both sides read the same definition and the types of the body and the answer come from the schemas.
 */
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Endpoint<P extends string = string, B extends z.ZodType | undefined = z.ZodType | undefined, R extends z.ZodType = z.ZodType, Q extends z.ZodType | undefined = z.ZodType | undefined> {
  method: Method;
  path: P;
  /** What the request body must be; none for a route without a body. */
  body: B;
  /**
   * The query parameters the route reads, as text or lists of text (a repeated parameter is a list). They type the client's call and
   * build its URL; the server does not check them, its handler reads them from the request (`listParam`, `limitParam`) and ignores
   * what it does not know.
   */
  query: Q;
  /** What the route answers when it succeeds. */
  response: R;
  /** The status of a success: 200 unless the route creates something (201) or answers nothing (204, with `z.undefined()` as its response) or only starts the work (202). */
  status: 200 | 201 | 202 | 204;
  /** The status a body the schema refuses is answered with. */
  badBody: 400 | 404 | 409 | 422;
}

export function endpoint<P extends string, R extends z.ZodType, B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(spec: {
  method: Method;
  path: P;
  body?: B;
  query?: Q;
  response: R;
  status?: Endpoint['status'];
  badBody?: Endpoint['badBody'];
}): Endpoint<P, B, R, Q> {
  return { method: spec.method, path: spec.path, body: spec.body as B, query: spec.query as Q, response: spec.response, status: spec.status ?? 200, badBody: spec.badBody ?? 400 };
}

/**
 * The body of a route that takes a file (an image, a backup) as its raw bytes, not JSON. The client sends the file with its own type; the
 * handler reads the bytes from the request, since `serve` leaves the body alone for this schema.
 */
export const Upload = z.custom<Blob>((value) => typeof Blob !== 'undefined' && value instanceof Blob);

/** The response of a route that sends a file: its handler answers with `file(...)` (src/server/contract.ts), and the web app uses `urlOf` to point an element at it. */
export const Binary = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

/** The names of the `:name` segments of a path. */
export type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}` ? Name | ParamNames<`/${Rest}`> : P extends `${string}:${infer Name}` ? Name : never;

type ParamsInput<P extends string> = [ParamNames<P>] extends [never] ? unknown : { params: Record<ParamNames<P>, string> };
type BodyInput<B extends z.ZodType | undefined, Side extends 'in' | 'out'> = B extends z.ZodType ? { body: Side extends 'in' ? z.input<B> : z.output<B> } : unknown;

type QueryInput<Q extends z.ZodType | undefined> = Q extends z.ZodType ? { query?: z.input<Q> } : unknown;

/** What a caller of the route gives: the values of its path parameters, its query and its body. */
export type ClientInput<E extends Endpoint> = ParamsInput<E['path']> & QueryInput<E['query']> & BodyInput<E['body'], 'in'>;
/** What the handler of the route receives: the values of its path parameters and its body as the schema read it. */
export type ServerInput<E extends Endpoint> = ParamsInput<E['path']> & BodyInput<E['body'], 'out'>;

/** The path with its parameters filled in and encoded for a URL. */
export function pathOf(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
}

/** `a=1&b=x&b=y` for a query of text and lists of text; empty values are left out, and a comma stays readable (`ids=1,2,3`). */
export function queryStringOf(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) for (const one of [value ?? ''].flat()) if (one !== '') params.append(name, one);
  return params.toString().replaceAll('%2C', ',');
}

/** The URL of a route with its path parameters and query filled in, for an `<img src>` or a link to a file. */
export function urlOf(route: Pick<Endpoint, 'path'>, input: { params?: Record<string, string>; query?: Record<string, string | string[] | undefined> } = {}): string {
  const search = input.query ? queryStringOf(input.query) : '';
  return pathOf(route.path, input.params) + (search ? `?${search}` : '');
}
