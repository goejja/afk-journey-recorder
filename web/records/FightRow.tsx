import type { ReactNode } from 'react';
import { RecordRow } from '../ui/RecordRow.js';

/**
 * One fight of a record list (Dream Hunt and PvP): the first line (`info` on the left, the buttons on the right), the `children` under it,
 * and the note. Edit, Clone and Delete are the same everywhere; what a list adds goes in `leading` (before Edit) and `cloneVariants` (after Clone).
 */
export function FightRow({
  info,
  infoClassName,
  leading,
  cloneVariants,
  cloneTitle,
  onEdit,
  onClone,
  onDelete,
  note,
  noteClassName,
  children,
}: {
  info: ReactNode;
  infoClassName?: string;
  leading?: ReactNode;
  cloneVariants?: ReactNode;
  cloneTitle: string;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  note?: string | null;
  noteClassName?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <RecordRow
        infoClassName={infoClassName}
        actions={
          <>
            {leading}
            <button onClick={onEdit}>Edit</button>
            <button title={cloneTitle} onClick={onClone}>
              Clone
            </button>
            {cloneVariants}
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
          </>
        }
      >
        {info}
      </RecordRow>
      {children}
      {note && <p className={['muted', noteClassName].filter(Boolean).join(' ')}>{note}</p>}
    </>
  );
}
