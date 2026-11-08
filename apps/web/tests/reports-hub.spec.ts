import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const sales = {
  rows: [{ id: 's1', at: '2026-11-06T10:00:00.000Z', loginName: 'pos', kind: 'activate', msisdn: '0550000001', companyName: 'سلكوم', packageName: '400 جيجا', amount: 4500, margin: 400 }],
  totals: { count: 1, amount: 4500, profit: 400 },
  capped: false,
};
const orders = {
  rows: [
    { id: 't1', at: '2026-11-07T10:00:00.000Z', loginName: 'pos', action: 'switch', msisdn: '0550000002', companyName: 'وي', packageName: '150 جيجا', status: 'open', amount: -500 },
    { id: 'e1', at: '2026-11-06T10:00:00.000Z', loginName: 'pos', action: 'charge', msisdn: '0550000001', companyName: 'سلكوم', packageName: '400 جيجا', status: 'done', amount: -4200 },
  ],
  totals: { count: 2, done: 1, open: 1, cancelled: 0 },
  capped: false,
};
const balances = {
  rows: [{ loginName: 'pos', nickname: 'الكاشير', layer: 'pos', parentLogin: 'agent1', balance: -2000, ceiling: 5000, used: 2000, available: 3000, frozen: false, lastAt: '2026-11-06T10:00:00.000Z' }],
  totals: { count: 1, balance: -2000, used: 2000 },
  capped: false,
};

// «التقارير» (roadmap N5): sales, profits, orders and balances for every layer; providers for the branch with reports.
test('an agent reads its sales, orders and balances, and exports each with its filters', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /reports/sales': () => ({ body: sales }),
    'GET /reports/orders': () => ({ body: orders }),
    'GET /reports/balances': () => ({ body: balances }),
  });
  await page.goto('http://agent.localhost:3910/reports');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['المبيعات', 'الأرباح', 'الطلبات', 'الأرصدة']);
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await expect(page.locator('.stat-row .stat').nth(2)).toContainText('+4.00 ₪');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', /\/api\/office\/reports\/sales\/export\?from=/);

  await tabs.nth(2).click();
  await expect(page).toHaveURL(/tab=orders/);
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  await expect(page.locator('table.data tbody tr').first()).toContainText('مفتوح');
  await page.getByRole('combobox', { name: 'الحالة' }).selectOption('open');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /reports/orders?') && call.includes('status=open'))).toBe(true);

  await tabs.nth(3).click();
  await expect(page.locator('table.data tbody tr').first()).toContainText('30.00 ₪');
  await page.getByLabel('السالب فقط').check();
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/office/reports/balances/export?negative=1');
});

test('the providers tab is the branch reader\'s', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /reports/sales': () => ({ body: sales }),
    'GET /reports/supply': () => ({ body: { rows: [{ providerCode: 'sky', providerName: 'سكاي', operations: 7, cost: 24500, profit: 2100 }], totals: { operations: 7, cost: 24500, profit: 2100 }, capped: false } }),
  });
  await page.goto('http://admin.localhost:3910/reports?tab=supply');
  await expect(page.getByRole('tab', { name: 'المزودون' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('table.data tbody tr').first()).toContainText('سكاي');
  await expect(page.locator('table.data tbody tr').first()).toContainText('+21.00 ₪');
});
