'use client';

// One reachability flag for the tab. `lib/api.ts` reports every answer; the browser's
// offline/online events feed the same flag. `generation` counts recoveries (false → true),
// so a hook that holds an error can fetch again the moment the API is back.

import { useSyncExternalStore } from 'react';

type Snapshot = { reachable: boolean; generation: number };

let snapshot: Snapshot = { reachable: true, generation: 0 };
const listeners = new Set<() => void>();
let wired = false;

function emit() {
  for (const listener of listeners) listener();
}

export function reportReach(reachable: boolean) {
  if (snapshot.reachable === reachable) return;
  snapshot = { reachable, generation: reachable ? snapshot.generation + 1 : snapshot.generation };
  emit();
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('offline', () => reportReach(false));
  window.addEventListener('online', () => reportReach(true));
}

function subscribe(listener: () => void) {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: Snapshot = { reachable: true, generation: 0 };

export function useConnection(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}
