import { expect, test } from '@playwright/test';
import { serveApi } from './desk';

const balances = {
  items: [{ loginName: 'pos', nickname: 'الكاشير', layer: 'pos', parentLoginName: 'agent1', balance: -2000, ceiling: 5000, used: 2000, available: 3000, frozen: false, lastAt: '2026-11-06T10:00:00.000Z' }],
  totals: { count: 1, balance: -2000, used: 2000 },
  nextCursor: null,
  total: 1,
};

// «التقارير» (roadmap N5; one page each since spec 2026-11-08-overview-and-reports-nav, C; five since spec
// 2026-11-09-admin-review, 1): finance, profits and balances for an agent; providers for the branch with reports.
test('an agent reads its balances on their own page, and exports them with their filters', async ({ page }) => {
  await serveApi(page, 'agent', {
    'GET /finance': () => ({ body: { items: [], nextCursor: null, total: 0 } }),
    'GET /reports/balances': () => ({ body: balances }),
  });
  // The reports open from their own pages: the old hub address `/reports` (a redirect to finance) went with the other
  // old addresses in F.7c.
  await page.goto('http://agent.localhost:3910/finance');
  const nav = page.getByTestId('sidebar').getByRole('navigation', { name: 'أقسام المكتب' });
  await nav.getByRole('link', { name: 'الأرصدة' }).click();
  await expect(page).toHaveURL(/\/reports\/balances$/);
  await expect(page.getByTestId('data-table').locator('tbody tr').first()).toContainText('30.00 ₪');
  await page.getByLabel('السالب فقط').check();
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', '/api/v1/reports/balances/export?negative=1');
});

test('the sidebar folds five reports in one group that starts closed and opens on a report page', async ({ page }) => {
  await serveApi(page, 'agent', { 'GET /reports/balances': () => ({ body: balances }) });
  await page.goto('http://agent.localhost:3910/postpaid/numbers');
  const nav = page.getByTestId('sidebar').getByRole('navigation', { name: 'أقسام المكتب' });
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
