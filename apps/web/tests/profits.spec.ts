import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// The profits page (roadmap N4): every layer sees its own profit by package over a period, refunds taken back.
test('profits show the totals and each package, follow the dates, and export them', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /finance/profits': () => ({
      body: {
        packages: [
          { packageName: '400 جيجا', companyName: 'سلكوم', sales: 3, refunds: 1, profit: 1050 },
          { packageName: '150 جيجا', companyName: 'وي', sales: 2, refunds: 0, profit: 600 },
        ],
        totals: { sales: 5, refunds: 1, profit: 1650 },
        capped: false,
      },
    }),
  });
  await page.goto('http://agent.localhost:3910/profits');
  await expect(page.getByRole('heading', { name: 'الأرباح', level: 1 })).toBeVisible();
  const cards = page.locator('.stat-row .stat');
  await expect(cards.nth(0)).toContainText('5');
  await expect(cards.nth(1)).toContainText('1');
  await expect(cards.nth(2)).toContainText('+16.50 ₪');
  const rows = page.locator('table.data tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('+10.50 ₪');
  // The page opens on the last 30 days, and the sidebar names it.
  expect(calls.some((call) => call.startsWith('GET /finance/profits?from='))).toBe(true);
  await expect(page.getByRole('link', { name: 'الأرباح' })).toHaveAttribute('aria-current', 'page');

  await page.getByLabel('إلى').fill('2026-11-30');
  await expect(page.getByRole('link', { name: 'تصدير CSV' })).toHaveAttribute('href', /\/api\/office\/finance\/profits\/export\?from=\d{4}-\d{2}-\d{2}&to=2026-11-30/);
});
