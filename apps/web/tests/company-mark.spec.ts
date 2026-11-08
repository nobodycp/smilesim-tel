import { expect, test } from '@playwright/test';
import { compactImage, hueOf, markColor, markOf } from '../lib/company-mark';

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

test('markColor keeps white letters at 4.5:1 on every hue', () => {
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  for (let hue = 0; hue < 360; hue += 1) {
    const [, h, s, l] = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(markColor(String.fromCharCode(hue)))!.map(Number);
    expect(h).toBe(hue);
    // hsl → rgb, then relative luminance against white.
    const k = (n: number) => (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const rgb = [0, 8, 4].map((n) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
    const lum = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    expect(1.05 / (lum + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
