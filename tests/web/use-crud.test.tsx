// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCrud } from '../../web/useCrud.js';

afterEach(cleanup);

describe('useCrud', () => {
  it('does the action, then the follow-up with its result, and keeps no error', async () => {
    const { result } = renderHook(() => useCrud());
    const after = vi.fn();
    let worked = false;
    await act(async () => void (worked = await result.current.run(() => Promise.resolve('Alna'), after)));
    expect(worked).toBe(true);
    expect(after).toHaveBeenCalledWith('Alna');
    expect(result.current.error).toBeNull();
  });

  it('shows the message of a failure, skips the follow-up, and clears it after the next success', async () => {
    const { result } = renderHook(() => useCrud());
    const after = vi.fn();
    let worked = true;
    await act(async () => void (worked = await result.current.run(() => Promise.reject(new Error('A rule named "x" already exists')), after)));
    expect(worked).toBe(false);
    expect(after).not.toHaveBeenCalled();
    expect(result.current.error).toBe('A rule named "x" already exists');
    await act(async () => void (await result.current.run(() => Promise.resolve(1))));
    expect(result.current.error).toBeNull();
  });

  it('keeps one run function between renders, so effects can depend on it', () => {
    const { result, rerender } = renderHook(() => useCrud());
    const first = result.current.run;
    rerender();
    expect(result.current.run).toBe(first);
  });

  it('shows the message of a success, from a text or from the result, and drops it on a failure', async () => {
    const { result } = renderHook(() => useCrud());
    await act(async () => void (await result.current.run(() => Promise.resolve(3), undefined, 'Saved.')));
    expect(result.current.message).toBe('Saved.');
    await act(async () => void (await result.current.run(() => Promise.resolve(3), undefined, (rows) => `Restored ${rows} rows.`)));
    expect(result.current.message).toBe('Restored 3 rows.');
    await act(async () => void (await result.current.run(() => Promise.reject(new Error('no')))));
    expect(result.current.message).toBeNull();
    expect(result.current.error).toBe('no');
  });

  it('leaves a message the follow-up set itself', async () => {
    const { result } = renderHook(() => useCrud());
    await act(async () => void (await result.current.run(() => Promise.resolve('Renamed a on 2 records.'), (text) => result.current.setMessage(text))));
    expect(result.current.message).toBe('Renamed a on 2 records.');
  });
});
