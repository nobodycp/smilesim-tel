'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, KeyRound, LogIn, Plus, Shield, Snowflake, Trash2, Wallet, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useConnection } from '../lib/connection';
import { usePrefs } from '../lib/prefs';

export type DialogMark = 'plus' | 'shield' | 'wallet' | 'transfer' | 'key' | 'freeze' | 'enter' | 'trash' | 'alert' | 'check';
export type DialogTone = 'neutral' | 'danger' | 'success';

const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const DialogAlert = createContext<(held: boolean) => void>(() => {});

export function PageAlert({
  error,
  note,
  children,
}: {
  error: string;
  note: string;
  children: ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const { reachable } = useConnection();
  const { t } = usePrefs();
  // While the API is unreachable the shell's outage bar says so once; the page does not repeat it.
  const repeated = !reachable && error === t.errors.NETWORK;
  return (
    <DialogAlert.Provider value={setHeld}>
      {error && !held && !repeated ? <p className="error" role="alert">{error}</p> : null}
      {note ? <p className="note" role="status">{note}</p> : null}
      {children}
    </DialogAlert.Provider>
  );
}

export function Dialog({
  open,
  title,
  closeLabel,
  onClose,
  error = '',
  children,
  footer,
  size = 'form',
  lede = '',
  mark,
  tone = 'neutral',
  className = '',
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  error?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'confirm' | 'form' | 'wide';
  lede?: string;
  mark?: DialogMark;
  tone?: DialogTone;
  /** Extra class on the panel for a dialog family that needs its own spacing, such as the activation result. */
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const holdAlert = useContext(DialogAlert);
  // Callers often pass an inline `onClose`. Reading it through a ref keeps the focus/keyboard effect tied to
  // `open` only, so a parent re-render (each keystroke in a field) does not move the focus back to the first field.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open || !error) return;
    holdAlert(true);
    return () => holdAlert(false);
  }, [open, error, holdAlert]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = panel.current;
    const nodes = () => [...(root?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter((node) => !node.hasAttribute('disabled'));
    const field = root?.querySelector<HTMLElement>('.dialog-body input:not([type="checkbox"]):not([type="radio"]), .dialog-body select, .dialog-body textarea');
    (field ?? nodes()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = nodes();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="dialog-scrim" onClick={onClose}>
      <div ref={panel} className={className ? `dialog ${className}` : 'dialog'} data-size={size} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          {mark ? <span className={tone === 'neutral' ? 'dialog-mark' : `dialog-mark ${tone}`}><DialogGlyph name={mark} /></span> : null}
          <div className="dialog-heading">
            <h2>{title}</h2>
            {lede ? <p className="dialog-lede">{lede}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}><X size={18} aria-hidden="true" /></button>
        </header>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

function DialogGlyph({ name }: { name: DialogMark }) {
  const Icon = {
    plus: Plus,
    shield: Shield,
    wallet: Wallet,
    transfer: ArrowRightLeft,
    key: KeyRound,
    freeze: Snowflake,
    enter: LogIn,
    trash: Trash2,
    alert: AlertTriangle,
    check: Check,
  }[name];
  return <Icon size={18} aria-hidden="true" />;
}
