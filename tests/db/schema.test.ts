import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';

describe('schema', () => {
  it('is idempotent when opened twice on the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afk-'));
    const file = join(dir, 'test.db');
    openDb(file).close();
    const db = openDb(file);
    expect(db.prepare('SELECT count(*) FROM map').pluck().get()).toBe(0);
  });

  it('rejects an unknown source value', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.prepare("INSERT INTO rank (name, position, source) VALUES ('X', 0, 'scraped')").run(),
    ).toThrow();
  });
});
