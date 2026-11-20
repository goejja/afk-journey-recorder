import { recordLink } from '../../src/domain/record-link.js';

/** A link that opens a record's edit form on its own page, in a new tab; the plain id for a mode that names no page. */
export function RecordLink({ mode, id, label }: { mode: string; id: number; label?: string }) {
  const href = recordLink(mode, id);
  if (href === null) return <>{label ?? id}</>;
  return (
    <a href={href} target="_blank" rel="noopener" title={`Open record ${id} in its ${mode} page`}>
      {label ?? id}
    </a>
  );
}
