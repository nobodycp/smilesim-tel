import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

const day = 86_400_000;
const line = (id: string, msisdn: string, inDays: number, status = 'active') => ({
  id, msisdn, iccid: null, esim: false, status, packageCode: 'cell-400', packageName: '400 جيجا', companyName: 'سلكوم',
  posLogin: 'pos', posPrice: 3000, createdAt: '2026-10-01T00:00:00.000Z', endsAt: new Date(Date.now() + inDays * day - 60_000).toISOString(),
});

// «ينتهي قريباً» (roadmap N2): days left on every active number, a warning when three or fewer, a filter, and a home card.
test('numbers show the days left and filter the lines ending soon; the home counts them', async ({ page }) => {
  const calls = await serveOffice(page, 'branch', {
    'GET /lines': () => ({ body: { lines: [line('l1', '0550000001', 2), line('l2', '0550000002', 20), line('l3', '0550000003', 1, 'disconnected')], poses: [], nextCursor: null, total: 3 } }),
    'GET /packages': () => ({ body: { packages: [], companies: [] } }),
    'GET /home': () => ({ body: { pendingTasks: 1, activeLines: 2, inactiveLines: 1, expiringLines: 1, canPost: true, operations: [], announcements: [] } }),
  });
  await page.goto('http://admin.localhost:3910/numbers');
  const rows = page.locator('table.data tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.ui-badge-warning')).toHaveText('2 يوم');
  await expect(rows.nth(1)).toContainText('20');
  await expect(rows.nth(2).locator('td.num').last()).toHaveText('—');

  await page.getByRole('combobox', { name: 'الحالة' }).selectOption('expiring');
  await expect.poll(() => calls.some((call) => call.startsWith('GET /lines?') && call.includes('status=expiring'))).toBe(true);

  await page.goto('http://admin.localhost:3910/');
  const card = page.locator('a.stat-link[href="/numbers?status=expiring"]');
  await expect(card).toContainText('ينتهي قريباً');
  await expect(card.locator('.stat-value')).toHaveText('1');
});
