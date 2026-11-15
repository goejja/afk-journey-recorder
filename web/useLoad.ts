import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface Loaded<T> {
  /** The last answer that arrived; kept while the next one loads, undefined until the first. */
  data: T | undefined;
  /** The message of the failure of the latest request, or null. */
  error: string | null;
  loading: boolean;
  /** Asks again now, with the same function. */
  reload: () => Promise<void>;
}

/**
 * Runs `load` on mount and whenever `deps` change. Only the latest request counts: an answer that arrives after a newer request
 * was made, or after the component is gone, is dropped, so a slow old answer can never overwrite a newer one. While `enabled` is false
 * nothing is asked and the last answer and error stay as they were; what `enabled` depends on belongs in `deps` too.
 */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList, enabled = true): Loaded<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: enabled });
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const run = useCallback(async () => {
    const mine = ++latest.current;
    setState((old) => ({ ...old, loading: true }));
    try {
      const data = await loader.current();
      if (mine === latest.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (mine === latest.current) setState((old) => ({ ...old, error: (e as Error).message, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (enabled) void run();
    return () => {
      latest.current += 1;
    };
    // The caller names what the load depends on.
  }, deps); // oxlint-disable-line react/exhaustive-deps

  return { ...state, reload: run };
}

/**
 * For a load written by hand, which sets several states: `const current = newest();` before the request, then
 * `if (!current()) return;` after it. An answer that a later load has overtaken is dropped, so a slow old request cannot overwrite a
 * newer one when a filter changes twice quickly.
 */
export function useNewest(): () => () => boolean {
  const count = useRef(0);
  return useCallback(() => {
    const mine = ++count.current;
    return () => mine === count.current;
  }, []);
}

/** Calls `poll` every `ms` while `active`, until it turns false or the component is gone. The poll that is still running is not overlapped. */
export function usePolling(poll: () => Promise<unknown> | void, active: boolean, ms = 2000): void {
  const current = useRef(poll);
  current.current = poll;
  useEffect(() => {
    if (!active) return;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void Promise.resolve(current.current()).finally(() => {
        busy = false;
      });
    }, ms);
    return () => clearInterval(timer);
  }, [active, ms]);
}
