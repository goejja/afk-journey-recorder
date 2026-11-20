import type { ReactNode } from 'react';

/**
 * The card (a list item) of a battle (an Arena battle or a Dream Hunt day) in a record list: `header` is what the card says about the battle, then the
 * buttons (Show or Hide fights, Edit, Clone, what the list adds after Clone, Delete), and under them the fights when the card is open.
 */
export function GroupCard<F extends { id: number }>({
  label,
  fightsLabel,
  header,
  fights,
  open,
  onToggle,
  editTitle,
  onEdit,
  cloneTitle,
  onClone,
  cloneVariants,
  onDelete,
  renderFight,
}: {
  label: string;
  fightsLabel: string;
  header: ReactNode;
  fights: F[];
  open: boolean;
  onToggle: () => void;
  editTitle: string;
  onEdit: () => void;
  cloneTitle: string;
  onClone: () => void;
  cloneVariants?: ReactNode;
  onDelete: () => void;
  renderFight: (fight: F) => ReactNode;
}) {
  return (
    <li className="attempt" aria-label={label}>
      <div className="attempt-top">
        {header}
        <div className="attempt-actions">
          <button aria-expanded={open} onClick={onToggle}>
            {open ? 'Hide fights' : 'Show fights'}
          </button>
          <button title={editTitle} onClick={onEdit}>
            Edit
          </button>
          <button title={cloneTitle} onClick={onClone}>
            Clone
          </button>
          {cloneVariants}
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {open && (
        <ul className="battle-fights" aria-label={fightsLabel}>
          {fights.map((fight) => (
            <li key={fight.id} className="battle-fight">
              {renderFight(fight)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
