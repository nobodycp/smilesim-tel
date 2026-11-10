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
      body: JSON.stringify({ items: [line], poses: [] }),
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
  await page.getByRole('button', { name: /إجراءات/ }).click();
  await expect(page.getByRole('menuitem', { name: 'تمديد' })).toBeVisible();
  await expect(page.locator('table.data button.secondary')).toHaveCount(0);
  // Graphite: one line under the title says what the list holds.
  await expect(page.locator('.lede')).toHaveText('كل أرقام نقاط البيع تحتك، مع مدتها وحالاتها.');
});

test('a row menu opens on its first item, walks with the arrows, and Escape gives the focus back', async ({ page }) => {
  await page.route('**/office/lines**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [line], poses: [] }) }),
  );
  await page.route('**/office/packages', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ packages: [], companies: [] }) }),
  );
  await page.goto('/numbers');
  await expectFullTable(page, 'الأرقام');
  const trigger = page.getByRole('button', { name: /إجراءات/ });
  await trigger.click();
  const items = page.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
