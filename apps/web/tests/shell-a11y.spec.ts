import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';
const home = { body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, operations: [] } };

// Graphite (spec 2026-11-09-graphite-identity): the account is at the sidebar's foot, not in the topbar.
test('the sidebar foot holds the account, which opens the profile, and signing out', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  await page.goto(`${admin}/`);
  const sidebar = page.locator('aside.sidebar');
  await expect(page.locator('.topbar .avatar-btn')).toHaveCount(0);
  await expect(sidebar.locator('.side-user')).toHaveAttribute('href', '/settings');
  await expect(sidebar.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
});

// «المحفظة» (spec 2026-11-09, 4): the balance chip is a link to the wallet page, also in the account menu.
test('the wallet chip opens the wallet page, and Escape on the notices gives the focus back', async ({ page }) => {
  // An agent: the branch has no wallet (spec 2026-11-09-admin-review, 7).
  await serveOffice(page, 'agent', {
    'GET /home': () => home,
    'GET /ledger': () => ({ body: { items: [{ id: 'e1', at: '2026-11-08T10:00:00.000Z', kind: 'fund', amount: 5000, balanceBefore: 0, balanceAfter: 5000, note: 'إيداع', packageName: null, msisdn: null, actorLogin: 'admin', loginName: 'admin', layer: 'branch', margin: null }], nextCursor: null, total: 1 } }),
  });
  const session = page.waitForResponse((response) => response.url().endsWith('/office/me'));
  await page.goto('http://agent.localhost:3910/');
  await session;
  const chip = page.getByRole('link', { name: 'المحفظة' }).first();
  await expect(chip).toHaveAttribute('href', '/wallet');
  await chip.click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole('heading', { name: 'المحفظة', level: 1 })).toBeVisible();
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'شحن الرصيد' }).click();
  await expect(page.getByText('طلبات الشحن قريباً', { exact: false })).toBeVisible();
  const bell = page.getByRole('button', { name: 'الإشعارات' });
  await bell.click();
  await expect(page.locator('.notice-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.notice-panel')).toHaveCount(0);
  await expect(bell).toBeFocused();
});

// Closed, the mobile drawer stays in the page off screen; it must not take the keyboard or screen readers.
test('the closed drawer is inert, and the open one is not', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  await page.goto(`${admin}/`);
  const drawer = page.locator('aside.drawer');
  await expect(drawer).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer).not.toHaveAttribute('inert');
});

// The collapsed sidebar is a browser preference (useSyncExternalStore over localStorage): it survives a reload.
test('a collapsed sidebar stays collapsed after a reload', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => home });
  await page.goto(`${admin}/`);
  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await sidebar.getByRole('button', { name: 'طي القائمة' }).click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await page.reload();
  await expect(sidebar).toHaveClass(/collapsed/);
  await sidebar.getByRole('button', { name: 'توسيع القائمة' }).click();
  await expect(sidebar).not.toHaveClass(/collapsed/);
});

// The step the sign-in left in sessionStorage decides the page: enrolling asks the API for a new secret, checking does not.
for (const step of ['enroll', 'verify'] as const) {
  test(`the two-factor page asks for a new secret only when enrolling (${step})`, async ({ page }) => {
    const setups: string[] = [];
    await page.route('**/auth/two-factor/setup', (route) => {
      setups.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ otpauth: 'otpauth://totp/x?secret=ABC' }) });
    });
    await page.addInitScript((value) => sessionStorage.setItem('twoFactorStep', value), step);
    await page.goto('/two-factor');
    await expect(page.locator('form')).toBeVisible();
    await page.waitForTimeout(500);
    expect(setups.length).toBe(step === 'enroll' ? 1 : 0);
  });
}
