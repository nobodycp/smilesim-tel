/**
 * Name matching for `NameField` (spec 2026-11-09-admin-review, 2a): what a person types against the names on offer,
 * closest first. Arabic-aware: diacritics and tatweel are ignored, أ إ آ ٱ read as ا, ة as ه, ى and ئ as ي, ؤ as و;
 * Arabic-Indic digits equal Latin digits; Latin is case- and accent-blind; Hebrew final letters equal their base.
 */

export type NameOption = {
  value: string;
  label: string;
  /** A second line under the name (a layer, a company), searched too. */
  hint?: string;
  /** More text the option answers to (a login, a code), not shown. */
  keys?: string[];
};

const FOLD: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و',
  'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ',
};

/** Characters that carry no letter of their own: Arabic marks, tatweel, Hebrew points, Latin accents (after NFD). */
const SILENT = /[ً-ٰٟـ֑-ׇ̀-ͯ‌-‏]/;

function foldChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return FOLD[char] ?? char.toLowerCase();
}

/**
 * The folded text and, for each of its characters, the index of the character it came from in `text` — so a match
 * found in the folded text can be marked in the name as written.
 */
export function foldWithMap(text: string): { folded: string; from: number[] } {
  let folded = '';
  const from: number[] = [];
  let lastSpace = true;
  for (let index = 0; index < text.length; index += 1) {
    for (const part of text[index].normalize('NFD')) {
      if (SILENT.test(part)) continue;
      if (/\s/.test(part)) {
        if (lastSpace) continue;
        folded += ' ';
        from.push(index);
        lastSpace = true;
        continue;
      }
      folded += foldChar(part);
      from.push(index);
      lastSpace = false;
    }
  }
  if (folded.endsWith(' ')) {
    folded = folded.slice(0, -1);
    from.pop();
  }
  return { folded, from };
}

export const fold = (text: string) => foldWithMap(text).folded;

/** At most one edit apart (insert, delete, change, or two letters swapped). */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** 0 exact · 1 starts with · 2 a word starts with · 3 contains · 4 one letter off · null no match. */
export function matchRank(query: string, text: string): number | null {
  const q = fold(query);
  const t = fold(text);
  if (!q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  // A word counts from its start, or from after the Arabic article «ال» (typing «امل» finds «الأمل»).
  if (t.split(' ').some((word) => word.startsWith(q) || (word.startsWith('ال') && word.slice(2).startsWith(q)))) return 2;
  if (t.includes(q)) return 3;
  // Typos are for letters: «400» is not one key away from «100».
  if (q.length >= 3 && !/\d/.test(q)) {
    const words = [t, ...t.split(' ')];
    // A word's start of the same length (a changed or swapped letter) or one longer (a letter left out). A shorter
    // start would let «امل» find «النور» through «ال».
    if (words.some((word) => word.length >= q.length && (nearlyEqual(word.slice(0, q.length), q) || nearlyEqual(word.slice(0, q.length + 1), q)))) return 4;
  }
  return null;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(['ar', 'he', 'en'], { sensitivity: 'base', numeric: true }) : null;

/** The options that answer `query`, closest first, then by name; all of them, in their own order, for no query. */
export function rankNames<T extends NameOption>(query: string, options: readonly T[], limit = 8): T[] {
  if (!fold(query)) return options.slice(0, limit);
  const ranked: { option: T; rank: number }[] = [];
  for (const option of options) {
    let best: number | null = null;
    for (const text of [option.label, ...(option.keys ?? []), ...(option.hint ? [option.hint] : [])]) {
      const rank = matchRank(query, text);
      // A match on the hint (a layer, a company) counts after any match on the name itself.
      const weighted = rank === null ? null : text === option.hint ? rank + 5 : rank;
      if (weighted !== null && (best === null || weighted < best)) best = weighted;
    }
    if (best !== null) ranked.push({ option, rank: best });
  }
  ranked.sort((a, b) => a.rank - b.rank || (collator ? collator.compare(a.option.label, b.option.label) : a.option.label.localeCompare(b.option.label)));
  return ranked.slice(0, limit).map((row) => row.option);
}

/** Where `query` sits in `label` as written (start and end, end exclusive), for the bold part; null if it is not there. */
export function markOf(query: string, label: string): [number, number] | null {
  const q = fold(query);
  if (!q) return null;
  const { folded, from } = foldWithMap(label);
  const at = folded.indexOf(q);
  if (at < 0) return null;
  const end = at + q.length - 1;
  return [from[at], from[end] + 1];
}
