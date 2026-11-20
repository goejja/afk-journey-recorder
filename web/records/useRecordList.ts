import { useEffect, useState, type DependencyList } from 'react';
import { useAction } from '../hooks/action.js';
import { useLoad } from '../hooks/load.js';

/** How many fights a record list loads at first and each time "Show older" is pressed. */
export const PAGE = 100;

/**
 * The state both record lists (Dream Hunt and PvP) keep besides their filters and forms: the fights read a page at a time, `notice` for
 * what a plain Save left undone (shown after its form has closed, and dropped when another form opens), and `run` for the actions of the
 * list (a delete), whose `error` an answer of the list clears. `load` is asked for `limit` fights; `deps` are the filters it reads.
 */
export function useRecordList<F>({ load, deps, formOpen }: { load: (limit: number) => Promise<F[]>; deps: DependencyList; formOpen: boolean }) {
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState<string | null>(null);
  const { run, error, setError } = useAction();
  const loaded = useLoad(() => load(limit), [...deps, limit]);

  useEffect(() => {
    if (formOpen) setNotice(null);
  }, [formOpen]);
  // an answer clears what an action here failed to do, as the answer of the list did before
  useEffect(() => {
    if (loaded.data) setError(null);
  }, [loaded.data, setError]);

  return { loaded, limit, showMore: () => setLimit((old) => old + PAGE), notice, setNotice, run, error: error ?? loaded.error };
}
