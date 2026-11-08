import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const series = Array.from({ length: 30 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 10 + index)).toISOString().slice(0, 10),
  balance: index < 27 ? 0 : 24806,
}));

// The finance page opens on the signed-in wallet (spec 2026-11-08-inner-pages-refresh, §6): four cards, the balance
// over 30 days, what moved, and the statement with a CSV of the filters on screen.
test('finance shows the wallet, its 30 days, and exports the filtered statement', async ({ page }) => {
  await serveOffice(page, 'agent', {
    'GET /finance/summary': () => ({ body: { balance: 24806, ceiling: 0, held: 0, unlimited: false, moneyIn: 30000, moneyOut: 5194, count: 4, profit: 1250, sales: 2, series } }),
    'GET /finance': () => ({ body: { entries: [{
      id: 'e1', at: '2026-11-06T16:27:00.000Z', loginName: 'pos1', layer: 'pos', actorLogin: 'pos1', kind: 'activate', amount: -3800,
      balanceBefore: 30000, balanceAfter: 26200, msisdn: '0550000001', companyName: 'سلكوم', packageName: '150 جيجا', packagePrice: 3800,
      esimPrice: null, note: '', margin: 300,
    }], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://agent.localhost:3910/finance');
  const cards = page.locator('.stat-row .stat');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0)).toContainText('248.06 ₪');
  await expect(cards.nth(4)).toContainText('248.06 ₪');
  await expect(page.getByRole('img', { name: 'الرصيد عبر الوقت' })).toBeVisible();
  await expect(page.locator('.wallet-chart-figures')).toContainText('+248.06 ₪');
  await expect(page.locator('.wallet-figures')).toContainText('300.00 ₪');
  await expect(page.locator('.wallet-figures')).toContainText('51.94 ₪');
  // What this account earned: over 30 days, and on each sale in the statement.
  await expect(page.locator('.wallet-figures .stat').first()).toContainText('+12.50 ₪');
  await expect(page.locator('.wallet-figures .stat').first()).toContainText('2 بيعة');
  const row = page.locator('table.data tbody tr').first();
  await expect(row).toContainText('+3.00 ₪');

  await page.getByLabel('من', { exact: true }).fill('2026-11-01');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/office/finance/export?from=2026-11-01');
});
