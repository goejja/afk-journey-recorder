import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Overlay } from '../Overlay.js';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type InitialFocus = 'cancel' | 'confirm' | 'input';

interface DialogProps {
  title: string;
  message?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onCancel: () => void;
  initialFocus?: InitialFocus;
  busy?: boolean;
  /** A picker may close when the person clicks beside it; a confirmation never does. */
  closeOnBackdrop?: boolean;
  /** A Dialog that holds a card: it slides in from the right edge, full height, instead of sitting in the middle. */
  side?: boolean;
}

/**
 * A Dialog blocks the Page until the person answers. It traps focus, closes on Escape, and gives focus back to
 * whatever opened it. The backdrop closes it only when the Dialog is a picker.
 */
export function Dialog({ title, message, children, actions, onCancel, initialFocus = 'confirm', busy = false, closeOnBackdrop = false, side = false }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target =
      initialFocus === 'cancel'
        ? box.current?.querySelector<HTMLElement>('[data-cancel]')
        : initialFocus === 'confirm'
          ? box.current?.querySelector<HTMLElement>('[data-confirm]')
          : box.current?.querySelector<HTMLElement>('input, textarea');
    (target ?? box.current)?.focus();
    return () => previous?.focus();
  }, [initialFocus]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <Overlay onClick={closeOnBackdrop && !busy ? onCancel : undefined} side={side}>
      <div
        className={side ? 'overlay-box side' : 'overlay-box'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={box}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId}>{title}</h3>
        {message && <p className="muted">{message}</p>}
        {children}
        {actions}
      </div>
    </Overlay>
  );
}

export interface ConfirmOptions {
  /** The question, naming the object and what happens to it. */
  title: string;
  /** An optional second paragraph, for the detail behind the question. */
  message?: string;
  confirmLabel?: string;
  /** A destructive answer is drawn in red and starts on Cancel, so Enter cannot delete by accident. */
  danger?: boolean;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      message={message}
      onCancel={onCancel}
      initialFocus={danger ? 'cancel' : 'confirm'}
      actions={
        <div className="overlay-actions">
          <button className={danger ? 'danger' : 'primary'} data-confirm onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button data-cancel onClick={onCancel}>
            Cancel
          </button>
        </div>
      }
    />
  );
}

export interface NameOptions {
  /** The question, naming the thing being created. */
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
}

export interface NameDialogProps extends NameOptions {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NameDialog({
  title,
  label = 'Name',
  initialValue = '',
  confirmLabel = 'Create',
  onConfirm,
  onCancel,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const submit = () => {
    const name = value.trim();
    if (name) onConfirm(name);
  };
  return (
    <Dialog
      title={title}
      onCancel={onCancel}
      initialFocus="input"
      actions={
        <div className="overlay-actions">
          <button className="primary" data-confirm onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
          <button data-cancel onClick={onCancel}>
            Cancel
          </button>
        </div>
      }
    >
      <label className="field dialog-field">
        {label}
        <input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Dialog>
  );
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** Asks a question and resolves true when the person confirms. Render `dialog` in the component that asks. */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const current = useRef<ConfirmRequest | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false); // a second question replaces the first, so no caller waits forever
        const request = { ...options, resolve };
        current.current = request;
        setPending(request);
      }),
    [],
  );
  const settle = (ok: boolean) => {
    const request = current.current;
    if (!request) return;
    current.current = null;
    request.resolve(ok);
    setPending(null);
  };
  const dialog = pending && (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return { confirm, dialog };
}

interface NameRequest extends NameOptions {
  resolve: (name: string | null) => void;
}

/** Asks for a name and resolves it, or null when the person cancels. Render `dialog` in the component that asks. */
export function useNameDialog() {
  const [pending, setPending] = useState<NameRequest | null>(null);
  const current = useRef<NameRequest | null>(null);
  const name = useCallback(
    (options: NameOptions) =>
      new Promise<string | null>((resolve) => {
        current.current?.resolve(null);
        const request = { ...options, resolve };
        current.current = request;
        setPending(request);
      }),
    [],
  );
  const settle = (value: string | null) => {
    const request = current.current;
    if (!request) return;
    current.current = null;
    request.resolve(value);
    setPending(null);
  };
  const dialog = pending && (
    <NameDialog
      title={pending.title}
      label={pending.label}
      initialValue={pending.initialValue}
      confirmLabel={pending.confirmLabel}
      onConfirm={settle}
      onCancel={() => settle(null)}
    />
  );
  return { name, dialog };
}
