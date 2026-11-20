import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface Loaded<T> {
  /** The last answer that arrived; kept while the next one loads, undefined until the first. */
  data: T | undefined;
  /** The message of the failure of the latest request, or null. */
  error: string | null;
  loading: boolean;
  /** Asks again now, with the same function, and answers what came; nothing when the request failed or a newer one overtook it. */
  reload: () => Promise<T | undefined>;
  /** Changes the answer in place, for a page that learns of a change without asking again; nothing happens before the first answer. */
  setData: (change: (old: T) => T) => void;
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

  const run = useCallback(async (): Promise<T | undefined> => {
    const mine = ++latest.current;
    setState((old) => ({ ...old, loading: true }));
    try {
      const data = await loader.current();
      if (mine !== latest.current) return undefined;
      setState({ data, error: null, loading: false });
      return data;
    } catch (e) {
      if (mine === latest.current) setState((old) => ({ ...old, error: (e as Error).message, loading: false }));
      return undefined;
    }
  }, []);

  const setData = useCallback((change: (old: T) => T) => setState((old) => (old.data === undefined ? old : { ...old, data: change(old.data) })), []);

  useEffect(() => {
    if (enabled) void run();
    return () => {
      latest.current += 1;
    };
    // The caller names what the load depends on.
  }, deps); // oxlint-disable-line react/exhaustive-deps

  // A request still on its way when `enabled` turns false is dropped (the cleanup above), so nothing is waited for: not loading.
  return { ...state, loading: state.loading && enabled, reload: run, setData };
}

/** What each loader of `useReference` answers, under the loader's name. */
export type ReferenceOf<L extends Record<string, () => Promise<unknown>>> = { [K in keyof L]: Awaited<ReturnType<L[K]>> };

/**
 * The reference data a page needs before it can show anything, such as the maps and the heroes: every loader runs at once on mount and
 * the answers are kept under the loaders' names, so a page keeps its own field names (`{ maps: api.maps, rules: api.bossRules }`). It is
 * a `useLoad`, so a failure of any loader is the `error` and only the latest answer counts. `patch` changes some fields in place, from
 * an object or from a function of the data, for when the page already knows the new value.
 */
export function useReference<L extends Record<string, () => Promise<unknown>>>(loaders: L) {
  const loaded = useLoad<ReferenceOf<L>>(async () => {
    const entries = await Promise.all(Object.entries(loaders).map(async ([name, load]) => [name, await load()] as const));
    return Object.fromEntries(entries) as ReferenceOf<L>;
  }, []);
  const { setData } = loaded;
  const patch = useCallback((change: Partial<ReferenceOf<L>> | ((old: ReferenceOf<L>) => Partial<ReferenceOf<L>>)) => setData((old) => ({ ...old, ...(typeof change === 'function' ? change(old) : change) })), [setData]);
  return { ...loaded, patch };
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
