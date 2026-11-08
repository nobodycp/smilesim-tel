import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const listed = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', roleName: '', parentLogin: 'admin', balance: -5000, ceiling: 20000, frozen: false,
  self: false, directChild: true, canEnter: true, canFreeze: true, canDelete: true, held: 2000,
};
const account = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'admin', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true, listed,
};

// The user page's head (spec 2026-11-08-inner-pages-refresh, §2b): status beside the name, fund and ceiling as
// buttons, the rest behind ⋯, the wallet as four cards, counts on the tabs.
test('the user page heads with its status, actions and wallet cards', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: { summary: { total: 3, visible: 3, custom: 2 }, companies: [] } }),
    'GET /users/pos1/ops': () => ({ body: { denied: ['sim'], deniedAbove: [] } }),
    'POST /wallets/pos1/fund': () => ({ body: { ok: true } }),
    'POST /wallets/pos1/deduct': () => ({ body: { ok: true } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  const head = page.locator('.page-head');
  await expect(head.locator('.ui-badge')).toHaveText('يعمل');
  await expect(head).toContainText('نقطة بيع · يتبع: admin');
  await expect(head.getByRole('button', { name: 'تمويل' })).toBeVisible();
  await expect(head.getByRole('button', { name: 'السقف' })).toBeVisible();
  await head.getByRole('button', { name: 'إجراءات أخرى' }).click();
  await expect(page.getByRole('menuitem', { name: 'تجميد' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'حذف' })).toBeVisible();
  await page.keyboard.press('Escape');

  const cards = page.locator('.stat');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0)).toContainText('-50.00 ₪');
  await expect(cards.nth(1)).toContainText('200.00 ₪');
  await expect(cards.nth(2)).toContainText('50.00 ₪');
  // 20 ₪ held for open tasks is not spendable: available is 200 − 50 − 20.
  await expect(cards.nth(3)).toContainText('20.00 ₪');
  await expect(cards.nth(4)).toContainText('130.00 ₪');
  await expect(cards.nth(4)).toHaveClass(/highlight/);
  await expect(page.getByRole('tab', { name: /الرزم والأسعار/ }).locator('.step-count')).toHaveText('2');
  await expect(page.getByRole('tab', { name: /عمليات الأرقام/ }).locator('.step-count')).toHaveText('1');

  await head.getByRole('button', { name: 'تمويل' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('25');
  await dialog.getByRole('button', { name: 'تمويل' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls).toContain('POST /wallets/pos1/fund');

  // Taking money back: from ⋯, with a reason and a note.
  await head.getByRole('button', { name: 'إجراءات أخرى' }).click();
  await page.getByRole('menuitem', { name: 'خصم' }).click();
  const back = page.getByRole('dialog');
  await back.getByLabel('السبب').selectOption('correction');
  await back.getByLabel('المبلغ').fill('10');
  await back.getByLabel('ملاحظة').fill('شحنة مكررة');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/office/wallets/pos1/deduct'));
  await back.getByRole('button', { name: 'خصم' }).click();
  expect((await sent).postDataJSON()).toEqual({ amount: 1000, note: 'شحنة مكررة', reason: 'correction' });
});
