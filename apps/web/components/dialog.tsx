'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, KeyRound, LogIn, Plus, Shield, Snowflake, Trash2, Wallet, X } from 'lucide-react';
import { useConnection } from '../lib/connection';
import { usePrefs } from '../lib/prefs';
import { Alert } from './alert';
import { useToasts } from './toast';
import {
  Dialog as DialogRoot,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeading,
  DialogMark as DialogMarkTile,
  DialogTitle,
  type DialogMarkSize,
  type DialogSize,
} from './ui/dialog';
import { IconButton } from './ui/icon-button';

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
  // A saved action's message floats as a toast (components/toast.tsx), so the page under it does not move
  // (owner 2026-11-11). Each new message shows once; an empty one between two saves lets the same words show again.
  const { push } = useToasts();
  useEffect(() => {
    if (note) push(note, 'success');
  }, [note, push]);
  const { t } = usePrefs();
  // While the API is unreachable the shell's outage bar says so once; the page does not repeat it.
  const repeated = !reachable && error === t.errors.NETWORK;
  return (
    <DialogAlert.Provider value={setHeld}>
      {!held && !repeated ? <Alert>{error}</Alert> : null}
      {children}
    </DialogAlert.Provider>
  );
}

/**
 * The dialog every screen uses (DESIGN.md → Controls and primitives, "Overlays"), composed from components/ui/dialog.tsx on Radix Dialog
 * (Tailwind migration T2.5). It is shown while `open` and gone (its content unmounted) while not.
 *
 * Radix gives the portal, the `role="dialog"` named by the title and described by the lede, Tab and Shift+Tab
 * wrapping inside the panel, and the order of the layers (an open list or menu inside takes Escape and outside
 * presses first). It runs non-modal (`modal={false}`) on purpose: the NameField list and the date field's calendar
 * are drawn in their own portals on `<body>`, outside the panel, and Radix's modal mode would turn the pointer off
 * there, stop their scrolling and pull the focus back out of them. So the rest stays as it was: the panel says
 * `aria-modal="true"`, the page under it does not scroll, a click on the scrim (and only there) or Escape calls
 * `onClose`, the first field takes the focus on opening and the focus goes back to where it was on closing.
 */
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
  markSize = 'md',
  className = '',
  testId,
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  error?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  lede?: string;
  mark?: DialogMark;
  tone?: DialogTone;
  /** `lg`: the larger mark of a hand-off the customer reads (the activation result). */
  markSize?: DialogMarkSize;
  /** Extra class on the panel for a dialog family that needs its own spacing, such as the eSIM picture. */
  className?: string;
  /** `data-testid` on the panel, for an e2e spec that needs one dialog family (the activation result). */
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const holdAlert = useContext(DialogAlert);
  // Callers often pass an inline `onClose`. Reading it through a ref keeps the keyboard effect tied to `open` only,
  // so a parent re-render (each keystroke in a field) changes nothing.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  // The Escape that reached the dialog while it was the top layer (Radix calls `onEscapeKeyDown` only then, in the
  // capture phase, and marks the key handled, so `defaultPrevented` can no longer tell). It closes the dialog once it
  // has bubbled up to the window: a field that keeps Escape for itself (the NameField list) stops it on the way, at
  // the React root at the latest, and the dialog stays.
  const escape = useRef<KeyboardEvent | null>(null);

  useEffect(() => {
    if (!open || !error) return;
    holdAlert(true);
    return () => holdAlert(false);
  }, [open, error, holdAlert]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event === escape.current) closeRef.current();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  return (
    <DialogRoot open={open} modal={false}>
      <DialogContent
        ref={panel}
        size={size}
        className={className}
        data-testid={testId}
        aria-modal="true"
        onScrimClick={onClose}
        onOpenAutoFocus={(event) => {
          // The first field of the body (a Select's field is its trigger button; its hidden native select is not a
          // field), else the first control of the panel.
          event.preventDefault();
          const root = panel.current;
          const field = root?.querySelector<HTMLElement>('[data-slot="dialog-body"] input:not([type="checkbox"]):not([type="radio"]), [data-slot="dialog-body"] [data-slot="select-trigger"], [data-slot="dialog-body"] textarea');
          const first = [...(root?.querySelectorAll<HTMLElement>(focusable) ?? [])].find((node) => !node.hasAttribute('disabled'));
          (field ?? first)?.focus();
        }}
        // The focus goes back in the effect above, at once, as before.
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          escape.current = event;
        }}
        // Only the scrim closes it; a press in a list drawn outside the panel (NameField, the calendar) does not.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          {mark ? <DialogMarkTile tone={tone} size={markSize}><DialogGlyph name={mark} /></DialogMarkTile> : null}
          <DialogHeading>
            <DialogTitle>{title}</DialogTitle>
            {lede ? <DialogDescription>{lede}</DialogDescription> : null}
          </DialogHeading>
          <IconButton size="lg" tone="faint" className="flex-none" onClick={onClose} aria-label={closeLabel}><X size={18} aria-hidden="true" /></IconButton>
        </DialogHeader>
        <Alert>{error}</Alert>
        <DialogBody data-testid="dialog-body">{children}</DialogBody>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </DialogRoot>
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
