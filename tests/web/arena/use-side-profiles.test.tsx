// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const heroes = vi.fn();
const updateProfile = vi.fn();
const createProfile = vi.fn();
vi.mock('../../../web/backend.js', () => ({
  api: { heroes: (id: number) => heroes(id), updateProfile: (id: number, body: unknown) => updateProfile(id, body), createProfile: (body: unknown) => createProfile(body) },
}));
// the states the roster gives are tested with the editors; here a draft only records that its side took a roster, and how
vi.mock('../../../web/FormationEditor.js', () => ({ withRosterStates: (formation: object, roster: { name: string }[], overwrite: boolean) => ({ ...formation, roster: roster[0]!.name, overwrite }) }));
vi.mock('../../../web/arena/OpponentEditor.js', () => ({ withRosterOpponent: (opponent: object, roster: { name: string }[], overwrite: boolean) => ({ ...opponent, roster: roster[0]!.name, overwrite }) }));
const { useSideProfiles } = await import('../../../web/arena/useSideProfiles.js');

afterEach(() => {
  cleanup();
  heroes.mockReset();
  updateProfile.mockReset();
  createProfile.mockReset();
});

const roster = (name: string) => [{ name }] as any;
const profile = (id: number, playerId: string | null = null) => ({ id, name: `Profile ${id}`, playerId }) as any;
const blank = () => ({ playerIdA: 'old A', playerIdB: 'old B', formation: {}, opponent: {} }) as any;

