'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import { applyLocale, applyTheme, readLocale, readTheme } from '../lib/prefs';

export function Preferences({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    applyTheme(readTheme());
    applyLocale(readLocale());
  }, []);
  return children;
}
