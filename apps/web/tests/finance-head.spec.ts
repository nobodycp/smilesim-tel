import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const series = Array.from({ length: 30 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 10 + index)).toISOString().slice(0, 10),
  balance: index < 27 ? 0 : 24806,
}));

const summary = { balance: 24806, ceiling: 0, held: 0, unlimited: false, moneyIn: 30000, moneyOut: 5194, count: 4, manual: 1, days: 30, profit: 1250, sales: 2, series };
const entry = {
  id: 'e1', at: '2026-11-06T16:27:00.000Z', loginName: 'pos1', layer: 'pos', actorLoginName: 'pos1', kind: 'activate', amount: -3800,
  balanceBefore: 30000, balanceAfter: 26200, msisdn: '0550000001', companyName: 'سلكوم', packageName: '150 جيجا', packagePrice: 3800,
  esimPrice: null, note: '', margin: 300,
};

// «المالية» is a statement only (spec 2026-11-09-admin-review, 1): no wallet cards, the table first, the CSV of the
// filters on screen, and «العمليات فقط», which the old «العمليات» page opens with `?scope=operations`.
test('finance opens on the statement, without the wallet head, and exports the filtered statement', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /finance/summary': () => ({ body: summary }),
    'GET /finance': () => ({ body: { items: [entry], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://agent.localhost:3910/finance');
  const row = page.locator('table.data tbody tr').first();
  await expect(row.locator('.reason.r-leaf')).toBeVisible();
  await expect(row).toContainText('+3.00 ₪');
  await expect(page.locator('.wallet-band')).toHaveCount(0);
  await expect(page.locator('.wallet-chart')).toHaveCount(0);
  expect(calls.some((call) => call.startsWith('GET /finance/summary'))).toBe(false);

  await page.getByLabel('من', { exact: true }).fill('2026-11-01');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/office/finance/export?from=2026-11-01');
});

test('finance opened with ?scope=operations lists the operations only', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /finance': () => ({ body: { items: [entry], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://admin.localhost:3910/finance?scope=operations');
  await expect(page.locator('table.data tbody tr').first()).toContainText('0550000001');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /finance?') && call.includes('scope=operations'))).toBe(true);
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', /scope=operations/);
});

// The wallet head lives on «المحفظة»: the balance leads, money in and out over the window, the movements with those
// made by hand, the balance over time, and the 7 / 30 / 90 days switch the tiles follow.
test('the wallet page shows the head and its window switch', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /finance/summary': () => ({ body: summary }),
    'GET /ledger': () => ({ body: { items: [], nextCursor: null, total: 0 } }),
  });
  await page.goto('http://agent.localhost:3910/wallet');
  const band = page.locator('.wallet-band');
  await expect(band.locator('.figure-tile.lead')).toContainText('248.06 ₪');
  await expect(band).toContainText('300.00 ₪');
  await expect(band).toContainText('-51.94 ₪');
  await expect(band).toContainText('منها 1 يدوية');
  await expect(page.getByRole('img', { name: 'الرصيد عبر الوقت' })).toBeVisible();
  await expect(page.locator('.wallet-chart .pane-head')).toContainText('+248.06 ₪');
  await page.getByRole('button', { name: '7 أيام' }).click();
  await expect.poll(() => calls.some((call) => call.startsWith('GET /finance/summary?') && call.includes('days=7'))).toBe(true);
});
