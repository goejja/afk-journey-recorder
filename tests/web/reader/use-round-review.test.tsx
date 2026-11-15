// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportGroup } from '../../../web/reader/battle-import.js';
import { useRoundReview, type RoundReview } from '../../../web/arena/useRoundReview.js';

afterEach(cleanup);

const side = { name: 'Luna', profile: null, heroes: [], artifact: null, phantimal: null };
const groups = (number: number | null = 1): ImportGroup[] => [{ key: 'g', mode: 'Super League', pictures: [{ id: 1, label: null, state: 'done', draft: { mode: 'Super League', number, sideA: side, sideB: side } }] }] as unknown as ImportGroup[];
const chosen = { tournamentId: 1, round: 'Group stage' as const, label: 'Season 8, Tournament 1' };
const found = (problems: Record<string, string[]>): RoundReview => ({ problems, info: {}, deployments: [], changes: {} });

describe('useRoundReview', () => {
  it('checks once for groups that are equal, however often they are rebuilt, and again when something the check reads changes', async () => {
    const onReview = vi.fn(async () => found({ g: [] }));
    const { result, rerender } = renderHook((props: { groups: ImportGroup[] }) => useRoundReview({ ...props, chosen, reuse: true, onReview }), { initialProps: { groups: groups() } });
    await waitFor(() => expect(result.current.problems).toEqual({ g: [] }));
    rerender({ groups: groups() });
    rerender({ groups: groups() });
    expect(onReview).toHaveBeenCalledTimes(1);
    rerender({ groups: groups(2) });
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(2));
  });

  it('checks again on recheck, and lists the groups without a problem as ready', async () => {
    const onReview = vi.fn(async () => found({ g: [] }));
    const { result } = renderHook(() => useRoundReview({ groups: [{ ...groups()[0]!, mode: 'Arena' }], chosen, reuse: true, onReview }));
    await waitFor(() => expect(result.current.ready).toHaveLength(1));
    act(() => result.current.recheck());
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(2));
  });

  it('has no problems to show without a Round or when the check fails', async () => {
    const failing = vi.fn(async () => Promise.reject(new Error('down')));
    const { result } = renderHook(() => useRoundReview({ groups: groups(), chosen, reuse: true, onReview: failing }));
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(result.current.problems).toBeNull();
    const none = renderHook(() => useRoundReview({ groups: groups(), chosen: null, reuse: true, onReview: vi.fn() }));
    expect(none.result.current.problems).toBeNull();
  });
});
