'use client';

import { useSyncExternalStore } from 'react';
import { usePrefs } from './prefs';

const noSubscribe = () => () => {};

/**
 * The greeting and today's date for the home page's lede (moved from the topbar, spec 2026-11-09-graphite-identity).
 * Both depend on the browser's clock, so the server renders neither; one string, so the snapshot compares equal
 * between reads.
 */
export function useGreeting(): { hello: string; today: string } | null {
  const { t, locale } = usePrefs();
  const text = useSyncExternalStore(
    noSubscribe,
    () => {
      const now = new Date();
      const hello = now.getHours() < 12 ? t.goodMorning : now.getHours() < 18 ? t.goodAfternoon : t.goodEvening;
      const today = new Intl.DateTimeFormat(locale === 'en' ? 'en' : locale === 'he' ? 'he' : 'ar-u-nu-latn', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(now);
      return `${hello}\n${today}`;
    },
    () => null,
  );
  if (!text) return null;
  const [hello, today] = text.split('\n');
  return { hello, today };
}
