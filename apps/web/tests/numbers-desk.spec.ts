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
  posLoginName: 'pos',
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

test('the SIM / eSIM filter is sent with the others, and an empty answer under it says «no matches», not «no numbers yet»', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/office/lines**', (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, poses: [] }) });
  });
  await page.route('**/office/packages', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ packages: [], companies: [] }) }),
  );
  // No filter: the list is simply empty.
  await page.goto('/numbers');
  await expect(page.getByText('لا أرقام بعد.')).toBeVisible();
  // Only the SIM filter: it is a filter like the others.
  await page.goto('/numbers?sim=esim');
  await expect(page.getByText('لا نتائج لهذا التصفية')).toBeVisible();
  await expect(page.getByText('لا أرقام بعد.')).toHaveCount(0);
  expect(asked.at(-1)).toContain('sim=esim');
  // With a status beside it, both travel; a kind that is not one of the two is not sent at all.
  await page.goto('/numbers?sim=sim&status=frozen');
  await expect(page.getByText('لا نتائج لهذا التصفية')).toBeVisible();
  expect(asked.at(-1)).toContain('sim=sim');
  expect(asked.at(-1)).toContain('status=frozen');
  await page.goto('/numbers?sim=card');
  await expect(page.getByText('لا أرقام بعد.')).toBeVisible();
  expect(asked.at(-1)).not.toContain('sim=');
});
