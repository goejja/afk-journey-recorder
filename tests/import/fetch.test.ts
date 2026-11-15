import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCachedFetcher } from '../../src/import/fetch.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetch-'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The fetcher waits a second between requests; fake timers keep the tests quick. */
const settle = async <T>(promise: Promise<T>) => {
  await vi.advanceTimersByTimeAsync(1500);
  return promise;
};

describe('createCachedFetcher', () => {
  it('asks with a timeout, caches the body, and leaves no temporary file', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => (calls.push(init), new Response('hello')));
    const fetcher = createCachedFetcher(join(dir, 'cache'));
    expect(await settle(fetcher.text('https://example.test/a'))).toBe('hello');
    expect(await fetcher.text('https://example.test/a')).toBe('hello');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(readdirSync(join(dir, 'cache')).every((f) => f.endsWith('.txt'))).toBe(true);
  });

  it('writes a download whole, and does not fetch it again', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3])));
    const fetcher = createCachedFetcher(join(dir, 'cache'));
    const target = join(dir, 'images', 'a.png');
    await settle(fetcher.download('https://example.test/a.png', target));
    expect([...readFileSync(target)]).toEqual([1, 2, 3]);
    vi.stubGlobal('fetch', async () => { throw new Error('should not be asked'); });
    await fetcher.download('https://example.test/a.png', target);
    expect(readdirSync(join(dir, 'images'))).toEqual(['a.png']);
  });

  it('keeps nothing when the request fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 503 }));
    const fetcher = createCachedFetcher(join(dir, 'cache'));
    const failed = settle(fetcher.text('https://example.test/a')).catch((e: Error) => e.message);
    expect(await failed).toMatch(/HTTP 503/);
    expect(existsSync(join(dir, 'cache'))).toBe(false);
  });

  it('replaces an earlier file on a refresh', async () => {
    const fetcher = createCachedFetcher(join(dir, 'cache'), true);
    const target = join(dir, 'a.png');
    writeFileSync(target, 'old');
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([9])));
    await settle(fetcher.download('https://example.test/a.png', target));
    expect([...readFileSync(target)]).toEqual([9]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
