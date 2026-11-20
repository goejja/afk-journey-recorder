/** The line a view shows until its first answer arrives (docs/ui-conventions.md). */
export function Loading() {
  return <p className="muted">Loading…</p>;
}

/**
 * What a list says when it has no rows (docs/ui-conventions.md): `Loading…` until its first answer, then the sentence for an empty list,
 * which is another one when a filter is on, and nothing after a failed load, because the alert beside it says why.
 */
export function ListStatus({ loaded, failed, empty, filtered, none, noMatch }: { loaded: boolean; failed: boolean; empty: boolean; filtered: boolean; none: string; noMatch: string }) {
  if (failed) return null;
  if (!loaded) return <Loading />;
  if (!empty) return null;
  return <p className="muted">{filtered ? noMatch : none}</p>;
}
