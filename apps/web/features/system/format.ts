import type { Locale } from '../../lib/copy';

// The system monitor's figures for a reader: Latin digits everywhere (the app's rule), units in the reader's language
// where they are words (seconds, minutes, hours, days, through `Intl` so the plural is right: «3 ثوانٍ», «14 ثانية»),
// and the technical ones (ms, MB, %) Latin, as the request log writes them.

const UNITS = [
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
] as const;

function unit(locale: Locale, name: (typeof UNITS)[number]['unit'], value: number) {
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: 'unit', unit: name, unitDisplay: 'long' }).format(value);
}

/** A span of seconds in its two largest units: «45 ثانية», «12 دقيقة», «3 ساعات و12 دقيقة», "2 days, 4 hours". */
export function span(locale: Locale, totalSeconds: number): string {
  let rest = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];
  for (const { unit: name, seconds } of UNITS) {
    const count = Math.floor(rest / seconds);
    if (count > 0 || (name === 'second' && parts.length === 0)) parts.push(unit(locale, name, count));
    rest -= count * seconds;
    if (parts.length === 2 || (parts.length === 1 && count === 0)) break;
  }
  // Joined as the language joins units: «دقيقة و30 ثانية», "1 minute, 30 seconds".
  return new Intl.ListFormat(locale, { style: 'long', type: 'unit' }).format(parts);
}

/** A count of bytes in megabytes (or kilobytes under one), one decimal under 10 MB: «512 MB», «3.4 MB». */
export function megabytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024)).toLocaleString('en')} KB`;
  const mb = value / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb).toLocaleString('en')} MB`;
}

/** A share of 0 to 1 as a percentage with one decimal: «0.4%». */
export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** Milliseconds: «12 ms». */
export function millis(value: number): string {
  return `${value.toLocaleString('en')} ms`;
}
