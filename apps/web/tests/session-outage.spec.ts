import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const admin = 'http://admin.localhost:3910';
const me = { loginName: 'admin', nickname: 'الإدارة', layer: 'branch', isBranchOwner: true, grants: ['edit', 'reports', 'staff'], stops: [], impersonating: false, ceiling: 0 };

// While the API does not answer, the shell shows the outage instead of a page; once it answers, the page draws.
test('the shell shows the outage while /me does not answer, and the page once it does', async ({ page }) => {
  await page.context().addCookies([{ name: 'smilesim-locale', value: 'en', url: admin }]);
  let down = true;
  await serveOffice(page, 'branch', {
    'GET /me': () => (down ? { body: { message: 'down' }, status: 503 } : { body: { ...me, balance: 1000 } }),
    'GET /users': () => ({ body: { users: [] } }),
  });
  await page.goto(`${admin}/users`);
  await expect(page.getByText('Could not reach the server')).toBeVisible();
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Could not reach the server')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

// A write refreshes /me in the background. If that refresh fails, the page that was drawn stays drawn.
test('a failed background refresh of /me keeps the page on screen', async ({ page }) => {
  let meDown = false;
  const self = {
    loginName: 'admin', nickname: 'الإدارة', layer: 'branch', roleName: '', parentLoginName: null, balance: 1000, ceiling: 0, frozen: false, self: true,
    directChild: false, canEnter: false, canFreeze: false, canDelete: false,
  };
  await serveOffice(page, 'branch', {
    'GET /me': () => (meDown ? { body: { message: 'down' }, status: 503 } : { body: { ...me, balance: 1000 } }),
    'GET /users': () => ({ body: { users: [self] } }),
    'POST /wallets/admin/fund': () => {
      meDown = true;
      return { body: { ok: true } };
    },
  });
  await page.goto(`${admin}/users`);
  // Funding sits in the row's «المحفظة» menu (spec 2026-11-08-overview-and-reports-nav, H).
  await page.getByRole('button', { name: 'المحفظة admin (الإدارة)' }).click();
  await page.getByRole('menuitem', { name: 'تمويل' }).click();
  const dialog = page.getByRole('dialog', { name: 'تمويل' });
  await dialog.getByLabel('المبلغ').fill('5');
  await dialog.getByLabel('ملاحظة').fill('x');
  await dialog.getByRole('button', { name: 'تمويل' }).click();
  await page.waitForTimeout(1000);
  await expect(page.getByText('تعذّر الاتصال بالخادم')).toHaveCount(0);
  await expect(page.locator('.data tbody tr')).toHaveCount(1);
});
