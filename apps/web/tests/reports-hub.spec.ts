import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const balances = {
  rows: [{ loginName: 'pos', nickname: 'الكاشير', layer: 'pos', parentLogin: 'agent1', balance: -2000, ceiling: 5000, used: 2000, available: 3000, frozen: false, lastAt: '2026-11-06T10:00:00.000Z' }],
  totals: { count: 1, balance: -2000, used: 2000 },
  capped: false,
};

// «التقارير» (roadmap N5; one page each since spec 2026-11-08-overview-and-reports-nav, C; five since spec
// 2026-11-09-admin-review, 1): finance, profits and balances for an agent; providers for the branch with reports.
test('an agent reads its balances on their own page, and exports them with their filters', async ({ page }) => {
  await serveOffice(page, 'agent', {
    'GET /finance': () => ({ body: { entries: [], nextCursor: null, total: 0 } }),
    'GET /reports/balances': () => ({ body: balances }),
  });
  await page.goto('http://agent.localhost:3910/reports');
  await expect(page).toHaveURL(/\/finance$/);
  const nav = page.locator('.sidebar .side-nav');
  await nav.getByRole('link', { name: 'الأرصدة' }).click();
  await expect(page).toHaveURL(/\/reports\/balances$/);
  await expect(page.locator('table.data tbody tr').first()).toContainText('30.00 ₪');
  await page.getByLabel('السالب فقط').check();
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/office/reports/balances/export?negative=1');
});

test('the sidebar folds five reports in one group that starts closed and opens on a report page', async ({ page }) => {
  await serveOffice(page, 'agent', { 'GET /reports/balances': () => ({ body: balances }) });
  await page.goto('http://agent.localhost:3910/numbers');
  const nav = page.locator('.sidebar .side-nav');
  const head = nav.getByRole('button', { name: 'التقارير' });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await head.click();
  await expect(nav.getByRole('link', { name: 'المالية' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'الأرباح' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'الأرصدة' })).toBeVisible();
  for (const gone of ['العمليات', 'المبيعات', 'الطلبات', 'تكلفة المزودين']) await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
  await page.goto('http://agent.localhost:3910/reports/balances');
  await expect(nav.getByRole('button', { name: 'التقارير' })).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'الأرصدة' })).toHaveAttribute('aria-current', 'page');
});

test('the old report paths land where their rows now live', async ({ page }) => {
  await serveOffice(page, 'branch', {
    'GET /finance': () => ({ body: { entries: [], nextCursor: null, total: 0 } }),
    'GET /tasks': () => ({ body: { tasks: [], nextCursor: null, total: 0 } }),
  });
  await page.goto('http://admin.localhost:3910/operations');
  await expect(page).toHaveURL(/\/finance\?scope=operations$/);
  await page.goto('http://admin.localhost:3910/reports/sales');
  await expect(page).toHaveURL(/\/finance\?scope=operations$/);
  await page.goto('http://admin.localhost:3910/reports/orders');
  await expect(page).toHaveURL(/\/tasks$/);
});
