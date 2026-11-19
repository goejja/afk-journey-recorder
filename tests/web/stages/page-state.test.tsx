// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageState } from '../../../web/stages/page-state.js';

beforeEach(() => window.history.replaceState(null, '', '#stages'));
afterEach(() => vi.restoreAllMocks());

describe('usePageState', () => {
  it('writes the address once for each change, even where React runs an updater twice, and not when the page opens', () => {
    window.history.replaceState(null, '', '#stages?open=2:apex-normal&junk=1');
    const write = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => usePageState(), { wrapper: StrictMode });
    expect(write).not.toHaveBeenCalled(); // reading the address does not rewrite it
    act(() => result.current.choosePhase(2));
    expect(write).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#stages?phase=2&open=2%3Aapex-normal');
  });
});
