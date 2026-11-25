import type { MouseEventHandler, ReactElement } from 'react';

export type IconName = 'chevron-right' | 'chevron-down' | 'close' | 'minus' | 'info' | 'star' | 'swap';

/** The shapes on a 16 by 16 grid. The chevrons are solid triangles; the rest are thin rounded strokes (`.icon-solid`, `.icon` in styles.css). */
const SHAPES: Record<IconName, { solid?: boolean; draw: ReactElement }> = {
  'chevron-right': { solid: true, draw: <path d="M5 2.8 12 8l-7 5.2z" /> },
  'chevron-down': { solid: true, draw: <path d="M2.8 5 8 12l5.2-7z" /> },
  close: { draw: <path d="M4 4l8 8M12 4l-8 8" /> },
  minus: { draw: <path d="M3.5 8h9" /> },
  info: {
    draw: (
      <>
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 7.3V11M8 5h.01" />
      </>
    ),
  },
  swap: { draw: <path d="M13 6.5A5.2 5.2 0 0 0 3.4 5M3 2.4V5.2h2.8M3 9.5a5.2 5.2 0 0 0 9.6 1.5M13 13.6v-2.8h-2.8" /> },
  star: { draw: <path d="M8 1.9l1.9 3.9 4.2.6-3.1 3 .8 4.2L8 11.6l-3.8 2 .8-4.2-3.1-3 4.2-.6z" /> },
};

/**
 * An icon (docs/ui-conventions.md): an inline SVG that is one em square and takes the colour of the text around it. It is decoration, hidden from
 * the accessibility tree; an icon that is the only content of a control goes through `IconButton`, which names the control.
 */
export function Icon({ name }: { name: IconName }) {
  const { solid, draw } = SHAPES[name];
  return (
    <svg className={`icon${solid ? ' icon-solid' : ''}${name === 'star' ? ' icon-star' : ''}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {draw}
    </svg>
  );
}

/** The open or closed mark of a disclosure toggle: a triangle that points down when open and right when closed. */
export function DisclosureMark({ open }: { open: boolean }) {
  return <Icon name={open ? 'chevron-down' : 'chevron-right'} />;
}

/** A button with an icon and no text. `label` is required: it is both the accessible name and the tooltip. */
export function IconButton({ icon, label, onClick, className, disabled }: { icon: IconName; label: string; onClick: MouseEventHandler<HTMLButtonElement>; className?: string; disabled?: boolean }) {
  return (
    <button type="button" className={className} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}
