import { ar, type Copy } from './ar';
import { en } from './en';
import { he } from './he';

export type { Copy };

export const locales = ['ar', 'en', 'he'] as const;
export type Locale = (typeof locales)[number];

// All three languages are static imports. Loading en and he on demand was measured and saved
// 4.5 KB gzip on every page, under the 5 KB bar, so it was not worth a second render path.
export const copy: Record<Locale, Copy> = { ar, en, he };

// API errors carry a stable `code`; the text of every code lives once, under `errors` in each
// language. The same table read backwards (Arabic sentence -> code) lets a caller that only has
// the `message`, such as an older API, still get a translation.
const codeByMessage = new Map<string, string>(Object.entries(ar.errors).map(([code, message]) => [message, code]));

function textOf(locale: Locale, code: string | undefined): string | undefined {
  if (!code) return undefined;
  return (copy[locale].errors as Record<string, string | undefined>)[code];
}

/**
 * The text of an API error in the reader's language: by `code` first, then by the Arabic
 * `message` read backwards to its code, then the message as the server sent it.
 */
export function translateApi(locale: Locale, message: string, code?: string): string {
  if (locale === 'ar') return message;
  return textOf(locale, code) ?? textOf(locale, codeByMessage.get(message)) ?? message;
}

export const langLabel: Record<Locale, string> = {
  ar: 'ع',
  en: 'EN',
  he: 'עב',
};

export const langName: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
  he: 'עברית',
};
