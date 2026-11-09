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

// «التقارير» (roadmap N5; one page each since spec 2026-11-08-overview-and-reports-nav, C): sales, orders and
// balances for the layers that have them; providers for the branch with reports. The sidebar folds them in one group.
test('an agent reads its sales, orders and balances on their own pages, and exports each with its filters', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /reports/sales': () => ({ body: sales }),
    'GET /reports/orders': () => ({ body: orders }),
    'GET /reports/balances': () => ({ body: balances }),
  });
  await page.goto('http://agent.localhost:3910/reports');
  await expect(page).toHaveURL(/\/reports\/sales$/);
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await expect(page.locator('.stat-row .stat').nth(2)).toContainText('+4.00 ₪');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', /\/api\/office\/reports\/sales\/export\?from=/);

  // The pages are reached from the sidebar group, as a user moves between them.
  const nav = page.locator('.sidebar .side-nav');
  await nav.getByRole('link', { name: 'الطلبات' }).click();
  await expect(page).toHaveURL(/\/reports\/orders$/);
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  await expect(page.locator('table.data tbody tr').first()).toContainText('مفتوح');
  await page.getByRole('combobox', { name: 'الحالة' }).selectOption('open');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /reports/orders?') && call.includes('status=open'))).toBe(true);

  await nav.getByRole('link', { name: 'الأرصدة' }).click();
  await expect(page).toHaveURL(/\/reports\/balances$/);
  await expect(page.locator('table.data tbody tr').first()).toContainText('30.00 ₪');
  await page.getByLabel('السالب فقط').check();
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/office/reports/balances/export?negative=1');
});

test('the sidebar folds the reports in one group that starts closed and opens on a report page', async ({ page }) => {
  await serveOffice(page, 'agent', { 'GET /reports/sales': () => ({ body: sales }) });
  await page.goto('http://agent.localhost:3910/numbers');
  const nav = page.locator('.sidebar .side-nav');
  const head = nav.getByRole('button', { name: 'التقارير' });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await head.click();
  await expect(nav.getByRole('link')).toContainText(['المالية', 'العمليات', 'الأرباح', 'المبيعات', 'الطلبات', 'الأرصدة']);
  await expect(nav.getByRole('link', { name: 'تقارير المزودين' })).toHaveCount(0);
  await expect(nav.getByText('غير جاهز')).toHaveCount(0);
  await page.goto('http://agent.localhost:3910/reports/sales');
  await expect(nav.getByRole('button', { name: 'التقارير' })).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'المبيعات' })).toHaveAttribute('aria-current', 'page');
});

test('the providers report is the branch reader\'s', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /reports/supply': () => ({ body: { rows: [{ providerCode: 'sky', providerName: 'سكاي', operations: 7, cost: 24500, profit: 2100 }], totals: { operations: 7, cost: 24500, profit: 2100 }, capped: false } }),
  });
  await page.goto('http://admin.localhost:3910/reports/supply');
  await expect(page.locator('table.data tbody tr').first()).toContainText('سكاي');
  await expect(page.locator('table.data tbody tr').first()).toContainText('+21.00 ₪');
});
