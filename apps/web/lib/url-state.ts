'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * A list's filters live in the address (`?status=frozen&q=055`): back and forward restore them, a link can open a
 * filtered list, and the shell search can send `/users?q=` to the page it is already on. Writing replaces the
 * history entry (no entry per keystroke) and keeps the scroll. An empty value leaves the address.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const signature = keys.map((key) => `${key}=${params.get(key) ?? ''}`).join('&');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the read of `params` for these keys
  const values = useMemo(() => Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ''])) as Record<K, string>, [signature]);

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      // Read the address as it is now, so two writes in one event both land.
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch) as [K, string | undefined][]) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  return [values, set] as const;
}

/**
 * The text of a search field whose committed value lives in the address. Typing stays local and is committed after
 * a pause; a change of the address from elsewhere (the shell search, "clear") replaces what is typed.
 */
export function useDebouncedField(committed: string, commit: (value: string) => void, delay = 300) {
  const [text, setText] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    // Our own commit of what is typed leaves the field alone (a trailing space stays while typing on).
    if (committed !== text.trim()) setText(committed);
  }
  useEffect(() => {
    const value = text.trim();
    if (value === committed) return;
    const timer = window.setTimeout(() => commit(value), delay);
    return () => window.clearTimeout(timer);
  }, [text, committed, commit, delay]);
  return [text, setText] as const;
}
