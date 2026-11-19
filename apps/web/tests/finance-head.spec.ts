import { expect, test } from '@playwright/test';
import { serveApi } from './desk';

const series = Array.from({ length: 30 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 10 + index)).toISOString().slice(0, 10),
  balance: index < 27 ? 0 : 24806,
}));

const summary = { balance: 24806, ceiling: 0, held: 0, unlimited: false, moneyIn: 30000, moneyOut: 5194, count: 4, manual: 1, days: 30, profit: 1250, sales: 2, series };
const entry = {
  id: 'e1', at: '2026-11-06T16:27:00.000Z', loginName: 'pos1', layer: 'pos', actorLoginName: 'pos1', kind: 'activate', amount: -3800,
  balanceBefore: 30000, balanceAfter: 26200, msisdn: '0550000001', companyName: 'سلكوم', packageName: '150 جيجا', packagePrice: 3800,
  // The agent's own prices on its point of sale's sale (FL.1): it paid 35.00 and the point of sale paid it 38.00.
  esimPrice: null, note: '', margin: 300, cost: 3500, sell: 3800, loss: null, reason: null, held: null, shares: null,
};

// «المالية» is a statement only (spec 2026-11-09-admin-review, 1): no wallet cards, the table first, the CSV of the
// filters on screen, and «العمليات فقط», which the old «العمليات» page opens with `?scope=operations`.
test('finance opens on the statement, without the wallet head, and exports the filtered statement', async ({ page }) => {
  const calls = await serveApi(page, 'agent', {
    'GET /finance/summary': () => ({ body: summary }),
    'GET /finance': () => ({ body: { items: [entry], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://agent.localhost:3910/finance');
  const row = page.getByTestId('data-table').locator('tbody tr').first();
  await expect(row.getByTestId('reason-leaf')).toBeVisible();
  // The amount, the movement on the wallet, never folds; the margin is on the row or, folded by the width, under the arrow.
  await expect(row).toContainText('-38.00 ₪');
  if (await row.getByTestId('row-more').count()) await row.getByTestId('row-more').click();
  await expect(page.getByTestId('data-table').locator('tbody')).toContainText('+3.00 ₪');
  await expect(page.getByTestId('wallet-band')).toHaveCount(0);
  await expect(page.getByTestId('wallet-chart')).toHaveCount(0);
  expect(calls.some((call) => call.startsWith('GET /finance/summary'))).toBe(false);

  await page.getByLabel('من', { exact: true }).fill('2026-11-01');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/v1/finance/export?from=2026-11-01');
});

test('finance opened with ?scope=operations lists the operations only', async ({ page }) => {
  const calls = await serveApi(page, 'branch', {
    'GET /finance': () => ({ body: { items: [entry], nextCursor: null, total: 1 } }),
  });
  await page.goto('http://admin.localhost:3910/finance?scope=operations');
  await expect(page.getByTestId('data-table').locator('tbody tr').first()).toContainText('0550000001');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /finance?') && call.includes('scope=operations'))).toBe(true);
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', /scope=operations/);
});

// The wallet head lives on «المحفظة»: the balance leads, money in and out over the window, the movements with those
// made by hand, the balance over time, and the 7 / 30 / 90 days switch the tiles follow.
test('the wallet page shows the head and its window switch', async ({ page }) => {
  const calls = await serveApi(page, 'agent', {
    'GET /finance/summary': () => ({ body: summary }),
    'GET /ledger': () => ({ body: { items: [], nextCursor: null, total: 0 } }),
  });
  await page.goto('http://agent.localhost:3910/wallet');
  const band = page.getByTestId('wallet-band');
  await expect(band.getByTestId('balance-tile')).toContainText('248.06 ₪');
  await expect(band).toContainText('300.00 ₪');
  await expect(band).toContainText('-51.94 ₪');
  await expect(band).toContainText('منها 1 يدوية');
  await expect(page.getByRole('img', { name: 'الرصيد عبر الوقت' })).toBeVisible();
  await expect(page.getByTestId('wallet-chart').locator('header')).toContainText('+248.06 ₪');
  await page.getByRole('button', { name: '7 أيام' }).click();
  await expect.poll(() => calls.some((call) => call.startsWith('GET /finance/summary?') && call.includes('days=7'))).toBe(true);
});

// Spec 2026-11-19-finance-ledger-columns (FL.2): one fact a column, the columns that fold by width read under the
// row's arrow, with the facts that have no column; the amount is the wallet's movement, the cost the package's.
const branchSale = {
  ...entry, id: 'b1', loginName: 'pos1', actorLoginName: 'admin', note: 'بطلب الزبون', amount: -4300, esimPrice: 500,
  cost: 2000, sell: 2400, margin: 400,
  shares: [
    { loginName: 'admin', layer: 'branch', margin: 400 },
    { loginName: 'main1', layer: 'main_agent', margin: 500 },
  ],
};
const funding = { ...entry, id: 'b2', kind: 'fund', amount: 10000, msisdn: '', packageName: '', companyName: '', packagePrice: null, margin: null, cost: null, sell: null, actorLoginName: 'pos1' };

test('the arrow opens a row\'s remaining facts, labelled, and closes again by keyboard; a row with nothing more has none', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveApi(page, 'branch', { 'GET /finance': () => ({ body: { items: [branchSale, funding], nextCursor: null, total: 2 } }) });
  await page.goto('http://admin.localhost:3910/finance');
  const rows = page.getByTestId('data-table').locator('tbody tr');
  const sale = rows.first();
  // The eSIM mark is in the reason cell without its figure (the owner's point 6); the amount holds the fee.
  await expect(sale).toContainText('eSIM');
  await expect(sale).toContainText('-43.00 ₪');
  const arrow = sale.getByRole('button', { name: 'تفاصيل العملية' });
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await arrow.click();
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  const part = page.getByTestId('row-more-part');
  await expect(part).toContainText('من قام بالعملية');
  await expect(part).toContainText('بطلب الزبون');
  await expect(part).toContainText('رسم eSIM');
  await expect(part).toContainText('5.00 ₪');
  await expect(part).toContainText('أرباح السلسلة');
  await arrow.focus();
  await page.keyboard.press('Enter');
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('row-more-part')).toHaveCount(0);
  // The funding row: its amount, empty prices; when every column fits (twelve heads) it has nothing more, so no arrow.
  const fund = rows.nth(1);
  await expect(fund).toContainText('+100.00 ₪');
  if ((await page.getByTestId('data-table').locator('thead th').count()) === 12) await expect(fund.getByTestId('row-more')).toHaveCount(0);
});

for (const width of [375, 768, 1280]) {
  test(`the finance list never scrolls sideways at ${width}px, and keeps the six facts that never fold`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await serveApi(page, 'branch', { 'GET /finance': () => ({ body: { items: [branchSale, funding], nextCursor: null, total: 2 } }) });
    await page.goto('http://admin.localhost:3910/finance');
    const sale = page.getByTestId('data-table').locator('tbody tr').first();
    await expect(sale).toContainText('-43.00 ₪');
    await expect(sale).toContainText('0550000001');
    const sheet = page.getByTestId('table-sheet');
    await expect.poll(() => sheet.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width === 375) {
      // A phone keeps the time, the reason, the number, the amount and the two balances; the package is under the arrow.
      await expect(sale).not.toContainText('150 جيجا');
      await sale.getByTestId('row-more').click();
      await expect(page.getByTestId('row-more-part')).toContainText('150 جيجا');
      await expect(page.getByTestId('row-more-part')).toContainText('سعر التكلفة');
    }
  });
}