/** The hook inside a form of one draft, with `run` doing the action and its follow-up. */
function setup(options: { opening?: { A: number | null; B: number | null }; overwrite?: boolean; askNewName?: (side: 'A' | 'B') => Promise<string | null | undefined> } = {}) {
  const profiles = [profile(1, '111'), profile(2, '222'), profile(3)];
  const patchReference = vi.fn();
  const onError = vi.fn();
  const run = vi.fn(async (action: () => Promise<unknown>, after?: (result: any) => unknown) => {
    try {
      await after?.(await action());
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  });
  const rendered = renderHook(() => {
    const [draft, setDraft] = useState(blank);
    const hook = useSideProfiles({
      profiles,
      patchReference,
      opening: options.opening ?? { A: null, B: null },
      update: setDraft,
      overwrite: options.overwrite ?? true,
      run: run as any,
      onError,
      askNewName: options.askNewName,
    });
    return { draft, ...hook };
  });
  return { ...rendered, patchReference, onError, run, profiles };
}

describe('useSideProfiles', () => {
  it('opens with the profiles it is given and loads their rosters', async () => {
    heroes.mockImplementation(async (id: number) => roster(`hero of ${id}`));
    const { result } = setup({ opening: { A: 1, B: null } });
    expect(result.current.chosenProfile).toEqual({ A: 1, B: null });
    expect(result.current.barProps.sideProfiles).toEqual({ A: 1, B: null });
    await waitFor(() => expect(result.current.profileRoster.A).toEqual(roster('hero of 1')));
    expect(result.current.profileRoster.B).toBeNull();
  });

  it('puts the chosen profile\'s Player ID and roster on its side, replacing the states as asked', async () => {
    heroes.mockResolvedValue(roster('hero of 1'));
    const { result, onError } = setup({ overwrite: true });
    await act(async () => result.current.barProps.onSideProfile('A', 1));
    expect(result.current.chosenProfile.A).toBe(1);
    expect(result.current.draft.playerIdA).toBe('111');
    expect(result.current.draft.playerIdB).toBe('old B');
    expect(result.current.draft.formation).toEqual({ roster: 'hero of 1', overwrite: true });
    expect(result.current.draft.opponent).toEqual({});
    expect(result.current.profileRoster.A).toEqual(roster('hero of 1'));
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('fills only the heroes without a state when the form keeps what a saved battle recorded', async () => {
    heroes.mockResolvedValue(roster('hero of 2'));
    const { result } = setup({ overwrite: false });
    await act(async () => result.current.barProps.onSideProfile('B', 2));
    expect(result.current.draft.opponent).toEqual({ roster: 'hero of 2', overwrite: false });
    expect(result.current.draft.playerIdB).toBe('222');
  });

  it('takes the Player ID off the side and drops its roster when None is chosen', async () => {
    heroes.mockResolvedValue(roster('hero of 1'));
    const { result } = setup({ opening: { A: 1, B: null } });
    await waitFor(() => expect(result.current.profileRoster.A).not.toBeNull());
    await act(async () => result.current.barProps.onSideProfile('A', null));
    expect(result.current.chosenProfile.A).toBeNull();
    expect(result.current.draft.playerIdA).toBeNull();
    expect(result.current.profileRoster.A).toBeNull();
  });

  it('drops a roster that arrives after another profile was chosen for the same side', async () => {
    let answerFirst!: (value: unknown) => void;
    heroes.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve))).mockResolvedValueOnce(roster('hero of 2'));
    const { result } = setup();
    act(() => result.current.barProps.onSideProfile('A', 1));
    await act(async () => result.current.barProps.onSideProfile('A', 2));
    await act(async () => answerFirst(roster('hero of 1')));
    expect(result.current.profileRoster.A).toEqual(roster('hero of 2'));
    expect(result.current.draft.formation).toEqual({ roster: 'hero of 2', overwrite: true });
  });

  it('reports a roster that failed to load only while it is the newest answer', async () => {
    let failFirst!: (error: Error) => void;
    heroes.mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject))).mockResolvedValueOnce(roster('hero of 2'));
    const { result, onError } = setup();
    act(() => result.current.barProps.onSideProfile('A', 1));
    await act(async () => result.current.barProps.onSideProfile('A', 2));
    await act(async () => failFirst(new Error('late failure')));
    expect(onError).not.toHaveBeenCalledWith('late failure');

    heroes.mockRejectedValueOnce(new Error('no roster'));
    await act(async () => result.current.barProps.onSideProfile('B', 1));
    expect(onError).toHaveBeenLastCalledWith('no roster');
  });

  it('gives the profile of a side its Player ID, in the reference and on the side', async () => {
    heroes.mockResolvedValue(roster('hero of 3'));
    updateProfile.mockResolvedValue(profile(3, '333'));
    const { result, patchReference, run } = setup({ opening: { A: 3, B: null } });
    await act(async () => result.current.barProps.onSetPlayerId?.('A', '333'));
    expect(updateProfile).toHaveBeenCalledWith(3, { playerId: '333' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.draft.playerIdA).toBe('333');
    const change = patchReference.mock.calls[0]![0] as (old: any) => any;
    expect(change({ profiles: [profile(1), profile(3)] }).profiles.map((p: any) => p.playerId)).toEqual([null, '333']);
  });

  it('does nothing for the Player ID of a side that has no profile', async () => {
    const { result } = setup();
    await act(async () => result.current.barProps.onSetPlayerId?.('A', '333'));
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('offers a new profile only when the form can name one, then makes it and chooses it for the side', async () => {
    expect(setup().result.current.barProps.onNewProfile).toBeUndefined();
    heroes.mockResolvedValue(roster('hero of 9'));
    createProfile.mockResolvedValue(profile(9, '999'));
    const { result, patchReference } = setup({ askNewName: async () => 'New player' });
    await act(async () => result.current.barProps.onNewProfile?.('B'));
    expect(createProfile).toHaveBeenCalledWith({ name: 'New player' });
    expect(result.current.chosenProfile.B).toBe(9);
    expect(result.current.draft.playerIdB).toBe('999'); // from the profile just made, which `profiles` does not hold yet
    expect(heroes).toHaveBeenCalledWith(9);
    const change = patchReference.mock.calls[0]![0] as (old: any) => any;
    expect(change({ profiles: [profile(1)] }).profiles.map((p: any) => p.id)).toEqual([1, 9]);
  });

  it('makes no profile when the name is not given', async () => {
    const { result } = setup({ askNewName: async () => null });
    await act(async () => result.current.barProps.onNewProfile?.('A'));
    expect(createProfile).not.toHaveBeenCalled();
    expect(result.current.chosenProfile.A).toBeNull();
  });
});
