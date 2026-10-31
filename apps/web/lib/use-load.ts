'use client';

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { usePrefs } from './prefs';

// The shape every `api.*` call answers with. It is declared here, structurally,
// so a page can also build one from several calls (see `pick`).
export type Fetched<T> = { ok: true; data: T } | { ok: false; message: string };

// Turns the data of a successful call into another shape and passes a failure through.
export function pick<T, U>(result: Fetched<T>, map: (data: T) => U): Fetched<U> {
  return result.ok ? { ok: true, data: map(result.data) } : { ok: false, message: result.message };
}

type Options = { enabled?: boolean };

/**
 * Loads one thing for a page.
 *
 * `fetcher` may read anything from the render that created it; it always runs with the latest one.
 * `deps` lists the values whose change must fetch again (route params, filters). An answer that
 * arrives after the page left, or after a newer fetch started, is dropped.
 * The error is already translated by `apiText`. `enabled: false` waits (a layer guard, a URL read).
 */
export function useLoad<T>(fetcher: () => Promise<Fetched<T>>, deps: DependencyList = [], { enabled = true }: Options = {}) {
  const { apiText } = usePrefs();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(fetcher);
  const live = useRef(true);
  const ticket = useRef(0);

  useEffect(() => {
    latest.current = fetcher;
  });

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    const result = await latest.current();
    if (!live.current || mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setError('');
    setData(result.data);
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    if (enabled) void reload();
    // `deps` is the caller's list of what must trigger a new fetch; it is spread on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reload, ...deps]);

  return { data, error, loaded, reload };
}
