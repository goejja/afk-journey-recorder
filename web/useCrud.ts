import { useCallback, useState } from 'react';
import { useConfirm } from './ui/Dialog.js';

/**
 * What a page that lists records and lets the player add, change and delete them needs besides its own state: the error line, a
 * `run` that does an action and then refreshes the page, and the two questions it asks.
 */
export function useCrud() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  /**
   * Does the action, then `after` with its result (usually the reload), and clears the error; `done` (a text, or a function of the result) is then shown as the message.
   * A failure shows its error instead and clears the message. Says whether it worked.
   */
  const run = useCallback(async <T,>(action: () => Promise<T>, after?: (result: T) => unknown, done?: string | ((result: T) => string)): Promise<boolean> => {
    try {
      const result = await action();
      await after?.(result);
      setError(null);
      if (done !== undefined) setMessage(typeof done === 'function' ? done(result) : done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      setMessage(null);
      return false;
    }
  }, []);

  const confirmDelete = (title: string) => confirm({ title, confirmLabel: 'Delete', danger: true });
  const confirmDiscard = () => confirm({ title: 'Discard your unsaved changes?', confirmLabel: 'Discard', danger: true });

  return { error, setError, message, setMessage, run, confirm, confirmDelete, confirmDiscard, dialog };
}
