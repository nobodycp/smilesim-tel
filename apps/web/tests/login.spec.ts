import { expect, test } from '@playwright/test';

test('login page is Arabic and sends the entered password', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByLabel('اسم الدخول').fill('pos');
  await page.getByLabel('كلمة السر').fill('123456');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible();
});
