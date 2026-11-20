// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoad, useNewest, useReference } from '../../../web/hooks/load.js';

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

  it('is not loading once it is turned off while a request is still on its way, and drops that answer', async () => {
    const pending = later<number>();
    const { result, rerender } = renderHook(({ on }) => useLoad(() => pending.promise, [on], on), { initialProps: { on: true } });
    expect(result.current.loading).toBe(true);
    rerender({ on: false });
    expect(result.current.loading).toBe(false);
    await act(async () => pending.resolve(1));
    expect(result.current).toMatchObject({ data: undefined, loading: false });
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

describe('useLoad reload', () => {
  it('answers what it loaded, so a caller can use it at once', async () => {
    const answers = [later<string>(), later<string>()];
    let n = 0;
    const { result } = renderHook(() => useLoad(() => answers[n++]!.promise, []));
    answers[0]!.resolve('first');
    await waitFor(() => expect(result.current.data).toBe('first'));

    let slow!: Promise<string | undefined>;
    act(() => void (slow = result.current.reload()));
    await act(async () => answers[1]!.resolve('second'));
    await expect(slow).resolves.toBe('second');
    expect(result.current.data).toBe('second');
  });

  it('answers nothing when the load fails, and keeps the error', async () => {
    const { result } = renderHook(() => useLoad(() => Promise.reject(new Error('down')), []));
    await waitFor(() => expect(result.current.error).toBe('down'));
    await expect(result.current.reload()).resolves.toBeUndefined();
  });
});

describe('useReference', () => {
  it('asks every loader at once and keeps the answers under the loaders’ names', async () => {
    const maps = vi.fn(() => Promise.resolve(['Arena']));
    const rules = vi.fn(() => Promise.resolve([1, 2]));
    const { result } = renderHook(() => useReference({ maps, heroRules: rules }));
    await waitFor(() => expect(result.current.data).toEqual({ maps: ['Arena'], heroRules: [1, 2] }));
    expect(maps).toHaveBeenCalledTimes(1);
    expect(rules).toHaveBeenCalledTimes(1);
  });

  it('shows the message of the loader that failed and keeps no data', async () => {
    const { result } = renderHook(() => useReference({ maps: () => Promise.resolve([]), heroes: () => Promise.reject(new Error('Heroes unreachable')) }));
    await waitFor(() => expect(result.current.error).toBe('Heroes unreachable'));
    expect(result.current.data).toBeUndefined();
  });

  it('patches some fields from an object or from a function of the data, and does nothing before the first answer', async () => {
    const gate = later<string[]>();
    const { result } = renderHook(() => useReference({ heroes: () => gate.promise, maps: () => Promise.resolve(['Arena']) }));
    act(() => result.current.patch({ maps: ['early'] }));
    expect(result.current.data).toBeUndefined();
    await act(async () => gate.resolve(['Alna']));
    await waitFor(() => expect(result.current.data).toEqual({ heroes: ['Alna'], maps: ['Arena'] }));
    act(() => result.current.patch({ heroes: ['Alna', 'Bryn'] }));
    expect(result.current.data).toEqual({ heroes: ['Alna', 'Bryn'], maps: ['Arena'] });
    act(() => result.current.patch((old) => ({ maps: [...old.maps, 'Dream Hunt'] })));
    expect(result.current.data?.maps).toEqual(['Arena', 'Dream Hunt']);
  });
});
