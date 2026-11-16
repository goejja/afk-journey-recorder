import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { upsertSingleton } from '../../src/server/db-helpers.js';

describe('upsertSingleton', () => {
  it('saves the one row of a settings table, then replaces it', () => {
    const db = openDb(':memory:');
    upsertSingleton(db, 'agent_setting', { preset: 'claude', model: 'sonnet', timeout_minutes: 10 });
    expect(db.prepare('SELECT preset, model, timeout_minutes AS timeoutMinutes FROM agent_setting WHERE id = 1').get()).toEqual({ preset: 'claude', model: 'sonnet', timeoutMinutes: 10 });

    upsertSingleton(db, 'agent_setting', { preset: 'codex', model: 'gpt', timeout_minutes: 20 });
    expect(db.prepare('SELECT COUNT(*) FROM agent_setting').pluck().get()).toBe(1);
    expect(db.prepare('SELECT preset, model, timeout_minutes AS timeoutMinutes FROM agent_setting WHERE id = 1').get()).toEqual({ preset: 'codex', model: 'gpt', timeoutMinutes: 20 });
  });

  it('writes a one-column table', () => {
    const db = openDb(':memory:');
    upsertSingleton(db, 'update_setting', { updated_on: '2026-11-01' });
    upsertSingleton(db, 'update_setting', { updated_on: '2026-11-09' });
    expect(db.prepare('SELECT updated_on FROM update_setting').pluck().all()).toEqual(['2026-11-09']);
  });
});
