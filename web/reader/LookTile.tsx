import type { LookSource } from '../../src/shared/api.js';

const SOURCE_LABEL: Record<LookSource, string> = { roster: 'Roster import', battle: 'Battle import', offline: 'learn:ranks', review: 'Confirmed in Admin' };

/** Where a learned picture came from, for a label. */
export const sourceLabel = (source: LookSource | null) => (source ? SOURCE_LABEL[source] : 'Before sources were kept');

interface Props {
  src: string;
  alt: string;
  caption: string;
  source: LookSource | null;
  /** What the readers would take this picture for, when that is not what it is filed under. */
  looksLike: string | null;
  /** Names the buttons for assistive tools: "Delete <name>", "Move <name>". */
  name: string;
  current: string;
  options: string[];
  onMove: (to: string) => void;
  onDelete: () => void;
}

/** One learned picture with the two ways to fix it: file it under the right name, or delete it. */
export function LookTile({ src, alt, caption, source, looksLike, name, current, options, onMove, onDelete }: Props) {
  return (
    <li className={looksLike ? 'reader-tile flagged' : 'reader-tile'}>
      <img src={src} alt={alt} loading="lazy" />
      <span className="muted">{caption}</span>
      <span className="muted">{sourceLabel(source)}</span>
      {looksLike && <span className="warn-text">Looks like {looksLike}</span>}
      <select aria-label={`Move ${name}`} value="" onChange={(e) => e.target.value && onMove(e.target.value)}>
        <option value="">Move to…</option>
        {options.filter((o) => o !== current).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button className="danger small" aria-label={`Delete ${name}`} onClick={onDelete}>
        Delete
      </button>
    </li>
  );
}
