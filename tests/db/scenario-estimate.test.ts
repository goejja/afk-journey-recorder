import { describe, expect, it } from 'vitest';
import { saveEstimate } from '../../src/db/scenario-estimate.js';
import { openDb } from '../../src/db/open.js';
import { MAX_ESTIMATE_LENGTH } from '../../src/domain/scenario.js';

describe('saveEstimate', () => {
  const setup = () => {
    const db = openDb(':memory:');
    const id = Number(db.prepare("INSERT INTO scenario (name, mode) VALUES ('S', 'Arena')").run().lastInsertRowid);
    return { db, id };
  };
  const stored = (db: ReturnType<typeof openDb>, id: number) => db.prepare('SELECT estimate FROM scenario WHERE id = ?').pluck().get(id);

  it('saves trimmed text, clears on empty text and refuses one that is too long or for no scenario', () => {
    const { db, id } = setup();
    expect(saveEstimate(db, id, '  Try Alna  ')).toBeNull();
    expect(stored(db, id)).toBe('Try Alna');
    expect(saveEstimate(db, id, 'x'.repeat(MAX_ESTIMATE_LENGTH + 1))).toMatch(/at most/);
    expect(stored(db, id)).toBe('Try Alna');
    expect(saveEstimate(db, 999, 'text')).toMatch(/No scenario/);
    expect(saveEstimate(db, id, '')).toBeNull();
    expect(stored(db, id)).toBeNull();
  });
});
