'use client';

import { useCallback, useSyncExternalStore, useMemo } from 'react';
import { copy, translateApi, type Locale } from './copy';

export const THEME_KEY = 'smilesim-theme';
export const LOCALE_KEY = 'smilesim-locale';

export type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function readLocale(): Locale {
  try {
    const value = localStorage.getItem(LOCALE_KEY);
    if (value === 'en' || value === 'he' || value === 'ar') return value;
  } catch {
    // Private mode can block storage. Arabic stays the default.
  }
  return 'ar';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
}

const serverMounted = () => false;
const clientMounted = () => true;
const subscribeNoop = () => () => {};

export function usePrefs() {
  const mounted = useSyncExternalStore(subscribeNoop, clientMounted, serverMounted);
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'light' as Theme);
  const locale = useSyncExternalStore(subscribe, readLocale, () => 'ar' as Locale);
  const activeLocale: Locale = mounted ? locale : 'ar';
  const activeTheme: Theme = mounted ? theme : 'light';

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    emit();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(LOCALE_KEY, next);
    applyLocale(next);
    emit();
  }, []);

  const apiText = useCallback(
    (message: string) => translateApi(activeLocale, message),
    [activeLocale],
  );
  const t = useMemo(() => copy[activeLocale], [activeLocale]);

  return { theme: activeTheme, locale: activeLocale, setLocale, toggleTheme, t, apiText };
}
