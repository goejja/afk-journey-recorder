// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyFormation } from '../../../web/FormationEditor.js';
import { emptyOpponent } from '../../../web/arena/OpponentEditor.js';

const loadRoundDeployments = vi.fn();
const saveRoundDeployment = vi.fn();
const saveRoundDeployments = vi.fn();
vi.mock('../../../web/backend.js', () => ({
  api: {
    tournaments: async () => [],
    saveRoundDeployment: (...args: unknown[]) => saveRoundDeployment(...args),
    saveRoundDeployments: (...args: unknown[]) => saveRoundDeployments(...args),
  },
}));
vi.mock('../../../web/arena/draft.js', async (importOriginal) => ({ ...(await importOriginal<object>()), loadRoundDeployments: (...args: unknown[]) => loadRoundDeployments(...args) }));
const { useRoundDeployments } = await import('../../../web/arena/useRoundDeployments.js');

afterEach(() => {
  cleanup();
  loadRoundDeployments.mockReset();
  saveRoundDeployment.mockReset();
  saveRoundDeployments.mockReset();
});

const round = (n: number) => ({ tournamentId: n, round: 'Round 1', label: `Tournament ${n}` }) as any;
const profiles = [{ id: 1, name: 'Ann', playerId: null }, { id: 2, name: 'Bob', playerId: null }] as any;
const entry = (profileId: number, evieTile: number | null) =>
  ({ profileId, confirmed: true, teams: [{ heroes: [{ tile: evieTile, hero: 'Evie', part: '', rank: null, equipmentLevel: null }], phantimal: null, artifact: null }] }) as any;
const draft = (tile: number | null) =>
  ({
    formation: { ...emptyFormation(), placed: tile === null ? [] : [{ tile, hero: 'Evie' }] },
    opponent: { ...emptyOpponent(), placed: [{ tile: 0, hero: 'Zed', rank: '', equipment: '' }] },
    mapName: 'Arena I',
  }) as any;

interface Props {
  round?: ReturnType<typeof round> | null;
  deployments?: unknown[];
  chosenProfile?: { A: number | null; B: number | null };
  drafts?: unknown[];
}

function setup(initial: Props = {}) {
  const onStatus = vi.fn();
  const onError = vi.fn();
  const rendered = renderHook(
    (props: Props) =>
      useRoundDeployments({
        initialRound: props.round ?? null,
        initialDeployments: (props.deployments ?? []) as any,
        savedRound: null,
        editedRound: null,
        profiles,
        maps: [],
        drafts: (props.drafts ?? [draft(38)]) as any,
        updateTeam: () => undefined,
        chosenProfile: props.chosenProfile ?? { A: 1, B: 2 },
        onStatus,
        onError,
      }),
    { initialProps: initial },
  );
  return { ...rendered, onStatus, onError };
}

