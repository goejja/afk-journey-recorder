import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { problemWith } from '../../src/domain/schema.js';
import { validateAgentSettings } from '../../src/domain/agent.js';
import { validateStatsModes } from '../../src/domain/stats.js';
import { parseBody } from '../../src/server/request.js';

describe('parseBody', () => {
  const app = new Hono();
  const Body = z.object({ n: z.number({ error: 'n is a number' }) }, { error: 'Send an object' });
  app.post('/x', async (c) => {
    const parsed = await parseBody(c, Body);
    if ('response' in parsed) return parsed.response;
    return c.json({ doubled: parsed.data.n * 2 });
  });
  const post = (body: BodyInit | undefined) => app.request('/x', { method: 'POST', body, headers: { 'content-type': 'application/json' } });

  it('hands the parsed body to the route', async () => {
    expect(await (await post('{"n": 2, "extra": true}')).json()).toEqual({ doubled: 4 });
  });

  it('answers 400 with the schema\'s message for a wrong field, a missing body and text that is not JSON', async () => {
    for (const body of ['{"n": "2"}', '{}', undefined, 'not json', 'null']) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(body === '{"n": "2"}' || body === '{}' ? 'n is a number' : 'Send an object');
    }
  });
});

describe('the validators the schemas stand behind', () => {
  it('statistics modes: a list of known modes, empty allowed', () => {
    expect(validateStatsModes([])).toBeNull();
    expect(validateStatsModes(['Arena', 'Stage'])).toBeNull();
    expect(validateStatsModes('Arena')).toBe('Give the modes as a list');
    expect(validateStatsModes(['Arena', 'Chess'])).toBe('Unknown mode "Chess"');
    expect(validateStatsModes([3])).toBe('Unknown mode 3');
  });

  it('agent settings: preset, model name and time limit', () => {
    const ok = { preset: 'claude', model: 'sonnet', timeoutMinutes: 10 };
    expect(validateAgentSettings(ok)).toBeNull();
    expect(validateAgentSettings(null)).toBe('Send the agent settings');
    expect(validateAgentSettings({ ...ok, preset: 'nope' })).toMatch(/^The agent must be one of /);
    expect(validateAgentSettings({ ...ok, model: '--flag' })).toMatch(/^The model name may only use/);
    expect(validateAgentSettings({ ...ok, timeoutMinutes: 1.5 })).toMatch(/^The time limit must be a whole number/);
    expect(validateAgentSettings({ ...ok, timeoutMinutes: 500 })).toMatch(/^The time limit must be a whole number/);
  });

  it('problemWith is null for a value the schema takes', () => {
    expect(problemWith(z.string(), 'x')).toBeNull();
  });
});
