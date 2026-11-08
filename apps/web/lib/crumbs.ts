'use client';

// Names for the parts of the page trail (`components/crumbs.tsx`). A detail page names its own path, and may name
// the paths above it it knows (a package page names its provider). Names are kept for the session, so a part already
// seen keeps its name on the way back up.

import { useEffect, useSyncExternalStore } from 'react';

let names: Readonly<Record<string, string>> = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Names `path` (and any other paths given) in the trail. An empty name is ignored. */
export function useCrumbs(entries: Record<string, string | null | undefined>) {
  const key = JSON.stringify(entries);
  useEffect(() => {
    const given = JSON.parse(key) as Record<string, string | null | undefined>;
    const next = { ...names };
    let changed = false;
    for (const [path, name] of Object.entries(given)) {
      if (name && next[path] !== name) {
        next[path] = name;
        changed = true;
      }
    }
    if (!changed) return;
    names = next;
    for (const listener of listeners) listener();
  }, [key]);
}

export function useCrumbNames(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, () => names, () => names);
}
