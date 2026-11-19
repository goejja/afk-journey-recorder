// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { afterSaved, told, useSaveRecord } from '../../web/useSaveRecord.js';

describe('useSaveRecord', () => {
  it('runs one save at a time: a second call while one runs is ignored, and a later one runs', async () => {
    const { result } = renderHook(() => useSaveRecord());
    let release!: () => void;
    let started = 0;
    const slow = () => {
      started++;
      return new Promise<void>((resolve) => (release = resolve));
    };
    let first!: Promise<void>;
    act(() => {
      first = result.current.run(slow);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      await result.current.run(slow);
    });
    expect(started).toBe(1);
    await act(async () => {
      release();
      await first;
    });
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.run(async () => {
        started++;
      });
    });
    expect(started).toBe(2);
  });

  it('is free again after a save that fails', async () => {
    const { result } = renderHook(() => useSaveRecord());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('no'))).catch(() => undefined);
    });
    expect(result.current.busy).toBe(false);
  });
});

describe('afterSaved', () => {
  it('says nothing when the step works, and a sentence, not an error, when it fails', async () => {
    expect(await afterSaved(async () => undefined)).toBeNull();
    expect(await afterSaved(() => Promise.reject(new Error('Network down')))).toBe('The roster could not be updated: Network down.');
  });

  it('names what could not be done, and joins the sentences of several steps, or none', async () => {
    const pictures = await afterSaved(() => Promise.reject(new Error('Too big')), 'The pictures could not be kept');
    expect(pictures).toBe('The pictures could not be kept: Too big.');
    const roster = await afterSaved(() => Promise.reject(new Error('Network down')));
    expect(told([null, pictures, roster])).toBe('The pictures could not be kept: Too big. The roster could not be updated: Network down.');
    expect(told([null, null])).toBeNull();
  });
});
