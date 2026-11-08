import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// The topbar wallet is read from `/office/me`. After a write that moves money, the shell asks for it again,
// so the balance in the topbar follows the wallet without a full reload.
test('the topbar balance follows a fund without a reload', async ({ page }) => {
  let balance = 1000;
  const me = { loginName: 'admin', nickname: 'الإدارة', layer: 'branch', isBranchOwner: true, grants: ['edit', 'reports', 'staff'], stops: [], impersonating: false, ceiling: 0 };
  const self = {
    loginName: 'admin', nickname: 'الإدارة', layer: 'branch', roleName: '', parentLogin: null, ceiling: 0, frozen: false, self: true,
    directChild: false, canEnter: false, canFreeze: false, canDelete: false,
  };
  await serveOffice(page, 'branch', {
    'GET /me': () => ({ body: { ...me, balance } }),
    'GET /users': () => ({ body: { users: [{ ...self, balance }] } }),
    'POST /wallets/admin/fund': () => {
      balance += 25000;
      return { body: { ok: true } };
    },
  });
  await page.goto('http://admin.localhost:3910/users');
  const wallet = page.locator('.wallet-chip .money');
  await expect(wallet).toHaveText('10.00 ₪');
  await page.getByRole('button', { name: 'إجراءات admin (الإدارة)' }).click();
  await page.getByRole('menuitem', { name: 'تمويل' }).click();
  const dialog = page.getByRole('dialog', { name: 'تمويل' });
  await dialog.getByLabel('المبلغ').fill('250');
  await dialog.getByLabel('ملاحظة').fill('إيداع');
  await dialog.getByRole('button', { name: 'تمويل' }).click();
  await expect(wallet).toHaveText('260.00 ₪');
});
