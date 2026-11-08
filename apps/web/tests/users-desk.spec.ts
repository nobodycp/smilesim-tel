import { expect, test } from '@playwright/test';
import { asBranch, expectFullTable, serveOffice } from './desk';

test('users is a full table on the branch door', async ({ page }) => {
  await asBranch(page);
  await page.route('**/office/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) }),
  );
  await page.goto('http://admin.localhost:3910/users');
  await expectFullTable(page, 'المستخدمون', { fit: true });
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

test('the users table is paged by the server: filters go in the request, the next cursor is read past the first answer, and the whole list waits for a dialog', async ({ page }) => {
  const user = (loginName: string, layer: string) => ({
    loginName, nickname: loginName, layer, roleName: '', parentLogin: null, balance: 0, ceiling: 0, frozen: false, self: false, directChild: true,
    canEnter: false, canFreeze: false, canDelete: false,
  });
  const many = Array.from({ length: 60 }, (_, index) => user(`p${String(index).padStart(2, '0')}`, 'pos'));
  const calls = await serveOffice(page, 'branch', {
    'GET /users': (url) => {
      if (!url.searchParams.get('paged')) return { body: { users: [...many, user('agent9', 'agent')] } };
      if (url.searchParams.get('layer') === 'agent') return { body: { users: [user('agent9', 'agent')], nextCursor: null, total: 1 } };
      return url.searchParams.get('cursor') === '3:p49'
        ? { body: { users: many.slice(50), nextCursor: null, total: 60 } }
        : { body: { users: many.slice(0, 50), nextCursor: '3:p49', total: 60 } };
    },
  });
  await page.context().addCookies([{ name: 'smilesim-page-size', value: '20', url: 'http://admin.localhost:3910' }]);
  await page.goto('http://admin.localhost:3910/users');
  await expect(page.locator('.pane-head .count')).toHaveText('60');
  await expect(page.locator('.data tbody tr')).toHaveCount(20);
  expect(calls.filter((call) => call.startsWith('GET /users')).every((call) => call.includes('paged=1'))).toBe(true);
  expect(calls).not.toContain('GET /users?paged=1&cursor=3%3Ap49');

  // Page 3 (rows 41–60) runs past the first answer of fifty: the next cursor is read.
  await page.locator('.table-pager').getByRole('button', { name: '3', exact: true }).click();
  await expect(page.locator('.data tbody tr')).toHaveCount(20);
  await expect(page.locator('.data tbody tr').last()).toContainText('p59');
  expect(calls).toContain('GET /users?paged=1&cursor=3%3Ap49');

  await page.getByRole('combobox', { name: 'الطبقة' }).selectOption('agent');
  await expect(page.locator('.data tbody tr')).toHaveCount(1);
  expect(calls).toContain('GET /users?paged=1&layer=agent');

  // Opening an account asks for the whole tree, for the parent choice.
  expect(calls).not.toContain('GET /users');
  await page.getByRole('button', { name: 'حساب جديد' }).click();
  await expect.poll(() => calls.includes('GET /users')).toBe(true);
});
