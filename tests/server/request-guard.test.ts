import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';
import { limitParam } from '../../src/server/params.js';

const app = () => createApp(openDb(':memory:'));

describe('request guard', () => {
  it('refuses a change a page of another site could send without permission', async () => {
    const a = app();
    const cases: Record<string, string>[] = [{}, { 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }, { 'content-type': 'multipart/form-data; boundary=x' }];
    for (const headers of cases) {
      const response = await a.request('/api/roster/reset', { method: 'POST', headers });
      expect(response.status).toBe(400);
    }
  });

  it('lets the app through with its header or a content type that needs a preflight', async () => {
    const a = app();
    expect((await a.request('/api/roster/reset', { method: 'POST', headers: { 'x-afk-action': 'app' } })).status).toBe(204);
    expect((await a.request('/api/roster/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(204);
  });

  it('answers only to this machine by name', async () => {
    const a = app();
    expect((await a.request('/api/seasons', { headers: { host: '127.0.0.1:3000' } })).status).toBe(200);
    expect((await a.request('/api/seasons', { headers: { host: 'localhost:3000' } })).status).toBe(200);
    expect((await a.request('/api/seasons', { headers: { host: 'evil.example:3000' } })).status).toBe(403);
  });
});

describe('limitParam', () => {
  const limit = (value: string | undefined) => limitParam({ req: { query: () => value } } as unknown as Context);

  it('is a whole number from 1 up, and never means no limit', () => {
    expect(limit('25')).toBe(25);
    expect(limit('2.9')).toBe(2);
    expect(limit('999999999')).toBe(100000);
    for (const bad of ['-1', '0', 'abc', '', undefined]) expect(limit(bad), String(bad)).toBeUndefined();
  });
});
