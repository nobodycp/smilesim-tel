import { expect, test } from '@playwright/test';
import { expectFullTable } from './desk';

test('tasks drops the repeated title and keeps the status filter visible', async ({ page }) => {
  await page.route('**/office/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }),
  );
  await page.goto('/tasks');
  await expectFullTable(page, 'المهام');
  await expect(page.getByLabel('الحالة')).toBeVisible();
});
