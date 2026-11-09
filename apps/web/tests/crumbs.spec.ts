import { expect, test } from '@playwright/test';
import { serveOffice } from './desk';

// The topbar path, like a folder path (spec 2026-11-09-graphite-identity): ⌂ / section / list / item, no back button.
test('the topbar path: the list links back, the page names itself, a list page ends the path', async ({ page }) => {
  const account = {
    loginName: 'pos1', nickname: 'نقطة بيع', layer: 'pos', parentLogin: 'ag1', frozen: false, isBranchOwner: false, staff: false,
    roleId: '', roleName: '', roleGrants: [], extraGrants: [], deniedGrants: [], extraRoleIds: [], grants: [], roles: [], canEdit: true,
  };
  await serveOffice(page, 'branch', {
    'GET /users/pos1': () => ({ body: account }),
    'GET /users': () => ({ body: { users: [] } }),
  });
  await page.goto('http://admin.localhost:3910/users/pos1');
  const trail = page.getByRole('navigation', { name: 'مسار الصفحة' });
  await expect(trail.getByRole('link', { name: 'المستخدمون' })).toHaveAttribute('href', '/users');
  await expect(trail.getByRole('link', { name: 'الصفحة الرئيسية' })).toHaveAttribute('href', '/');
  await expect(trail).toContainText('المكتب');
  await expect(trail.locator('[aria-current="page"]')).toHaveText('pos1 (نقطة بيع)');
  await expect(page.locator('.back-link')).toHaveCount(0);
  await trail.getByRole('link', { name: 'المستخدمون' }).click();
  await expect(page).toHaveURL(/\/users$/);
  // On a list page the path ends with the list itself.
  await expect(trail.locator('[aria-current="page"]')).toHaveText('المستخدمون');
});
