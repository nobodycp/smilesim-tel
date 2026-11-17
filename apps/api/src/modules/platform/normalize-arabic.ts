// One rule for matching names as people type them in Arabic (plan 2026-11-17-database-scale, DB.7; spec
// 2026-11-17-scale-speed-cleanup, decision 6). This file is kept byte for byte the same in the API
// (apps/api/src/modules/platform/normalize-arabic.ts) and the web (apps/web/lib/normalize-arabic.ts), so a name the
// server's search finds is the name the screens' own filters find; normalize-arabic.spec.ts in the API pins both.
// The fold of the web's name picker (apps/web/lib/name-match.ts) uses the same letters and marks.

/** The letters read as another: the hamza forms of alef, alef maqsura, hamza on ya and on waw, ta marbuta. */
const LETTERS: Record<string, string> = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه' };

/** The marks that carry no letter: the harakat and other marks (U+064B–U+065F), the dagger alef (U+0670), tatweel. */
const MARKS = /[ً-ٰٟـ]/g;

/**
 * A name or a query as it is compared: the marks removed, the letters above folded, Arabic-Indic (٠-٩) and Eastern
 * Arabic-Indic (۰-۹) digits as ASCII, Latin in lower case, spaces trimmed and runs of spaces made one. Both sides of
 * a comparison go through it.
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(MARKS, '')
    .replace(/[أإآٱىئؤة]/g, (letter) => LETTERS[letter] ?? letter)
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 0xf))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
