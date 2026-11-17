import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  /** The control the list belongs to: it opens under it, or above it when there is no room, and clicking it is not "outside". */
  anchor: HTMLElement;
  label: string;
  children: ReactNode;
  onClose: () => void;
}

/**
 * A short list next to the control that opened it, for a pick that takes one click (unlike a Dialog, it does not block the
 * Page, so the pointer stays beside the value). It closes when the person presses anywhere else, and when the page scrolls
 * or resizes, since it would no longer sit under its control. It has no keyboard handling of its own.
 */
export function Popover({ anchor, label, children, onClose }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const gap = 2;
    const below = window.innerHeight - a.bottom - gap;
    const above = a.top - gap;
    const wanted = el.scrollHeight;
    const under = wanted <= below || below >= above;
    const maxHeight = Math.max(0, under ? below : above);
    const height = Math.min(wanted, maxHeight);
    const width = Math.max(el.offsetWidth, a.width);
    const left = Math.min(Math.max(0, a.left + a.width / 2 - width / 2), window.innerWidth - width);
    setPlace({ top: under ? a.bottom + gap : a.top - gap - height, left, maxHeight });
  }, [anchor]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const scrolled = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose(); // the list may scroll inside itself
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div className="popover" role="group" aria-label={label} ref={box} style={place ?? { visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
