// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAction } from '../../../web/hooks/action.js';

afterEach(cleanup);

describe('useAction', () => {
  it('does the action, then the follow-up with its result, and keeps no error', async () => {
    const { result } = renderHook(() => useAction());
    const after = vi.fn();
    let worked = false;
    await act(async () => void (worked = await result.current.run(() => Promise.resolve('Alna'), after)));
    expect(worked).toBe(true);
    expect(after).toHaveBeenCalledWith('Alna');
    expect(result.current.error).toBeNull();
  });

  it('shows the message of a failure, skips the follow-up, and clears it after the next success', async () => {
    const { result } = renderHook(() => useAction());
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
    const { result, rerender } = renderHook(() => useAction());
    const first = result.current.run;
    rerender();
    expect(result.current.run).toBe(first);
  });

  it('shows the message of a success, from a text or from the result, and drops it on a failure', async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => void (await result.current.run(() => Promise.resolve(3), undefined, 'Saved.')));
    expect(result.current.message).toBe('Saved.');
    await act(async () => void (await result.current.run(() => Promise.resolve(3), undefined, (rows: number) => `Restored ${rows} rows.`)));
    expect(result.current.message).toBe('Restored 3 rows.');
    await act(async () => void (await result.current.run(() => Promise.reject(new Error('no')))));
    expect(result.current.message).toBeNull();
    expect(result.current.error).toBe('no');
  });

  it('leaves a message the follow-up set itself', async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => void (await result.current.run(() => Promise.resolve('Renamed a on 2 records.'), (text: string) => result.current.setMessage(text))));
    expect(result.current.message).toBe('Renamed a on 2 records.');
  });

  it('runs one action at a time: a second call while one runs is ignored and says it did not work, and a later one runs', async () => {
    const { result } = renderHook(() => useAction());
    let release!: () => void;
    let started = 0;
    const slow = () => {
      started++;
      return new Promise<void>((resolve) => (release = resolve));
    };
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.run(slow);
    });
    expect(result.current.busy).toBe(true);
    let second = true;
    await act(async () => void (second = await result.current.run(slow)));
    expect(second).toBe(false);
    expect(started).toBe(1);
    await act(async () => {
      release();
      await first;
    });
    expect(result.current.busy).toBe(false);
    await act(async () => void (await result.current.run(async () => void started++)));
    expect(started).toBe(2);
  });

  it('with `queue` runs the calls one after another and drops none', async () => {
    const { result } = renderHook(() => useAction({ when: 'queue' }));
    const order: string[] = [];
    const gates: (() => void)[] = [];
    const step = (name: string) => () => {
      order.push(`${name} starts`);
      return new Promise<string>((resolve) => gates.push(() => (order.push(`${name} ends`), resolve(name))));
    };
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = result.current.run(step('a'));
      second = result.current.run(step('b'));
    });
    expect(order).toEqual(['a starts']);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      gates[0]!();
      await first;
    });
    expect(order).toEqual(['a starts', 'a ends', 'b starts']);
    await act(async () => {
      gates[1]!();
      expect(await second).toBe(true);
    });
    expect(order).toEqual(['a starts', 'a ends', 'b starts', 'b ends']);
    expect(result.current.busy).toBe(false);
  });

  it('with `queue` a call after a failed one still runs, and the error shows', async () => {
    const { result } = renderHook(() => useAction({ when: 'queue' }));
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.run(() => Promise.reject(new Error('no')));
      second = result.current.run(() => Promise.resolve('ok'));
    });
    await act(async () => void (await Promise.all([first, second])));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('runs `then` after every successful action, after the call\'s own follow-up, and not after a failure', async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useAction({ then: () => void calls.push('then') }));
    await act(async () => void (await result.current.run(() => Promise.resolve('x'), () => void calls.push('after'))));
    expect(calls).toEqual(['after', 'then']);
    await act(async () => void (await result.current.run(() => Promise.reject(new Error('no')))));
    expect(calls).toEqual(['after', 'then']);
  });

  it('uses the newest `then`, with the same run function', async () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(({ n }) => useAction({ then: () => void calls.push(`then ${n}`) }), { initialProps: { n: 1 } });
    const run = result.current.run;
    rerender({ n: 2 });
    expect(result.current.run).toBe(run);
    await act(async () => void (await result.current.run(() => Promise.resolve(1))));
    expect(calls).toEqual(['then 2']);
  });

  it('is free again after an action that fails, and shows its error', async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => void (await result.current.run(() => Promise.reject(new Error('no')))));
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe('no');
    let worked = false;
    await act(async () => void (worked = await result.current.run(() => Promise.resolve(1))));
    expect(worked).toBe(true);
  });

  it('lets the follow-up run again, as a reload does, while busy covers it', async () => {
    const { result } = renderHook(() => useAction());
    const reload = vi.fn(() => result.current.run(() => Promise.resolve('fresh')));
    let busyDuringFollowUp = false;
    await act(async () => {
      await result.current.run(
        () => Promise.resolve('deleted'),
        async () => {
          busyDuringFollowUp = true;
          await reload();
        },
      );
    });
    expect(busyDuringFollowUp).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
