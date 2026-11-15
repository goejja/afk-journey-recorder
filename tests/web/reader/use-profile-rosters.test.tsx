// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const heroes = vi.fn();
vi.mock('../../../web/backend.js', () => ({ api: { heroes: (id: number) => heroes(id) } }));
const { useProfileRosters } = await import('../../../web/reader/useProfileRosters.js');

afterEach(() => {
  cleanup();
  heroes.mockReset();
});

const roster = (name: string) => [{ name }] as any;

describe('useProfileRosters', () => {
  it('loads the roster of each profile the form opens with, and none for a side without one', async () => {
    heroes.mockImplementation(async (id: number) => roster(`hero of ${id}`));
    const { result } = renderHook(() => useProfileRosters({ A: 1, B: null }));
    await waitFor(() => expect(result.current[0].A).toEqual(roster('hero of 1')));
    expect(result.current[0].B).toBeNull();
    expect(heroes).toHaveBeenCalledTimes(1);
  });

  it('keeps a roster that was chosen before the first load answered', async () => {
    let answer!: (value: unknown) => void;
    heroes.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useProfileRosters({ A: 1, B: null }));
    act(() => result.current[1]((old) => ({ ...old, A: roster('chosen') })));
    await act(async () => answer(roster('opening')));
    expect(result.current[0].A).toEqual(roster('chosen'));
  });
});
