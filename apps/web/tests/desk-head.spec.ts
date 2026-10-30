import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('settings keeps its lede and does not gain a second copy of the title', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.lede')).toBeVisible();
});

test('Desk accepts an action slot and skips an empty lede', () => {
  const source = readFileSync('components/desk.tsx', 'utf8');
  expect(source).toContain('action?:');
  expect(source).toContain('{lede ?');
});
