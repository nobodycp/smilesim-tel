import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const sky = { code: 'sky', name: 'سكاي', purchases: 6500, payments: 20000, settlements: -500, balance: 13000, creditLimit: 50000, held: 3500, available: 59500 };
const lian = { code: 'lian', name: 'ليان', purchases: 2000, payments: 0, settlements: 0, balance: -2000, creditLimit: 0, held: 0, available: -2000 };

// Provider accounts (roadmap N7): the branch sees its balance with each provider and records payments and the credit.
test('the branch reads its provider accounts, opens one, and records a payment and a settlement', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /provider-accounts': () => ({ body: { rows: [sky, lian], totals: { balance: 11000, held: 3500, owed: 2000 } } }),
    'GET /provider-accounts/sky': () => ({ body: { summary: sky, capped: false, ledger: [
      { id: 'x1', at: '2026-11-05T00:00:00.000Z', kind: 'payment', amount: 20000, balanceAfter: 13000, note: 'دفعة', msisdn: '', packageName: '', actorLogin: 'admin' },
      { id: 'o1', at: '2026-11-01T00:00:00.000Z', kind: 'activate', amount: -3500, balanceAfter: -3500, note: '', msisdn: '0550000001', packageName: '400 جيجا', actorLogin: '' },
    ] } }),
    'POST /provider-accounts/sky/entries': () => ({ body: { ok: true } }),
  });
  await page.goto('http://admin.localhost:3910/provider-accounts');
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  await expect(page.locator('.stat-row .stat').nth(1)).toContainText('20.00 ₪');
  await page.getByRole('link', { name: 'سكاي' }).click();
  await expect(page).toHaveURL(/\/provider-accounts\/sky$/);
  await expect(page.locator('.stat-row .stat').nth(3)).toContainText('595.00 ₪');
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  await expect(page.locator('table.data tbody tr').first()).toContainText('دفعة');

  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('المبلغ').fill('100');
  await dialog.getByLabel('ملاحظة').fill('دفعة نوفمبر');
  const payment = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/provider-accounts/sky/entries'));
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await payment).postDataJSON()).toEqual({ kind: 'payment', amount: 10000, note: 'دفعة نوفمبر' });

  await page.getByRole('button', { name: 'تسجيل دفعة' }).click();
  await dialog.getByLabel('النوع').selectOption('settlement');
  await dialog.getByLabel('المبلغ').fill('-5');
  await dialog.getByLabel('ملاحظة').fill('فرق');
  const settlement = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/provider-accounts/sky/entries'));
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await settlement).postDataJSON()).toEqual({ kind: 'settlement', amount: -500, note: 'فرق' });
  expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(2);
});