describe('useRoundDeployments', () => {
  it('reads the Round Deployments when a Round is set, and keeps only the answer for the latest Round', async () => {
    let answerFirst!: (value: unknown) => void;
    loadRoundDeployments.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve))).mockResolvedValueOnce([entry(1, 40)]);
    const { result, rerender } = setup({ round: round(1) });
    expect(loadRoundDeployments).toHaveBeenCalledWith(round(1), profiles);
    rerender({ round: round(2) });
    await waitFor(() => expect(result.current.deployments).toEqual([entry(1, 40)]));
    await act(async () => answerFirst([entry(1, 99)]));
    expect(result.current.deployments).toEqual([entry(1, 40)]);
  });

  it('reads nothing without a Round', () => {
    const { result } = setup();
    expect(loadRoundDeployments).not.toHaveBeenCalled();
    expect(result.current.round).toBeNull();
  });

  it('reports a failed read, but not one that a later read has overtaken', async () => {
    let failFirst!: (error: Error) => void;
    loadRoundDeployments.mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject))).mockResolvedValueOnce([]);
    const { onError, rerender } = setup({ round: round(1) });
    rerender({ round: round(2) });
    await act(async () => failFirst(new Error('late failure')));
    expect(onError).not.toHaveBeenCalledWith('late failure');

    loadRoundDeployments.mockRejectedValueOnce(new Error('The Round Deployments could not be read'));
    rerender({ round: round(3) });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The Round Deployments could not be read'));
  });

  it('saves one side with the single-Profile write, and both sides together', async () => {
    loadRoundDeployments.mockResolvedValue([entry(1, null), entry(2, null)]);
    const { result, onStatus, onError } = setup({ round: round(1) });
    await act(async () => result.current.confirm(['A']));
    expect(saveRoundDeployment).toHaveBeenCalledWith(1, 'Round 1', 1, [expect.objectContaining({ heroes: [expect.objectContaining({ hero: 'Evie', tile: 38 })] })]);
    expect(saveRoundDeployments).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Round Deployment of Ann saved for Tournament 1, Round 1'));
    expect(onError).toHaveBeenLastCalledWith(null);

    await act(async () => result.current.confirm(['A', 'B']));
    expect(saveRoundDeployments).toHaveBeenCalledWith(1, 'Round 1', [expect.objectContaining({ profileId: 1 }), expect.objectContaining({ profileId: 2 })]);
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Round Deployment of Ann and Bob saved'));
  });

  it('refuses a Battle whose two sides have the same Profile', async () => {
    loadRoundDeployments.mockResolvedValue([]);
    const { result, onStatus } = setup({ round: round(1), chosenProfile: { A: 1, B: 1 } });
    await act(async () => result.current.confirm(['A']));
    expect(saveRoundDeployment).not.toHaveBeenCalled();
    expect(result.current.deployError).toMatch(/^Side A and Side B are the same Profile/);
    expect(onStatus).toHaveBeenLastCalledWith(null);
  });

  it('says which sides were not saved, and clears the status, when the save fails', async () => {
    loadRoundDeployments.mockResolvedValue([]);
    saveRoundDeployment.mockRejectedValueOnce(new Error('boom'));
    saveRoundDeployments.mockRejectedValueOnce(new Error('bang'));
    const { result, onStatus } = setup({ round: round(1) });
    await act(async () => result.current.confirm(['B']));
    expect(result.current.deployError).toBe('Side B was not saved as the Round Deployment: boom');
    expect(onStatus).toHaveBeenLastCalledWith(null);
    await act(async () => result.current.confirm(['A', 'B']));
    expect(result.current.deployError).toBe('The sides were not saved as the Round Deployment: bang');
  });

  it('is deploying while a confirmation runs, and a second one is not started', async () => {
    loadRoundDeployments.mockResolvedValue([]);
    let finish!: () => void;
    saveRoundDeployment.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { result } = setup({ round: round(1) });
    expect(result.current.deploying).toBe(false);
    let first!: Promise<void>;
    act(() => void (first = result.current.confirm(['A'])));
    await waitFor(() => expect(result.current.deploying).toBe(true));
    await act(async () => result.current.confirm(['A']));
    expect(saveRoundDeployment).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.deploying).toBe(false);
  });

  it('gives the confirmed teams the tiles of a saved battle, and writes nothing when no tile is new', async () => {
    loadRoundDeployments.mockResolvedValue([entry(1, null)]);
    const { result } = setup({ round: round(1), chosenProfile: { A: 1, B: null }, deployments: [entry(1, null)] });
    await waitFor(() => expect(loadRoundDeployments).toHaveBeenCalled());
    await act(async () => result.current.fillTiles([{ d: draft(38), index: 0 }]));
    expect(saveRoundDeployment).toHaveBeenCalledTimes(1);
    const [, , profileId, teams] = saveRoundDeployment.mock.calls[0]!;
    expect(profileId).toBe(1);
    expect(teams[0].heroes[0]).toMatchObject({ hero: 'Evie', tile: 38 });
    expect(teams[0].mapName).toBe('Arena I');

    saveRoundDeployment.mockReset();
    await act(async () => result.current.fillTiles([{ d: draft(null), index: 0 }])); // no hero placed: nothing to give
    expect(saveRoundDeployment).not.toHaveBeenCalled();
  });
});
