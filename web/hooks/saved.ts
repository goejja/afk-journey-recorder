/**
 * A step that follows a record already saved, such as comparing the roster with the heroes it names. The record exists whatever
 * happens here, so a failure is a sentence to show beside "Saved" and never a failed save: a failed save invites a retry that records it twice.
 * `failure` says what could not be done; the sentences of several steps are joined with `joinNotices`.
 */
export async function stepAfterSave(step: () => Promise<unknown>, failure = 'The roster could not be updated'): Promise<string | null> {
  try {
    await step();
    return null;
  } catch (e) {
    return `${failure}: ${(e as Error).message}.`;
  }
}

/** The sentences of the steps that failed after a save, as one (null when none did). */
export const joinNotices = (notices: (string | null)[]): string | null => notices.filter(Boolean).join(' ') || null;
