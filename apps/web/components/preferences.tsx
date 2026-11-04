'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import { applyLocale, applyTheme, PrefsSeedProvider, readLocale, readTheme } from '../lib/prefs';
import type { Locale } from '../lib/copy';
import { LOCALE_KEY, THEME_KEY, type PageSize, type Theme } from '../lib/document-prefs';

export function Preferences({
  locale,
  theme,
  pageSize,
  children,
}: {
  locale: Locale;
  theme: Theme;
  pageSize: PageSize;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const nextTheme = readTheme();
    const nextLocale = readLocale();
    applyTheme(nextTheme);
    applyLocale(nextLocale);
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
      localStorage.setItem(LOCALE_KEY, nextLocale);
    } catch {
      // Private mode can block storage. The cookie still decides the next load.
    }
  }, []);
  return (
    <PrefsSeedProvider locale={locale} theme={theme} pageSize={pageSize}>
      {children}
    </PrefsSeedProvider>
  );
}
