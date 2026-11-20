/**
 * The button under a list that is read a page at a time (docs/ui-conventions.md). With `left` it says how many rows are still to come and
 * draws nothing when none is left; without it the caller shows the button only while there is more. It is disabled while the next page
 * is on its way. The page owns the paging: `onMore` asks for the next page.
 */
export function ShowMore({ left, label = 'Show more', busy = false, onMore }: { left?: number; label?: string; busy?: boolean; onMore: () => void }) {
  if (left !== undefined && left <= 0) return null;
  return (
    <div className="actions">
      <button disabled={busy} onClick={onMore}>
        {left === undefined ? label : `${label} (${left} left)`}
      </button>
    </div>
  );
}
