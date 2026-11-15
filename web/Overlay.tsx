import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A popup over the whole page. It is drawn from the document body, so that a sticky picker or a positioned map
 * slot somewhere above it in the page can never end up over it.
 */
export function Overlay({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return createPortal(
    <div className="overlay" onClick={onClick}>
      {children}
    </div>,
    document.body,
  );
}
