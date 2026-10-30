import { expect, test } from '@playwright/test';
import { expectFullTable } from './desk';

const line = {
  id: 'ln1',
  msisdn: '0550246962',
  iccid: null,
  esim: false,
  status: 'active',
  packageCode: 'cell-400',
  packageName: '400 جيجا',
  companyName: 'سلكوم',
  posLogin: 'pos',
  posPrice: 30,
  createdAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-12T00:00:00.000Z',
};

test('numbers row actions live in the menu', async ({ page }) => {
  await page.route('**/office/lines**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lines: [line], poses: [] }),
    }),
  );
  await page.route('**/office/packages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ packages: [], companies: [] }),
    }),
  );
  await page.goto('/numbers');
  await expectFullTable(page, 'الأرقام');
  await expect(page.getByLabel('الرقم')).toBeVisible();
  await page.getByRole('button', { name: /عمليات/ }).click();
  await expect(page.getByRole('menuitem', { name: 'تمديد' })).toBeVisible();
  await expect(page.locator('table.data button.secondary')).toHaveCount(0);
  await expect(page.locator('.lede')).toHaveCount(0);
});
