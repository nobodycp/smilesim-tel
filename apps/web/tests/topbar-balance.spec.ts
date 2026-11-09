import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// The topbar wallet is read from `/office/me`. After a write that moves money, the shell asks for it again,
// so the balance in the topbar follows the wallet without a full reload. The branch has no wallet (spec
// 2026-11-09-admin-review, 7): this is a main agent funding one of its accounts.
test('the topbar balance follows a fund without a reload', async ({ page }) => {
  let balance = 100000;
  const me = { loginName: 'main1', nickname: 'رئيسي', layer: 'main_agent', isBranchOwner: false, grants: [], stops: [], impersonating: false, ceiling: 0 };
  const child = {
    loginName: 'ag1', nickname: 'وكيل', layer: 'agent', roleName: '', parentLogin: 'main1', ceiling: 0, frozen: false, self: false,
    directChild: true, canEnter: true, canFreeze: true, canDelete: true, balance: 0,
  };
  await serveOffice(page, 'main_agent', {
    'GET /me': () => ({ body: { ...me, balance } }),
    'GET /users': () => ({ body: { users: [child] } }),
    'POST /wallets/ag1/fund': () => {
      balance -= 25000;
      return { body: { ok: true } };
    },
  });
  await page.goto('http://main.localhost:3910/users');
  const wallet = page.locator('.wallet-chip .money');
  await expect(wallet).toHaveText('1000.00 ₪');
  // Funding sits in the row's «المحفظة» menu (spec 2026-11-08-overview-and-reports-nav, H).
  await page.getByRole('button', { name: /^المحفظة ag1/ }).click();
  await page.getByRole('menuitem', { name: 'تمويل' }).click();
  const dialog = page.getByRole('dialog', { name: 'تمويل' });
  await dialog.getByLabel('المبلغ').fill('250');
  await dialog.getByLabel('ملاحظة').fill('إيداع');
  await dialog.getByRole('button', { name: 'تمويل' }).click();
  await expect(wallet).toHaveText('750.00 ₪');
});

test('the branch has no wallet: no chip in the topbar, and /wallet goes home', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, expiringLines: 0, operations: [] } }) });
  await page.goto('http://admin.localhost:3910/');
  await expect(page.locator('.topbar .notice-btn')).toBeVisible();
  await expect(page.locator('.wallet-chip')).toHaveCount(0);
  await page.goto('http://admin.localhost:3910/wallet');
  await expect(page).toHaveURL('http://admin.localhost:3910/');
});

// The topbar's end, in reading order: the notices, the theme, then the language at the very end (spec
// 2026-11-09-admin-review, 8.6);
// the sidebar holds neither language nor theme.
test('the topbar ends with notices, theme and language, and the sidebar has neither preference', async ({ page }) => {
  await serveOffice(page, 'branch', { 'GET /home': () => ({ body: { pendingTasks: 0, activeLines: 0, inactiveLines: 0, expiringLines: 0, operations: [] } }) });
  await page.goto('http://admin.localhost:3910/');
  const order = await page.locator('.topbar-tools').evaluate((tools) =>
    [...tools.querySelectorAll('.lang > button, .shell-icon')].map((el) =>
      el.closest('.lang') ? 'lang' : el.classList.contains('notice-btn') ? 'notices' : el.getAttribute('aria-label')?.includes('الوضع') ? 'theme' : 'other'));
  expect(order.filter((name) => name !== 'other')).toEqual(['notices', 'theme', 'lang']);
  await expect(page.locator('.sidebar .shell-lang, .sidebar .lang, .drawer-prefs')).toHaveCount(0);
});
