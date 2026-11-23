import { describe, expect, it } from 'vitest';
import { describeUsage, refuseUsed } from '../../src/server/reference/usage.js';

describe('what uses a catalog item', () => {
  it('lists what is used, in the singular for one, and leaves out what is not', () => {
    expect(describeUsage([{ label: 'records', count: 3 }, { label: 'stages', count: 0 }, { label: 'reader pictures', one: 'reader picture', count: 1 }])).toBe('3 records, 1 reader picture');
    expect(describeUsage([{ label: 'records', count: 1 }])).toBe('1 record');
    expect(describeUsage([{ label: 'records', count: 0 }])).toBe('');
  });

  it('refuses a delete with a 409 that says what uses the item, and not one that nothing uses', () => {
    expect(refuseUsed('Zanie', [{ label: 'records', count: 2 }])).toMatchObject({ status: 409, error: 'Zanie is used by 2 records, so it cannot be deleted' });
    expect(refuseUsed('Zanie', [{ label: 'records', count: 0 }])).toBeNull();
  });
});
