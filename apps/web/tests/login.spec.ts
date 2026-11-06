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
  // Once the session is ended, every later list answers 401 and the shell sends the tab to login.
  let ended = false;
  await page.route('**/auth/sessions/*', (route) => {
    if (route.request().method() === 'DELETE') ended = true;
    return route.fallback();
  });
  await page.route('**/auth/sessions', (route) => {
    if (route.request().method() !== 'GET' || !ended) return route.fallback();
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'يلزم تسجيل الدخول' }),
    });
  });
  await page.goto('/settings');
  // Ending a session lives in the row menu: open it for the session, then choose the item.
  await page.getByRole('button', { name: /^إنهاء/ }).click();
  await page.getByRole('menuitem', { name: 'إنهاء' }).click();
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

test('settings reads the login name and details from the profile, not from sessionStorage', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('loginName', 'stale-name'));
  await page.goto('/settings');
  await expect(page.getByLabel('اسم الدخول')).toHaveValue('pos');
  await expect(page.getByLabel('الاسم الكامل')).toHaveValue('الكاشير');
  await expect(page.getByLabel('المدينة')).toHaveValue('ramallah');
  await expect(page.getByLabel('العنوان')).toHaveValue('شارع الإرسال');
  await expect(page.getByLabel('البريد')).toHaveValue('pos@example.com');
});
