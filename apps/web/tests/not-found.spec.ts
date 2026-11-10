import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// An address the app does not serve draws the shared empty state inside the shell, with the way home.
test('an unknown address shows the not-found screen inside the shell, with a way home', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, operations: [] } }),
  });
  const response = await page.goto('http://admin.localhost:3910/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByText('الصفحة غير موجودة')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
  await expect(page).toHaveURL('http://admin.localhost:3910/');
});
