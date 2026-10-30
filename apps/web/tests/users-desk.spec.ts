import { test } from '@playwright/test';
import { asBranch, expectFullTable } from './desk';

test('users is a full table on the branch door', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) }),
  );
  await page.goto('http://admin.localhost:3910/users');
  await expectFullTable(page, 'المستخدمون');
});
