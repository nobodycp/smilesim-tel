'use client';

// The section name for the tab. A page announces its title; the shell renders the `<title>`
// element from it, the brand, and the unread count. React hoists that element into `<head>`,
// so it is the one source and nothing races `document.title` on a route change.

import { useEffect, useRef, useSyncExternalStore } from 'react';

let page = '';
// The page that wrote `page` last. On a route change the old page may clean up after the new
// one mounted, so a page only clears the title it still owns.
let owner: object | null = null;
const listeners = new Set<() => void>();

function set(next: string) {
  if (page === next) return;
  page = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Names the section in the tab. Pass '' to show the brand alone. */
export function usePageTitle(title: string) {
  const token = useRef({});
  useEffect(() => {
    owner = token.current;
    set(title);
  }, [title]);
  useEffect(() => {
    const mine = token.current;
    return () => {
      if (owner !== mine) return;
      owner = null;
      set('');
    };
  }, []);
}

/** The current section name, '' when the page has none. */
export function usePageTitleValue(): string {
  return useSyncExternalStore(subscribe, () => page, () => '');
}

/** `(unread) <page> · <brand>`, or `<brand>` alone. */
export function tabTitle(page: string, brand: string, unread: number): string {
  const base = page ? `${page} · ${brand}` : brand;
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
}
