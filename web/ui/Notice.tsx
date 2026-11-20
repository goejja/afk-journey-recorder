import type { ReactNode } from 'react';

export type NoticeKind = 'error' | 'success' | 'warning';

/**
 * A line that tells the player how something went (docs/ui-conventions.md). An error is an alert, announced at once; a success and a
 * warning are a status, announced when the player is idle. The role comes with the kind, so it cannot be left out; the look is the
 * `.error` and `.badge.few` classes of styles.css, and a success is plain text. `as="span"` for a notice inside a line of text.
 */
export function Notice({ kind, as: Tag = 'p', title, children }: { kind: NoticeKind; as?: 'p' | 'span'; title?: string; children: ReactNode }) {
  return (
    <Tag className={kind === 'error' ? 'error' : kind === 'warning' ? 'badge few' : undefined} role={kind === 'error' ? 'alert' : 'status'} title={title}>
      {children}
    </Tag>
  );
}
