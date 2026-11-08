'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOffice } from './office-session';
import { usePrefs } from './prefs';
import type { Fetched } from './use-load';

type Options = {
  setError: (message: string) => void;
  setNote: (message: string) => void;
  // Runs after every successful action, usually the page's `reload`.
  onDone?: () => void | Promise<unknown>;
};

type Step<T> = {
  // What the page says on success: a fixed text, or one made from the answer. Nothing when absent.
  note?: string | ((data: T) => string);
  // Runs before `onDone` on success (close a dialog, clear a field).
  then?: (data: T) => void | Promise<unknown>;
  // false when the page is about to leave and a refresh would only race the navigation. Default true.
  reload?: boolean;
};

/**
 * Runs one write for a page: clears the previous message, marks the page busy, shows the
 * translated error, and refreshes the page on success. A second call while one is in flight is ignored.
 * `run` answers whether the write succeeded.
 */
export function useAction({ setError, setNote, onDone }: Options) {
  const { apiText } = usePrefs();
  const { refresh: refreshMe } = useOffice();
  const [busy, setBusy] = useState(false);
  const flying = useRef(false);
  const live = useRef(true);
  const done = useRef(onDone);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTicket = useRef(0);

  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  const run = useCallback(
    async function run<T>(work: () => Promise<Fetched<T>>, step: Step<T> = {}): Promise<boolean> {
      if (flying.current) return false;
      flying.current = true;
      noteTicket.current += 1;
      if (noteTimer.current) clearTimeout(noteTimer.current);
      setError('');
      setNote('');
      setBusy(true);
      try {
        const result = await work();
        if (!live.current) return false;
        if (!result.ok) {
          setError(apiText(result.message));
          return false;
        }
        if (step.note !== undefined) {
          const message = typeof step.note === 'function' ? step.note(result.data) : step.note;
          const mine = ++noteTicket.current;
          setNote(message);
          if (message) {
            noteTimer.current = setTimeout(() => {
              if (live.current && noteTicket.current === mine) setNote('');
            }, 4000);
          }
        }
        await step.then?.(result.data);
        // Any write can move the signed-in wallet (activate, charge, fund, refunds), so the topbar balance
        // is asked again in the background. Interim until the query cache (ADR 0001) invalidates `me`.
        void refreshMe();
        if (step.reload !== false) await done.current?.();
        return true;
      } finally {
        flying.current = false;
        if (live.current) setBusy(false);
      }
    },
    [apiText, refreshMe, setError, setNote],
  );

  return { run, busy };
}
