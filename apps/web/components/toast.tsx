'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Toast, ToastClose, ToastIcon, ToastProvider, ToastText, ToastViewport } from './ui/toast';

type Tone = 'success' | 'error';
type Item = { id: number; text: string; tone: Tone };

const ToastContext = createContext<{ push: (text: string, tone: Tone) => void; hold: (text: string) => void } | null>(null);

export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('toasts');
  return context;
}

/**
 * The toasts (owner 2026-11-11), composed from components/ui/toast.tsx on Radix Toast (Tailwind migration T2.6):
 * stacked under the top bar at the reading end (the whole width on a phone), over the page, at most three, the
 * newest last, each with its tone's icon; each closes from its «×» or by itself — a success after 4.6s, an error after
 * 9s, long enough to read on a phone (this timer, not Radix's, so hovering does not hold it). Every outcome a page
 * reports shows here, the errors too (owner, 2026-11-17: one place, always in view). A page's own error is *held*
 * (`hold`): it stays for as long as the page reports it, first in the stack, with no timer — the same words reported
 * twice are still on screen the second time — and its «×» puts it away until the page reports something else. Kept from the legacy toasts:
 * - each toast is its own live region, `role="status"` (`role="alert"` for an error), as before. Radix's own
 *   announcer, which would read every message a second time and put a second copy of its words in the page, is
 *   drawn into a fragment that never joins the document;
 * - no hotkey moves the focus to the toasts (Radix's F8 is turned off) and no swipe closes one.
 * New with Radix: the toasts sit in a region named `t.toasts`, and Escape closes the newest toast while it is the
 * top layer (a dialog or menu under it takes the next Escape).
 */
export function Toasts({ children }: { children: ReactNode }) {
  const { t } = usePrefs();
  const [items, setItems] = useState<Item[]>([]);
  const [announcer] = useState(() => (typeof document === 'undefined' ? undefined : document.createDocumentFragment()));
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  // The page's standing error: shown while the page reports it, unless the reader closed these very words.
  const [held, setHeld] = useState('');
  const [closed, setClosed] = useState('');
  const hold = useCallback((text: string) => {
    setHeld(text);
    if (!text) setClosed('');
  }, []);
  const push = useCallback((text: string, tone: Tone) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 4600);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ push, hold }}>
      <ToastProvider label={t.toasts} duration={Number.POSITIVE_INFINITY} swipeThreshold={Number.POSITIVE_INFINITY} announcerContainer={announcer}>
        {children}
        {held && held !== closed ? (
          <Toast tone="error" role="alert" data-held="" onOpenChange={(open) => { if (!open) setClosed(held); }}>
            <ToastIcon><CircleAlert size={20} /></ToastIcon>
            <ToastText>{held}</ToastText>
            <ToastClose aria-label="×">×</ToastClose>
          </Toast>
        ) : null}
        {items.map((item) => (
          <Toast
            key={item.id}
            tone={item.tone}
            role={item.tone === 'error' ? 'alert' : 'status'}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          >
            <ToastIcon>{item.tone === 'error' ? <CircleAlert size={20} /> : <CircleCheck size={20} />}</ToastIcon>
            <ToastText>{item.text}</ToastText>
            <ToastClose aria-label="×">×</ToastClose>
          </Toast>
        ))}
        <ToastViewport label={t.toasts} hotkey={[]} />
      </ToastProvider>
    </ToastContext.Provider>
  );
}
