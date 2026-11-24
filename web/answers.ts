/**
 * The answers of the reads that return reference data (maps, heroes, artifacts, tags and the like), kept for the life of the page so that
 * moving between pages does not ask for them again. A read joins this cache by going through `keep` in `web/backend.ts`; nothing else
 * is held, and the reads that poll (job status, the import queue) must never join it.
 *
 * What clears it, and why that is every path that can change a cached answer:
 *  - any request that is not a GET, when it is sent and again when it settles (`call` in `web/backend.ts`): a save, a delete, an import
 *    apply, a tag edit in Admin, a profile change. A failed change may still have changed something, so it clears too;
 *  - a background job that finishes or fails (`JobsProvider`): an estimate or a review changes data without this tab asking.
 * A change made outside this tab (another tab, the query CLI) is not seen until the page is loaded again.
 *
 * An answer is frozen, so a page that sorts or edits what it was given in place fails at once instead of changing what the next page sees.
 * A read that fails is not kept. A read still on its way when the cache is cleared is not kept either: it left the map when it was cleared.
 */
const answers = new Map<string, Promise<unknown>>();

/** Freezes an answer from the server (plain JSON) and everything inside it. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}

/** The answer kept under `key`, or what `ask` returns, kept from now on; two readers asking at once share one request. */
export function keptAnswer<T>(key: string, ask: () => Promise<T>): Promise<T> {
  const held = answers.get(key);
  if (held) return held as Promise<T>;
  const pending = ask().then(freeze);
  answers.set(key, pending);
  pending.catch(() => {
    // only its own entry: after a clear a newer read may hold the key, and an old read settling never touches it
    if (answers.get(key) === pending) answers.delete(key);
  });
  return pending;
}

/** Forgets every kept answer: something that may have changed them happened. */
export function clearAnswers(): void {
  answers.clear();
}
