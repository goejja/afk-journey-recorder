import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isStronger } from '../../src/domain/hero-state.js';
import { fileCache } from '../../src/server/file-cache.js';

describe('fileCache', () => {
  it('computes once while the file is unchanged, and again after it is rewritten', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'afk-cache-')), 'a.png');
    writeFileSync(file, 'one');
    const compute = vi.fn((bytes: Buffer) => bytes.toString());
    const cached = fileCache<string>();
    expect(cached(file, compute)).toBe('one');
    expect(cached(file, compute)).toBe('one');
    expect(compute).toHaveBeenCalledTimes(1);
    writeFileSync(file, 'two!');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(cached(file, compute)).toBe('two!');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('isStronger', () => {
  const ranks = ['Elite', 'Legend', 'Mythic'];
  it('prefers the higher rank, then more equipment, and counts a missing state as the weakest', () => {
    expect(isStronger({ rank: 'Legend', equipmentLevel: 0 }, { rank: 'Elite', equipmentLevel: 25 }, ranks)).toBe(true);
    expect(isStronger({ rank: 'Elite', equipmentLevel: 10 }, { rank: 'Elite', equipmentLevel: 5 }, ranks)).toBe(true);
    expect(isStronger({ rank: 'Elite', equipmentLevel: 5 }, { rank: 'Elite', equipmentLevel: 5 }, ranks)).toBe(false);
    expect(isStronger({ rank: 'Elite', equipmentLevel: null }, { rank: null, equipmentLevel: 40 }, ranks)).toBe(true);
    expect(isStronger({ rank: null, equipmentLevel: null }, { rank: 'Elite', equipmentLevel: null }, ranks)).toBe(false);
  });
});
