'use client';

import { useCallback, useRef } from 'react';

/** A request key: 32 hexadecimal characters from the browser's random source. */
export function newRequestKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The `Idempotency-Key` of a form's write (ADR 0019, D14). One key per operation: the same content sent again
 * (the answer was lost, or it was refused and nothing was changed) carries the same key, so the API answers the
 * first request instead of running a second one; changed content is another operation and gets another key.
 * `spent` ends the operation once it was answered: the next one starts with a new key, whatever its content.
 * The key lives in the component's memory only: never in the address, the page or storage.
 */
export function useRequestKey() {
  const held = useRef<{ key: string; of: string } | null>(null);
  const keyFor = useCallback((content: unknown): string => {
    const of = JSON.stringify(content);
    if (held.current?.of !== of) held.current = { key: newRequestKey(), of };
    return held.current.key;
  }, []);
  const spent = useCallback(() => {
    held.current = null;
  }, []);
  return { keyFor, spent };
}
