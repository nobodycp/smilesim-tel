import { expect, test } from '@playwright/test';
import { balance, closeDb, login } from './kit';

test.afterAll(closeDb);

test('the branch and the point of sale sign in on their own doors against the real API', async ({ page }) => {
  await login(page, 'admin', 'branch');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await login(page, 'pos', 'pos');
  expect(await balance('pos')).toBe(0);
});
