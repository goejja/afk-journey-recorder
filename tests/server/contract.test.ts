import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Binary, endpoint, pathOf, queryStringOf, Upload, urlOf } from '../../src/shared/contract.js';
import { created, fail, file, serve } from '../../src/server/contract.js';

const item = endpoint({
  method: 'PUT',
  path: '/api/items/:id',
  body: z.object({ name: z.string({ error: 'Give a name' }) }, { error: 'Give a name' }),
  response: z.object({ id: z.string(), count: z.number() }),
});

const send = (app: Hono, body: unknown, id = 'a b') => app.request(`/api/items/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('serve', () => {
  it('hands the handler the decoded path parameters and the body as the schema read it, and answers its value', async () => {
    const app = new Hono();
    serve(app, item, ({ params, body }) => ({ id: params.id, count: body.name.length }));
    const response = await send(app, { name: 'four' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'a b', count: 4 });
  });

  it('answers a body the schema refuses with the schema message, without calling the handler', async () => {
    const app = new Hono();
    const handler = vi.fn(() => ({ id: 'x', count: 0 }));
    serve(app, item, handler);
    const response = await send(app, { name: 3 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Give a name' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers a fail with its status and message', async () => {
    const app = new Hono();
    serve(app, item, () => fail(404, 'Unknown item'));
    const response = await send(app, { name: 'x' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown item' });
  });

  it('answers 500 outside production when the value does not fit the response schema', async () => {
    const app = new Hono();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // the compiler refuses this value; the cast stands for a database row of another shape
    serve(app, item, () => ({ id: 'x', count: '4' }) as unknown as { id: string; count: number });
    const response = await send(app, { name: 'x' });
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toMatch(/does not fit its contract/);
    log.mockRestore();
  });

  it('answers 201 when the handler says it created something on a route that answers 200', async () => {
    const app = new Hono();
    serve(app, item, ({ body }) => (body.name === 'new' ? created({ id: 'n', count: 1 }) : { id: 'o', count: 0 }));
    expect((await send(app, { name: 'new' })).status).toBe(201);
    expect((await send(app, { name: 'old' })).status).toBe(200);
  });

  it('refuses at compile time a handler that answers the wrong shape', () => {
    const app = new Hono();
    // @ts-expect-error `count` must be a number
    serve(app, item, () => ({ id: 'x', count: '4' }));
  });
});

describe('pathOf', () => {
  it('fills and encodes the parameters of a path', () => {
    expect(pathOf('/api/tags/:tag', { tag: 'a/b c' })).toBe('/api/tags/a%2Fb%20c');
    expect(pathOf('/api/tags')).toBe('/api/tags');
  });
});

describe('queryStringOf', () => {
  it('writes text and repeated values, and leaves out the empty ones', () => {
    expect(queryStringOf({ season: '8', kind: ['Normal', 'Apex Normal'], tag: '', limit: undefined })).toBe('season=8&kind=Normal&kind=Apex+Normal');
  });
});

describe('files', () => {
  const picture = endpoint({ method: 'GET', path: '/api/pictures/:name', response: Binary });
  const sendPicture = endpoint({ method: 'PUT', path: '/api/pictures/:name', body: Upload, response: z.object({ size: z.number() }) });

  it('sends the bytes of a file with its type and headers, and a fail as an error', async () => {
    const app = new Hono();
    serve(app, picture, ({ params }) => (params.name === 'a' ? file(new Uint8Array([1, 2, 3]), 'image/png', { 'cache-control': 'no-cache' }) : fail(404, 'No picture')));
    const found = await app.request('/api/pictures/a');
    expect(found.headers.get('content-type')).toBe('image/png');
    expect(found.headers.get('cache-control')).toBe('no-cache');
    expect([...new Uint8Array(await found.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await app.request('/api/pictures/b')).status).toBe(404);
  });

  it('leaves the body of an upload to the handler', async () => {
    const app = new Hono();
    serve(app, sendPicture, async (_, c) => ({ size: (await c.req.arrayBuffer()).byteLength }));
    const response = await app.request('/api/pictures/a', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3, 4]) });
    expect(await response.json()).toEqual({ size: 4 });
  });

  it('writes the URL of a route with its parameters and query', () => {
    expect(urlOf(picture, { params: { name: 'a b' }, query: { v: '2' } })).toBe('/api/pictures/a%20b?v=2');
  });
});
