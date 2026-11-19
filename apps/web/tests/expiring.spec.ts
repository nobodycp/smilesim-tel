import { expect, test } from '@playwright/test';
import { chooseOption, serveApi } from './desk';

const day = 86_400_000;
const line = (id: string, msisdn: string, inDays: number, status = 'active') => ({
  id, msisdn, iccid: null, esim: false, status, packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم',
  posLoginName: 'pos', posPrice: 3000, createdAt: '2026-10-01T00:00:00.000Z', endsAt: new Date(Date.now() + inDays * day - 60_000).toISOString(),
});

const overview = {
  period: 'month', from: null, lines: { active: 1, expiring: 1, frozen: 0, disconnected: 1, suspended: 0 },
  sales: { count: 0, amount: 0, profit: 0, refunds: 0, refundAmount: 0, net: 0, trend: [] },
  top: { packages: [], companies: [], providers: [] }, active: { main_agent: [], agent: [], pos: [] },
  users: { counts: { main_agent: 0, agent: 0, pos: 0 }, frozen: 0, debtors: 0, debt: 0, ceilings: 0, used: 0 },
  tasks: { working: 1, done: 0, rejected: 0, cancelled: 0, oldestOpenMinutes: 5 }, providers: null,
};

// «ينتهي قريباً» (roadmap N2): days left on every active number, a warning when three or fewer, a filter, and a home card.
test('numbers show the days left and filter the lines ending soon; the home counts them', async ({ page }) => {
  const calls = await serveApi(page, 'branch', {
    'GET /postpaid/lines': () => ({ body: { items: [line('l1', '0550000001', 2), line('l2', '0550000002', 20), line('l3', '0550000003', 1, 'disconnected')], poses: [], nextCursor: null, total: 3 } }),
    'GET /postpaid/packages': () => ({ body: { packages: [], companies: [] } }),
    'GET /home': () => ({ body: { pendingTasks: 1, activeLines: 2, inactiveLines: 1, expiringLines: 1, operations: [] } }),
    'GET /overview': () => ({ body: overview }),
  });
  await page.goto('http://admin.localhost:3910/postpaid/numbers');
  const rows = page.getByTestId('data-table').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  // Graphite: what is left turns crimson and says so when the number ends soon.
  await expect(rows.nth(0).getByTestId('days-soon')).toHaveText('ينتهي قريباً · 2 يوم');
  await expect(rows.nth(1).getByTestId(/^days-/)).toHaveText('20 يوم');
  await expect(rows.nth(2).getByTestId(/^days-/)).toHaveText('—');

  await chooseOption(page.getByRole('combobox', { name: 'الحالة' }), 'expiring');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /postpaid/lines?') && call.includes('status=expiring'))).toBe(true);

  // The home's numbers donut carries «ينتهي قريباً» as a slice that links to the filter.
  await page.goto('http://admin.localhost:3910/');
  const slice = page.getByTestId('donut-legend').locator('a[href="/postpaid/numbers?status=expiring"]');
  await expect(slice).toContainText('ينتهي قريباً');
  await expect(slice.getByTestId('donut-value')).toHaveText('1');
});
