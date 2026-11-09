import type { Locale } from './copy';

export const THEME_KEY = 'smilesim-theme';
export const LOCALE_KEY = 'smilesim-locale';
export const PAGE_SIZE_KEY = 'smilesim-page-size';
export const PAGE_SIZES = [10, 15, 20] as const;
export type PageSize = (typeof PAGE_SIZES)[number] | 'all';
export const NAME_COOKIE = 'smilesim-name';
export const BALANCE_COOKIE = 'smilesim-balance';

export type Theme = 'light' | 'dark';

export function parseLocale(value: string | undefined | null): Locale {
  if (value === 'en' || value === 'he' || value === 'ar') return value;
  return 'ar';
}

export function parseTheme(value: string | undefined | null): Theme {
  // Dark is the default (Graphite, spec 2026-11-09-graphite-identity); only a saved «light» turns it off.
  return value === 'light' ? 'light' : 'dark';
}

export function parsePageSize(value: string | undefined | null): PageSize {
  if (value === 'all') return 'all';
  const size = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(size) ? (size as 10 | 15 | 20) : 10;
}

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'en' ? 'ltr' : 'rtl';
}
