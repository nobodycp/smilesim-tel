import { expect, test } from '@playwright/test';
import { asBranch, expectFullTable, serveOffice } from './desk';

test('users is a full table on the branch door', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) }),
  );
  await page.goto('http://admin.localhost:3910/users');
  await expectFullTable(page, 'المستخدمون');
});

test('an account is named by its login with the full name in parentheses, in the list and in the parent column', async ({ page }) => {
  const user = (loginName: string, nickname: string, layer: string, parentLogin: string | null) => ({
    loginName, nickname, layer, roleName: '', parentLogin, balance: 0, ceiling: 0, frozen: false, self: false, directChild: false,
    canEnter: false, canFreeze: false, canDelete: false,
  });
  await serveOffice(page, 'branch', {
    'GET /users': () => ({ body: { users: [user('agent1', 'وكيل', 'agent', 'main1'), user('pos', 'الكاشير', 'pos', 'agent1')] } }),
  });
  await page.goto('http://admin.localhost:3910/users');
  const rows = page.locator('.data tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole('link', { name: 'agent1 (وكيل)' })).toBeVisible();
  // The parent column holds only a login; the name comes from the session directory.
  await expect(rows.nth(0).locator('td').nth(2)).toHaveText('main1 (رئيسي)');
  await expect(rows.nth(1).locator('td').nth(2)).toHaveText('agent1 (وكيل)');
  await expect(rows.nth(1).getByRole('button', { name: 'إجراءات pos (الكاشير)' })).toBeVisible();
});
