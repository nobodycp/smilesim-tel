// What a person typed into a list's search box, read once for every list that searches (plan
// 2026-11-17-database-scale, DB.6; the rule is the spec's section "Search (DB.6)"). Pure: no database, no Nest.

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** Arabic-Indic (٠-٩, U+0660–U+0669) and Eastern Arabic-Indic (۰-۹, U+06F0–U+06F9) digits written as ASCII digits. */
export function asciiDigits(text: string): string {
  // Both ranges start at a code point whose low four bits are 0, so the low four bits are the digit.
  return text.replace(ARABIC_INDIC, (digit) => String(digit.charCodeAt(0) & 0xf));
}

/** What is dropped from a typed number: spaces and dashes (ASCII, the Unicode hyphens and dashes, the minus sign). */
const NUMBER_PUNCTUATION = /[\s\-‐-―−]/g;

export type SearchTerms = {
  /** What was typed, trimmed. */
  text: string;
  /** The texts a name is matched against: `text`, and `text` with ASCII digits when that differs. */
  names: string[];
  /**
   * The query as a number, when it is one: digits mapped to ASCII, spaces and dashes dropped, one leading `+`
   * dropped, and nothing but digits left. Null for any other query.
   */
  digits: string | null;
  /** What the number columns are matched against: `digits`, else the text with ASCII digits and no spaces. */
  number: string;
};

/** The search terms of a typed query; null when nothing (or only spaces) was typed. */
export function searchTerms(q: string | undefined | null): SearchTerms | null {
  const text = (q ?? '').trim();
  if (!text) return null;
  const ascii = asciiDigits(text);
  const bare = ascii.replace(NUMBER_PUNCTUATION, '').replace(/^\+/, '');
  const digits = /^\d+$/.test(bare) ? bare : null;
  return { text, names: ascii === text ? [text] : [text, ascii], digits, number: digits ?? ascii.replace(/\s/g, '') };
}
