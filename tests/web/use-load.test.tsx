// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoad, useNewest, usePolling } from '../../web/useLoad.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A promise settled from outside, to answer requests in the order a test chooses. */
function later<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('useLoad', () => {
  it('loads on mount and keeps the answer', async () => {
    const { result } = renderHook(() => useLoad(() => Promise.resolve('hello'), []));
    expect(result.current).toMatchObject({ data: undefined, loading: true });
    await waitFor(() => expect(result.current).toMatchObject({ data: 'hello', error: null, loading: false }));
  });

  it('asks nothing while it is not enabled, and keeps the last answer when it turns off', async () => {
    const load = vi.fn((n: number) => Promise.resolve(n));
    const { result, rerender } = renderHook(({ n, on }) => useLoad(() => load(n), [n, on], on), { initialProps: { n: 1, on: false } });
    expect(result.current).toMatchObject({ data: undefined, loading: false });
    expect(load).not.toHaveBeenCalled();
    rerender({ n: 1, on: true });
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ n: 2, on: false });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(1);
  });

  it('says why a load failed and keeps the earlier answer', async () => {
    let fail = false;
    const { result } = renderHook(() => useLoad(() => (fail ? Promise.reject(new Error('nope')) : Promise.resolve(1)), []));
    await waitFor(() => expect(result.current.data).toBe(1));
    fail = true;
    await act(() => result.current.reload());
    expect(result.current).toMatchObject({ data: 1, error: 'nope', loading: false });
  });

  it('drops an old answer that arrives after a newer request', async () => {
    const first = later<string>();
    const second = later<string>();
    const { result, rerender } = renderHook(({ key }) => useLoad(() => (key === 'a' ? first.promise : second.promise), [key]), { initialProps: { key: 'a' } });
    rerender({ key: 'b' });
    await act(async () => second.resolve('new'));
    await waitFor(() => expect(result.current.data).toBe('new'));
    await act(async () => first.resolve('old'));
    expect(result.current.data).toBe('new');
  });

  it('ignores an answer that arrives after the component is gone', async () => {
    const pending = later<string>();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useLoad(() => pending.promise, []));
    unmount();
    await act(async () => pending.resolve('late'));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('usePolling', () => {
  it('polls while active, stops when not, and does not overlap a slow poll', async () => {
    vi.useFakeTimers();
    const slow = later<void>();
    const poll = vi.fn(() => slow.promise);
    const { rerender } = renderHook(({ active }) => usePolling(poll, active, 1000), { initialProps: { active: false } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).not.toHaveBeenCalled();
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(1); // the first poll has not finished
    await act(async () => slow.resolve());
    poll.mockImplementation(() => Promise.resolve());
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(3);
    rerender({ active: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(3);
  });
});

describe('useNewest', () => {
  it('tells an answer that a later load has overtaken from the newest one', () => {
    const { result } = renderHook(() => useNewest());
    const first = result.current();
    expect(first()).toBe(true);
    const second = result.current();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('is the same function on every render, so it can be a dependency of a callback', () => {
    const { result, rerender } = renderHook(() => useNewest());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});
