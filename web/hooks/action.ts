import { useCallback, useRef, useState } from 'react';
import { useToast } from '../ui/Toast.js';

/** What a second call does while one is going: `exclusive` is ignored (and says it did not work), `queue` waits its turn. */
export type When = 'exclusive' | 'queue';

/**
 * What a page needs to do something to the records and report how it went: the error line, an optional message, and a `run` that does
 * the action, then a follow-up with its result (usually the reload), and clears the error. `busy` is true while a run is going on
 * (a Save or Delete button is disabled with it).
 *
 * `when` says what a second call does while one runs. By default it is `exclusive`: the second call is ignored and says it did not work,
 * so a double click or a key repeat cannot record the same thing twice (and a button that goes through `run` is `disabled={busy}`, so the
 * click is refused where it can be seen). `queue` is for controls that are clicked one after another on purpose, such as the heroes of a
 * roster: each call waits for the one before it and none is dropped. The follow-up is not part of the action, so it may call `run` again,
 * as a reload does. A load is not an action: a page reads its data with `useLoad`, never through `run`.
 *
 * `then` is the follow-up of every action of this hook (usually the page's reload); a call may still pass its own `after`, which gets the
 * result and runs first.
 *
 * `toast` says where the `done` message goes: by default it is the `message` the page shows as a success line; with `toast` it is a toast
 * and `message` stays empty. A message that only confirms a finished action is a toast; one that tells the person what to do next stays a
 * line (docs/ui-conventions.md).
 */
export function useAction({ when = 'exclusive', then, toast = false }: { when?: When; then?: () => unknown; toast?: boolean } = {}) {
  const show = useToast();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const running = useRef(false);
  const turn = useRef<Promise<void>>(Promise.resolve());
  const followUp = useRef(then);
  followUp.current = then;

  /**
   * Does the action, then `after` with its result, and clears the error; `done` (a text, or a function of the result) is then shown as the
   * message. A failure shows its error instead and clears the message. Says whether it worked.
   */
  const run = useCallback(async <T,>(action: () => Promise<T>, after?: (result: T) => unknown, done?: string | ((result: T) => string)): Promise<boolean> => {
    if (when === 'exclusive' && running.current) return false;
    running.current = true;
    setPending((n) => n + 1);
    // a queued call starts when the one before it has finished its action
    const before = turn.current;
    let release = () => {};
    if (when === 'queue') turn.current = new Promise<void>((resolve) => (release = resolve));
    try {
      let result: T;
      try {
        if (when === 'queue') await before;
        result = await action();
      } finally {
        running.current = false;
        release();
      }
      await after?.(result);
      await followUp.current?.();
      setError(null);
      if (done !== undefined) {
        const text = typeof done === 'function' ? done(result) : done;
        if (toast) show(text);
        else setMessage(text);
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      setMessage(null);
      return false;
    } finally {
      setPending((n) => n - 1);
    }
  }, [when, toast, show]);

  return { run, busy: pending > 0, error, setError, message, setMessage };
}
