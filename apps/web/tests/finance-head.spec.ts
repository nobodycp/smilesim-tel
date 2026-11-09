import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const series = Array.from({ length: 30 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 10 + index)).toISOString().slice(0, 10),
  balance: index < 27 ? 0 : 24806,
}));

// The finance page opens on the signed-in wallet (spec 2026-11-08-inner-pages-refresh, §6): four cards, the balance
// over 30 days, what moved, and the statement with a CSV of the filters on screen.
test('finance shows the wallet, its 30 days, and exports the filtered statement', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /finance/summary': () => ({ body: { balance: 24806, ceiling: 0, held: 0, unlimited: false, moneyIn: 30000, moneyOut: 5194, count: 4, manual: 1, days: 30, profit: 1250, sales: 2, series } }),
    'GET /finance': () => ({ body: { entries: [{
      id: 'e1', at: '2026-11-06T16:27:00.000Z', loginName: 'pos1', layer: 'pos', actorLogin: 'pos1', kind: 'activate', amount: -3800,
      balanceBefore: 30000, balanceAfter: 26200, msisdn: '0550000001', companyName: 'سلكوم', packageName: '150 جيجا', packagePrice: 3800,
      esimPrice: null, note: '', margin: 300,
    }], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://agent.localhost:3910/finance');
  // The design's head: the balance leads, money in and out over the window, the movements with those made by hand.
  const band = page.locator('.wallet-band');
  await expect(band.locator('.figure-tile.lead')).toContainText('248.06 ₪');
  await expect(band).toContainText('300.00 ₪');
  await expect(band).toContainText('-51.94 ₪');
  await expect(band).toContainText('منها 1 يدوية');
  await expect(page.getByRole('img', { name: 'الرصيد عبر الوقت' })).toBeVisible();
  await expect(page.locator('.wallet-chart .pane-head')).toContainText('+248.06 ₪');
  // The window switch reads the summary again for 7 days, and the tiles follow it.
  await page.getByRole('button', { name: '7 أيام' }).click();
  await expect.poll(() => calls.some((call) => call.startsWith('GET /finance/summary?') && call.includes('days=7'))).toBe(true);
  // The reason is a coloured tag; my margin on each sale stays in the ledger.
  const row = page.locator('table.data tbody tr').first();
  await expect(row.locator('.reason.r-leaf')).toBeVisible();
  await expect(row).toContainText('+3.00 ₪');

  await page.getByLabel('من', { exact: true }).fill('2026-11-01');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/office/finance/export?from=2026-11-01');
});
