import { useEffect, type RefObject } from 'react';

/** While `open`, calls `close` on a click outside `root` and on Escape. */
export function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close();
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, root, close]);
}
