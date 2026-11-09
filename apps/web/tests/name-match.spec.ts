import { expect, test } from '@playwright/test';
import { fold, markOf, matchRank, rankNames } from '../lib/name-match';

// Name matching for NameField (spec 2026-11-09-admin-review, 2a): closest names first, Arabic-aware.

test('folding ignores marks and tatweel, and reads the letter forms as one', () => {
  expect(fold('أحمد')).toBe(fold('احمد'));
  expect(fold('إسراء')).toBe(fold('اسراء'));
  expect(fold('آمنة')).toBe(fold('امنه'));
  expect(fold('مُحَمَّد')).toBe('محمد');
  expect(fold('محـــمد')).toBe('محمد');
  expect(fold('مصطفى')).toBe(fold('مصطفي'));
  expect(fold('٠٥٥ ١٢٣')).toBe('055 123');
  expect(fold('۰۵۵')).toBe('055');
  expect(fold('  Café   NOIR ')).toBe('cafe noir');
  expect(fold('שלום')).toBe(fold('שלומ'));
});

test('ranks exact, then starts with, then a word starts with, then contains, then one letter off', () => {
  expect(matchRank('سلكوم', 'سلكوم')).toBe(0);
  expect(matchRank('سل', 'سلكوم')).toBe(1);
  expect(matchRank('كوم', 'شركة كوم')).toBe(2);
  expect(matchRank('امل', 'محل الأمل')).toBe(2);
  expect(matchRank('لكو', 'سلكوم')).toBe(3);
  expect(matchRank('سلكم', 'سلكوم')).toBe(4);
  expect(matchRank('بارتنر', 'سلكوم')).toBeNull();
  expect(matchRank('ab', 'ba')).toBeNull();
  expect(matchRank('امل', 'نقطة النور')).toBeNull();
  expect(matchRank('400', '100 جيجا')).toBeNull();
});

test('orders the suggestions by closeness, then by name, and keeps eight', () => {
  const options = [
    { value: '1', label: 'محل الأمل' },
    { value: '2', label: 'الأمل للاتصالات' },
    { value: '3', label: 'نقطة امل' },
    { value: '4', label: 'كاملة' },
    { value: '5', label: 'بعيد', keys: ['amal1'] },
  ];
  // Three names have a word that starts with it (two after «ال»), by name; «كاملة» only contains it.
  expect(rankNames('امل', options).map((row) => row.value)).toEqual(['2', '1', '3', '4']);
  expect(rankNames('الامل', options).map((row) => row.value)).toEqual(['2', '1']);
  expect(rankNames('amal', options).map((row) => row.value)).toEqual(['5']);
  expect(rankNames('', options).map((row) => row.value)).toEqual(['1', '2', '3', '4', '5']);
  const many = Array.from({ length: 20 }, (_, index) => ({ value: String(index), label: `نقطة ${index}` }));
  expect(rankNames('نقطة', many)).toHaveLength(8);
});

test('a match on the hint comes after any match on the name', () => {
  const options = [
    { value: 'a', label: 'سامر', hint: 'وكيل' },
    { value: 'b', label: 'وكيل الشمال', hint: 'وكيل رئيسي' },
  ];
  expect(rankNames('وكيل', options).map((row) => row.value)).toEqual(['b', 'a']);
});

test('marks the matched part in the name as written', () => {
  expect(markOf('امل', 'محل الأمل')).toEqual([6, 9]);
  expect(markOf('محمد', 'مُحَمَّد')).toEqual([0, 8]);
  expect(markOf('xyz', 'محل')).toBeNull();
});
