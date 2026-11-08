import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const sky = { code: 'sky', name: 'سكاي', purchases: 6500, payments: 0, settlements: 0, balance: -6500, creditLimit: 0, held: 0, available: -6500 };
const run = {
  id: 'r1', providerCode: 'sky', providerName: 'سكاي', at: '2026-11-08T10:00:00.000Z', fileName: 'sky.csv', periodFrom: '2026-11-06T00:00:00.000Z', periodTo: '2026-11-07T00:00:00.000Z',
  statementTotal: 14500, ourTotal: 10000, actorLogin: 'admin', counts: { matched: 1, different: 1, missing_ours: 1, missing_theirs: 1, duplicate: 0 },
  items: [
    { id: 'i1', kind: 'different', msisdn: '0521000002', at: '2026-11-06T00:00:00.000Z', theirAmount: 4000, ourAmount: 4500, reference: null, status: 'open', note: null, resolvedBy: null },
    { id: 'i2', kind: 'missing_ours', msisdn: '0521000003', at: '2026-11-07T00:00:00.000Z', theirAmount: 3000, ourAmount: null, reference: 'R-9', status: 'open', note: null, resolvedBy: null },
  ],
};

// Reconciliation (roadmap N8): upload a statement, pick its columns, compare, and handle each difference.
test('the branch uploads a statement, compares it and handles a difference', async ({ page }) => {
  let ran = false;
  await serveOffice(page, 'branch', {
    'GET /provider-accounts/sky': () => ({ body: { summary: sky, ledger: [], capped: false } }),
    'GET /provider-accounts/sky/reconciliations': () => ({ body: { runs: ran ? [{ ...run, open: 2 }] : [] } }),
    'POST /provider-accounts/sky/statements/preview': () => ({ body: { columns: ['رقم', 'تاريخ', 'مبلغ'], sample: [['0521000001', '06/11/2026', '35']], rows: 4, map: { msisdn: 0, date: 1, amount: 2, reference: null } } }),
    'POST /provider-accounts/sky/reconciliations': () => { ran = true; return { body: run }; },
    'GET /reconciliations/r1': () => ({ body: run }),
    'PATCH /reconciliation-items/i1': () => ({ body: { ok: true } }),
  });
  await page.goto('http://admin.localhost:3910/provider-accounts/sky');
  await page.getByRole('tab', { name: 'المطابقة' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'sky.csv', mimeType: 'text/csv', buffer: Buffer.from('رقم,تاريخ,مبلغ\n0521000001,06/11/2026,35\n') });
  await expect(page.getByText('sky.csv: 4 سطراً')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'الرقم' })).toHaveValue('0');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/provider-accounts/sky/reconciliations'));
  await page.getByRole('button', { name: 'طابق' }).click();
  const body = (await sent).postDataJSON();
  expect(body.map).toEqual({ msisdn: 0, date: 1, amount: 2, reference: null });
  expect(Buffer.from(body.content, 'base64').toString('utf8')).toContain('0521000001');

  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  // The provider's own cards come first, then the counts, then the totals.
  await expect(page.locator('.stat-row').nth(2)).toContainText('+45.00 ₪');
  await page.locator('table.data tbody tr').first().getByRole('button', { name: 'معالجة' }).click();
  await page.getByRole('dialog').getByLabel('ملاحظة').fill('المزود صحّح السعر');
  const handled = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/reconciliation-items/i1'));
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  expect((await handled).postDataJSON()).toEqual({ status: 'resolved', note: 'المزود صحّح السعر' });
});
