import { asciiDigits, searchTerms } from './search';

describe('asciiDigits', () => {
  it('writes Arabic-Indic and Eastern Arabic-Indic digits as ASCII and leaves everything else', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(asciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(asciiDigits('باقة ١٠٠ جيجا')).toBe('باقة 100 جيجا');
    expect(asciiDigits('abc 123')).toBe('abc 123');
  });
});

describe('searchTerms (spec 2026-11-17-scale-speed-cleanup, "Search (DB.6)")', () => {
  // [typed, digits (a number query) or null, what the number columns contain, the texts names are matched against]
  const cases: [string, string | null, string, string[]][] = [
    ['0541001234', '0541001234', '0541001234', ['0541001234']],
    [' 054 100 1234 ', '0541001234', '0541001234', ['054 100 1234']],
    ['054-100-1234', '0541001234', '0541001234', ['054-100-1234']],
    ['054–100—1234', '0541001234', '0541001234', ['054–100—1234']],
    ['+972541001234', '972541001234', '972541001234', ['+972541001234']],
    ['٠٥٤١٠٠١٢٣٤', '0541001234', '0541001234', ['٠٥٤١٠٠١٢٣٤', '0541001234']],
    ['۰۵۴ ۱۰۰', '054100', '054100', ['۰۵۴ ۱۰۰', '054 100']],
    ['100', '100', '100', ['100']],
    ['5', '5', '5', ['5']],
    ['100 جيجا', null, '100جيجا', ['100 جيجا']],
    ['١٠٠ جيجا', null, '100جيجا', ['١٠٠ جيجا', '100 جيجا']],
    ['سلكوم', null, 'سلكوم', ['سلكوم']],
    ['8997F2', null, '8997F2', ['8997F2']],
    ['+', null, '+', ['+']],
    ['05+5', null, '05+5', ['05+5']],
  ];

  it.each(cases)('reads %p', (typed, digits, number, names) => {
    expect(searchTerms(typed)).toEqual({ text: typed.trim(), digits, number, names });
  });

  it('is null when nothing was typed', () => {
    expect(searchTerms('')).toBeNull();
    expect(searchTerms('   ')).toBeNull();
    expect(searchTerms(undefined)).toBeNull();
  });
});
