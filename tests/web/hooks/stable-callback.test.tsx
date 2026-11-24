// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStableCallback } from '../../../web/hooks/stable-callback.js';

describe('useStableCallback', () => {
  it('keeps one identity across renders and calls the function of the latest render', () => {
    const { result, rerender } = renderHook(({ label }) => useStableCallback((suffix: string) => `${label}${suffix}`), { initialProps: { label: 'a' } });
    const first = result.current;
    expect(first('!')).toBe('a!');
    rerender({ label: 'b' });
    expect(result.current).toBe(first);
    expect(first('!')).toBe('b!');
  });
});
