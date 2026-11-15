'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { Direction } from 'radix-ui';

type Dir = 'ltr' | 'rtl';

function readDocumentDir(): Dir {
  return document.documentElement.dir === 'ltr' ? 'ltr' : 'rtl';
}

function subscribe(onChange: () => void) {
  // The language switch (lib/prefs.tsx applyLocale) and the bootstrap script write `dir` on <html>.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
  return () => observer.disconnect();
}

/**
 * Gives every Radix primitive in components/ui the document's direction (ADR 0022), so menus, selects, tabs and
 * sliders follow Arabic and Hebrew right to left and English left to right. `dir` is the direction the server rendered
 * on <html> (app/layout.tsx); after hydration the provider follows the document's own `dir` attribute.
 */
export function DirectionProvider({ dir, children }: { dir: Dir; children: ReactNode }) {
  const serverDir = useCallback(() => dir, [dir]);
  const current = useSyncExternalStore(subscribe, readDocumentDir, serverDir);
  return <Direction.Provider dir={current}>{children}</Direction.Provider>;
}
