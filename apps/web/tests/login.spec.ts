import { expect, test } from '@playwright/test';

test('login page is Arabic and sends the entered password', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByLabel('اسم الدخول').fill('pos');
  await page.getByLabel('كلمة السر').fill('123456');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible();
});

test('ending the current session returns to login', async ({ page }) => {
  let listCalls = 0;
  await page.route('**/auth/sessions', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    listCalls += 1;
    if (listCalls === 1) return route.fallback();
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'يلزم تسجيل الدخول' }),
    });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'إنهاء' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a missing session opens the login page', async ({ page }) => {
  await page.route('**/auth/sessions', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'يلزم تسجيل الدخول' }),
    }),
  );
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});

test('settings starts authenticator enrollment and confirms it', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'تفعيل التحقق بخطوتين' }).click();
  await expect(page.getByText('otpauth://totp/Smilesim:pos?secret=MOCKSECRET')).toBeVisible();
  await page.getByLabel('الرمز').fill('123456');
  await page.getByRole('button', { name: 'تأكيد التفعيل' }).click();
  await expect(page.getByText('تم تفعيل التحقق بخطوتين', { exact: true })).toBeVisible();
});
