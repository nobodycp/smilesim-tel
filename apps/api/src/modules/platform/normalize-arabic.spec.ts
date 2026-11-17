import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeArabic } from './normalize-arabic';

// The table of plan DB.7. The web has no unit runner: its copy (apps/web/lib/normalize-arabic.ts) is pinned here by
// being the same file, byte for byte, so this table holds for it too.
const CASES: [string, string][] = [
  ['أحمد', 'احمد'],
  ['إيمان', 'ايمان'],
  ['آمنة', 'امنه'],
  ['ٱلنور', 'النور'],
  ['فاطمة', 'فاطمه'],
  ['مصطفى', 'مصطفي'],
  ['هانئ', 'هاني'],
  ['مؤمن', 'مومن'],
  ['مُحمّد', 'محمد'],
  ['سَعِيدٌ', 'سعيد'],
  ['رحمٰن', 'رحمن'],
  ['محـــمد', 'محمد'],
  ['نقطة ٣', 'نقطه 3'],
  ['۰۵۴۱', '0541'],
  ['  Ahmad   ALI  ', 'ahmad ali'],
  ['Pos_44', 'pos_44'],
  ['ء', 'ء'],
  ['شالوم', 'شالوم'],
  ['', ''],
];

describe('normalizeArabic', () => {
  it.each(CASES)('reads %p as %p', (text, expected) => {
    expect(normalizeArabic(text)).toBe(expected);
  });

  it('folds the decomposed forms the same way (a letter followed by its hamza or madda mark)', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('آمنة')).toBe('امنه');
  });

  it('is the same file in the web, so the screens filter names by the same rule', () => {
    const web = join(__dirname, '../../../../web/lib/normalize-arabic.ts');
    expect(existsSync(web)).toBe(true);
    expect(readFileSync(web, 'utf8')).toBe(readFileSync(join(__dirname, 'normalize-arabic.ts'), 'utf8'));
  });
});
