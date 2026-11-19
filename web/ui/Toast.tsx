import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** How long a toast stays when the caller gives no time, and how long its fade-out takes, in milliseconds. */
export const TOAST_MS = 6000;
export const TOAST_FADE_MS = 200;

export interface ToastOptions {
  /** How long the toast stays before it fades, in milliseconds. */
  duration?: number;
}

type Show = (message: string, options?: ToastOptions) => void;

// outside a provider a toast is dropped, so a component that shows one can still be rendered alone
const ToastContext = createContext<Show>(() => {});

/** Shows a short message at the top right that fades by itself (docs/ui-conventions.md). */
export const useToast = (): Show => useContext(ToastContext);

interface Item {
  id: number;
  message: string;
  duration: number;
}

function ToastItem({ item, onDone }: { item: Item; onDone: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  // a toast under the pointer or holding focus stays, so there is time to read it
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held || leaving) return;
    const timer = setTimeout(() => setLeaving(true), item.duration);
    return () => clearTimeout(timer);
  }, [held, leaving, item.duration]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onDone(item.id), TOAST_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, item.id, onDone]);

  return (
    <div className={`toast${leaving ? ' leaving' : ''}`} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <span>{item.message}</span>
      <button aria-label="Close notification" title="Close" onClick={() => setLeaving(true)}>
        ✕
      </button>
    </div>
  );
}

/** Holds the toasts that are showing and draws them in a stack at the top right of the window. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(0);
  const show = useCallback<Show>((message, options) => setItems((old) => [...old, { id: next.current++, message, duration: options?.duration ?? TOAST_MS }]), []);
  const done = useCallback((id: number) => setItems((old) => old.filter((item) => item.id !== id)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status">
        {items.map((item) => (
          <ToastItem key={item.id} item={item} onDone={done} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
