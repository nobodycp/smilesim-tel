import { expect, test } from '@playwright/test';
import { compactImage, hueOf, markOf } from '../lib/company-mark';

// Pure logic: these run without a browser page.
test('markOf takes the initials of a long name and two letters of a short one', () => {
  expect(markOf('Cell Com')).toBe('CC');
  expect(markOf('Golan Telecom Israel Ltd')).toBe('GTI');
  expect(markOf('Partner')).toBe('Pa');
  expect(markOf('سلكوم')).toBe('سل');
  expect(markOf('  spaced   out ')).toBe('so');
  expect(markOf('')).toBe('');
});

test('hueOf is stable, inside the wheel, and differs between names', () => {
  expect(hueOf('Partner')).toBe(hueOf('Partner'));
  for (const name of ['', 'a', 'سلكوم', 'Golan Telecom Israel Ltd']) {
    const hue = hueOf(name);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  }
  expect(hueOf('')).toBe(0);
  expect(hueOf('Partner')).not.toBe(hueOf('Cellcom'));
});

test('compactImage refuses a file that is not a png, jpeg, or webp', async () => {
  expect(await compactImage(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }))).toBe('');
  expect(await compactImage(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBe('');
});
