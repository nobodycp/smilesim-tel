import { expect, test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

test('roles puts the create button on the title row', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/roles**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roles: [] }) }),
  );
  await page.goto('http://admin.localhost:3910/roles');
  await expectFullTable(page, 'الأدوار', { fit: true });
  await expect(page.getByRole('button', { name: 'الدور' })).toBeVisible();
});

test('package steps stay on the point-of-sale door', async ({ page }) => {
  await page.route('**/office/packages**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ packages: [], companies: [] }) }),
  );
  await page.goto('/packages');
  await expect(page.locator('.steps')).toBeVisible();
});
