import { useCallback } from 'react';
import { api, type ArenaMode, type ImportFeedbackSide, type ParkKind } from '../backend.js';
import { useToast } from '../ui/Toast.js';

/** What the server says of a Battle import it was sent the feedback of (ADR 0040): how many readings it parked, and which lists were full. */
export type FeedbackAnswer = Awaited<ReturnType<typeof api.sendImportFeedback>>;

/** The toast points to another Page and may arrive after the screen has changed, so it stays longer than a usual one. */
export const PARKED_TOAST_MS = 10_000;

/** Sends what the player kept of a Battle import. It never rejects: a send that failed has no answer (null), and nothing in the app depends on it. */
export const sendFeedback = (mode: ArenaMode, sides: ImportFeedbackSide[]): Promise<FeedbackAnswer | null> => api.sendImportFeedback(mode, sides).catch(() => null);

const KIND_WORDS: Record<ParkKind, string> = { difference: 'differences', unsure: 'unsure readings' };

/**
 * The line for the answers of one save, or of every group of a batch: the readings parked, added up, then the lists that were full, each named once.
 * An answer that never came (null) counts for nothing. It is null when there is nothing to say.
 */
export function parkedMessage(answers: (FeedbackAnswer | null)[]): string | null {
  const parked = answers.reduce((sum, a) => sum + (a?.parked ?? 0), 0);
  const full = (Object.keys(KIND_WORDS) as ParkKind[]).filter((kind) => answers.some((a) => a?.full.includes(kind)));
  const lines: string[] = [];
  if (parked > 0) lines.push(`${parked} ${parked === 1 ? 'reading' : 'readings'} to confirm in Admin > Reader`);
  if (full.length > 0) {
    const names = full.map((k) => KIND_WORDS[k]).join(' and ');
    lines.push(`The To confirm ${full.length === 1 ? 'list' : 'lists'} of ${names} ${full.length === 1 ? 'is' : 'are'} full: confirm or dismiss some in Admin > Reader`);
  }
  return lines.length > 0 ? lines.join('. ') : null;
}

/**
 * Tells the player, in one toast, what the saves of a Battle import parked. The saves are not waited for: a save that failed leaves the others to speak,
 * and when none spoke nothing is shown, since the feedback is reported outside the app and the player can do nothing about it.
 */
export function useParkedToast(): (sends: Promise<FeedbackAnswer | null>[]) => void {
  const toast = useToast();
  return useCallback(
    (sends) => {
      void Promise.all(sends.map((send) => send.catch(() => null))).then((answers) => {
        const message = parkedMessage(answers);
        if (message) toast(message, { duration: PARKED_TOAST_MS });
      });
    },
    [toast],
  );
}
