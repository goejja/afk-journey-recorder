import type Database from "better-sqlite3";

/** Why a transaction was stopped: what `inTransaction` returns in place of the result. */
export interface Stopped<P> {
  problem: P;
}

class Stop<P> extends Error {
  constructor(readonly problem: P) {
    super("transaction stopped");
  }
}

/**
 * Runs `work` in a transaction. `work` calls `stop(problem)` to undo everything it wrote so far; the caller gets `{ problem }` back
 * instead of an exception, and any other error still propagates (and rolls back).
 */
export function inTransaction<T, P>(
  db: Database.Database,
  work: (stop: (problem: P) => never) => T,
): T | Stopped<P> {
  const stop = (problem: P): never => {
    throw new Stop(problem);
  };
  try {
    return db.transaction(() => work(stop))();
  } catch (e) {
    if (e instanceof Stop) return { problem: e.problem as P };
    throw e;
  }
}
