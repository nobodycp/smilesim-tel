'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { copy, translateApi, type Locale } from './copy';
import { LOCALE_KEY, PAGE_SIZE_KEY, THEME_KEY, parseLocale, parsePageSize, type PageSize, type Theme } from './document-prefs';

type ApiError = string | { message: string; code?: string };

const COOKIE_AGE = 60 * 60 * 24 * 365;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_AGE}; SameSite=Lax`;
}

export function readTheme(): Theme {
  const fromCookie = readCookie(THEME_KEY);
  if (fromCookie === 'dark' || fromCookie === 'light') return fromCookie;
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function readLocale(): Locale {
  const fromCookie = readCookie(LOCALE_KEY);
  const parsed = parseLocale(fromCookie);
  if (fromCookie === 'en' || fromCookie === 'he' || fromCookie === 'ar') return parsed;
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

type Seed = { locale: Locale; theme: Theme; pageSize: PageSize };

const PrefsSeed = createContext<Seed>({ locale: 'ar', theme: 'dark', pageSize: 10 });

export function PrefsSeedProvider({ locale, theme, pageSize, children }: Seed & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, theme, pageSize }), [locale, theme, pageSize]);
  return <PrefsSeed.Provider value={value}>{children}</PrefsSeed.Provider>;
}

export function usePrefs() {
  const seeded = useContext(PrefsSeed);
  const theme = useSyncExternalStore(subscribe, readTheme, () => seeded.theme);
  const locale = useSyncExternalStore(subscribe, readLocale, () => seeded.locale);
  const pageSize = useSyncExternalStore(subscribe, () => parsePageSize(readCookie(PAGE_SIZE_KEY)), () => seeded.pageSize);

  const setTheme = useCallback((next: Theme) => {
    writeCookie(THEME_KEY, next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The cookie still decides the next load.
    }
    applyTheme(next);
    emit();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  const setPageSize = useCallback((next: PageSize) => {
    writeCookie(PAGE_SIZE_KEY, String(parsePageSize(String(next))));
    emit();
  }, []);

  const setLocale = useCallback((next: Locale) => {
    writeCookie(LOCALE_KEY, next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // The cookie still decides the next load.
    }
    applyLocale(next);
    emit();
  }, []);

  // Pages pass `result.message`; a caller that has the whole failure may pass it to use its code.
  const apiText = useCallback(
    (error: ApiError) =>
      typeof error === 'string' ? translateApi(locale, error) : translateApi(locale, error.message, error.code),
    [locale],
  );
  const t = copy[locale];

  return { theme, locale, pageSize, setPageSize, setLocale, toggleTheme, t, apiText };
}
