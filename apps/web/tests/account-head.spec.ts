import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const listed = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', roleName: '', parentLoginName: 'admin', balance: -5000, ceiling: 20000, frozen: false,
  self: false, directChild: true, canEnter: true, canFreeze: true, canDelete: true, held: 2000,
};
const account = {
  loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLoginName: 'admin', frozen: false, isBranchOwner: false, staff: false,
  roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true, listed,
};

// The user page's head (spec 2026-11-08-inner-pages-refresh, §2b; spec 2026-11-08-overview-and-reports-nav, H):
// status beside the name, the wallet's actions under «المحفظة», the rest behind ⋯, the wallet as cards, two tabs,
// and the number operations and numbers as closed sections of «الحساب».
test('the user page heads with its status, actions and wallet cards', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users/pos1/packages': () => ({ body: { summary: { total: 3, visible: 3, custom: 2 }, companies: [] } }),
    'GET /users/pos1/ops': () => ({ body: { denied: ['sim'], deniedAbove: [] } }),
    'POST /wallets/pos1/fund': () => ({ body: { ok: true } }),
    'POST /wallets/pos1/deduct': () => ({ body: { ok: true } }),
    'GET /lines': () => ({ body: { items: [{ id: 'ln1', msisdn: '0550000001', status: 'active', packageName: '400 جيجا', posLoginName: 'pos1', endsAt: '2026-12-01T00:00:00.000Z' }], poses: [], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  const head = page.locator('.page-head');
  await expect(head.locator('.ui-badge')).toHaveText('يعمل');
  await expect(head).toContainText('نقطة بيع · يتبع: admin');
  const wallet = head.getByRole('button', { name: 'المحفظة' });
  await wallet.click();
  await expect(page.getByRole('menuitem')).toHaveText(['تمويل', 'خصم', 'السقف', 'كشف الحساب']);
  await page.keyboard.press('Escape');
  await head.getByRole('button', { name: 'إجراءات أخرى' }).click();
  await expect(page.getByRole('menuitem', { name: 'تجميد' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'حذف' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'تمويل' })).toHaveCount(0);
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
  // Graphite: every part of the account is a tab, packages and prices first (as in the approved design).
  await expect(page.getByRole('tab')).toHaveText([/الرزم والأسعار/, /عمليات الأرقام/, 'أرقام الحساب', 'صلاحيات الحساب']);
  await expect(page.getByRole('tab', { name: /الرزم والأسعار/ }).locator('.step-count')).toHaveText('2');
  await expect(page.getByRole('tab', { name: /عمليات الأرقام/ }).locator('.step-count')).toHaveText('1');
  // The numbers are read only once their tab opens, narrowed to this account.
  expect(calls.some((call) => call.startsWith('GET /lines'))).toBe(false);
  await page.getByRole('tab', { name: 'أرقام الحساب' }).click();
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  expect(calls.some((call) => call.startsWith('GET /lines?') && call.includes('loginName=pos1'))).toBe(true);

  await wallet.click();
  await page.getByRole('menuitem', { name: 'تمويل' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('25');
  await dialog.getByRole('button', { name: 'تمويل' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls).toContain('POST /wallets/pos1/fund');

  // Taking money back: from «المحفظة», with a reason and a note.
  await wallet.click();
  await page.getByRole('menuitem', { name: 'خصم' }).click();
  const back = page.getByRole('dialog');
  await back.getByLabel('السبب').selectOption('correction');
  await back.getByLabel('المبلغ').fill('10');
  await back.getByLabel('ملاحظة').fill('شحنة مكررة');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/office/wallets/pos1/deduct'));
  await back.getByRole('button', { name: 'خصم' }).click();
  expect((await sent).postDataJSON()).toEqual({ amount: 1000, note: 'شحنة مكررة', reason: 'correction' });
});
