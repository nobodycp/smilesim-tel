'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Toast, ToastClose, ToastProvider, ToastText, ToastViewport } from './ui/toast';

type Tone = 'success' | 'error';
type Item = { id: number; text: string; tone: Tone };

const ToastContext = createContext<{ push: (text: string, tone: Tone) => void } | null>(null);

export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('toasts');
  return context;
}

/**
 * The toasts (owner 2026-11-11), composed from components/ui/toast.tsx on Radix Toast (Tailwind migration T2.6):
 * stacked in the reading-end bottom corner, over the page, at most three, the newest last; each closes from its «×»
 * or by itself after 4.6s (this timer, not Radix's, so hovering does not hold it). Kept from the legacy toasts:
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
  const push = useCallback((text: string, tone: Tone) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => dismiss(id), 4600);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ push }}>
      <ToastProvider label={t.toasts} duration={Number.POSITIVE_INFINITY} swipeThreshold={Number.POSITIVE_INFINITY} announcerContainer={announcer}>
        {children}
        {items.map((item) => (
          <Toast
            key={item.id}
            tone={item.tone}
            role={item.tone === 'error' ? 'alert' : 'status'}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          >
            <ToastText>{item.text}</ToastText>
            <ToastClose aria-label="×">×</ToastClose>
          </Toast>
        ))}
        <ToastViewport label={t.toasts} hotkey={[]} />
      </ToastProvider>
    </ToastContext.Provider>
  );
}
