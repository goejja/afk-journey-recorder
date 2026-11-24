import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function that keeps the same identity for the life of the component and always calls the latest `fn`. For the handlers a page gives to
 * a memoised row: a handler built from `run`, `reload` and the page's state changes on every render, and with it every row that gets it.
 * Call it only from events (a click), never while rendering: it is read after the render has committed.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
