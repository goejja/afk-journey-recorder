import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ArenaMode, type BattleImportState, type Profile } from '../backend.js';
import { groupPictures, pictureKey } from './battle-import.js';
import { applyEdits, pruneEdits, readEdits, writeEdits, type Edits } from './battle-import-edits.js';
import { usePolling } from '../useLoad.js';

/** Runs one action at a time for a wizard: `busy` while it runs, and its failure in `error`. */
export function useAttempt() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, attempt };
}

type PictureRef = { id: number; key?: string };

/**
 * The Battle import queue: the pictures the agent reads (followed while any is going), the groups they make with what the player
 * changed (fight numbers, moved pictures, profiles given to names, kept in the browser by the picture's key), and the profiles.
 */
export function useBattleQueue({ attempt, setError, onProfileCreated }: { attempt: (action: () => Promise<unknown>) => Promise<void>; setError: (message: string | null) => void; onProfileCreated?: (profile: Profile) => void }) {
  const [state, setState] = useState<BattleImportState | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [edits, setEdits] = useState<Edits>(readEdits);
  useEffect(() => writeEdits(edits), [edits]);

  const refresh = useCallback(async () => {
    try {
      setState(await api.battleImport());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setError]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    api.profiles().then(setProfiles, () => undefined);
  }, []);

  // The edits of pictures that left the queue are forgotten.
  useEffect(() => {
    if (state) setEdits((old) => pruneEdits(old, new Set(state.queue.map(pictureKey))));
  }, [state]);

  const reading = state?.queue.some((q) => q.state === 'running' || q.state === 'queued') ?? false;
  usePolling(refresh, reading);

  const groups = useMemo(() => groupPictures(applyEdits(state?.queue ?? [], edits, profiles), edits.moved), [state, edits, profiles]);
  const failed = (state?.queue ?? []).filter((q) => q.state === 'failed');
  const waiting = (state?.queue ?? []).filter((q) => q.state === 'queued' || q.state === 'running');

  const giveNumber = (picture: PictureRef, number: number | null) => setEdits((old) => ({ ...old, numbers: { ...old.numbers, [pictureKey(picture)]: number } }));
  /** Puts a picture in a group by its key; 'new' makes a battle of its own. */
  const moveTo = (picture: PictureRef, group: string) =>
    setEdits((old) => ({ ...old, moved: { ...old.moved, [pictureKey(picture)]: group === 'new' ? `picture-${pictureKey(picture)}` : group } }));

  /** Reads the pictures one after another; `cleared` is called once they are sent, before the queue is read again. */
  const start = (files: File[], mode: ArenaMode, cleared: () => void) =>
    attempt(async () => {
      const refused: string[] = [];
      for (const file of files) {
        try {
          await api.startBattleImport(file, mode);
        } catch (e) {
          refused.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      cleared();
      await refresh();
      if (refused.length > 0) setError(refused.join(' | '));
    });

  const createProfile = (name: string) =>
    attempt(async () => {
      const profile = await api.createProfile({ name });
      setEdits((old) => ({ ...old, made: { ...old.made, [name.trim().toLowerCase()]: profile.id } }));
      setProfiles((old) => [...old, profile]);
      onProfileCreated?.(profile);
      // the spelling the picture gave is remembered against the Profile (ADR 0021)
      void api.addProfileName(profile.id, name).catch(() => undefined);
    });

  /** Gives a name an existing profile; null means no profile (kept as 0), and a name left alone keeps the picture's match. */
  const assignProfile = (name: string, id: number | null) => {
    setEdits((old) => ({ ...old, made: { ...old.made, [name.trim().toLowerCase()]: id ?? 0 } }));
    if (id !== null) void api.addProfileName(id, name).catch(() => undefined);
  };

  return { state, refresh, reading, groups, failed, waiting, profiles, giveNumber, moveTo, start, createProfile, assignProfile };
}
