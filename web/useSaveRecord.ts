import { useCallback, useRef, useState } from 'react';

/**
 * Runs the save of a record one at a time: while one is running, `busy` is true (the Save buttons are disabled with it) and a second
 * call is ignored, so a double click or a key repeat cannot record the same thing twice.
 */
export function useSaveRecord(): { busy: boolean; run: (save: () => Promise<unknown>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async (save: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await save();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/**
 * A step that follows a record already saved, such as comparing the roster with the heroes it names. The record exists whatever
 * happens here, so a failure is a sentence to show beside "Saved" and never a failed save: a failed save invites a retry that records it twice.
 * `failure` says what could not be done; the sentences of several steps are joined with `told`.
 */
export async function afterSaved(step: () => Promise<unknown>, failure = 'The roster could not be updated'): Promise<string | null> {
  try {
    await step();
    return null;
  } catch (e) {
    return `${failure}: ${(e as Error).message}.`;
  }
}

/** The sentences of the steps that failed after a save, as one (null when none did). */
export const told = (notices: (string | null)[]): string | null => notices.filter(Boolean).join(' ') || null;
